/* feature feature — one proxy for four mediums.
 *
 *   wrangler secret put TMDB_KEY          # tmdb v3 api key
 *   wrangler secret put IGDB_CLIENT_ID    # twitch developer app
 *   wrangler secret put IGDB_CLIENT_SECRET
 *   wrangler secret put ORIGIN            # required: https://you.github.io
 *                                         # comma-separate to allow several
 *
 * routes
 *   /3/*            → tmdb, key added server-side          (film, tv)
 *   /ol/*           → open library                          (books)
 *   /igdb/<endpoint>→ igdb, POST body passed through        (games)
 *   /push/key       → the public half of the push key       (notifications)
 *   /push/send      → sends a notification to a room or a person, as the signed-in sender
 *   /i/<code>/<app path> → an invite page with the room's name for chat previews,
 *                     which then sends people on to the app
 *   /u/<handle>     → somebody's public profile page, only if they switched it on
 *
 * and once an hour, on its own (the [triggers] cron in wrangler.toml), the room's
 * reminders: this week's question is up, voting's open, watch night tonight
 * about to end. Times are the rooms' local time — TZ, default Australia/Sydney.
 *
 * notifications also need (once — tools/push-keys.mjs sets the first two for you):
 *   wrangler secret put VAPID_PUBLIC
 *   wrangler secret put VAPID_PRIVATE
 *   wrangler secret put SUPABASE_SERVICE_KEY   # Supabase → Settings → API → service_role
 *
 * igdb is the reason this exists: it needs a client secret and an oauth token,
 * neither of which can live on a phone.
 */

const CACHE = { tmdb: 60 * 60 * 24, ol: 60 * 60 * 24, igdb: 60 * 60 * 12, wd: 60 * 60 * 24 * 7 };

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(runSchedule(env).catch(() => {})); },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    /* an invite is opened by a chat app's preview fetcher and then by a person tapping
       it — neither says where it came from, so this one route comes before the origin
       check. It only ever sends people on to the app's own address. */
    if (url.pathname.startsWith("/i/")) return await invitePage(request, url, env);
    if (url.pathname.startsWith("/c/") || url.pathname.startsWith("/s/")) return await sharePage(request, url, env);
    if (url.pathname.startsWith("/u/")) return await profilePage(request, url, env);

    /* fail closed. an unrestricted worker is an open proxy: anyone who finds the
       url spends this worker's TMDB key and IGDB credentials. so a missing ORIGIN
       serves nothing, and a request that does not name an allowed origin — one
       with no Origin header included — never reaches the upstreams. */
    const allowed = (env.ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
    if (!allowed.length)
      return json({ error: "worker not configured: wrangler secret put ORIGIN" }, 503);
    /* the iPhone app: the same page, served from inside the app at Capacitor's own address */
    allowed.push("capacitor://localhost");

    const from = request.headers.get("Origin");
    if (!from || !allowed.includes(from))
      return json({ error: "not this origin" }, 403);

    const cors = {
      "Access-Control-Allow-Origin": from,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Vary": "Origin"
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    try {
      if (url.pathname.startsWith("/3/")) return await tmdb(url, env, ctx, cors);
      if (url.pathname.startsWith("/ol/")) return await openLibrary(url, env, ctx, cors);
      if (url.pathname.startsWith("/igdb/")) return await igdb(request, url, env, ctx, cors);
      if (url.pathname === "/wd/series") return await wikidataSeries(url, env, ctx, cors);
      if (url.pathname === "/push/key") return json({ key: env.VAPID_PUBLIC || null }, 200, cors);
      if (url.pathname === "/push/send" && request.method === "POST") return await pushSend(request, env, ctx, cors);
      return json({ error: "unknown route" }, 404, cors);
    } catch (e) {
      console.error(e);
      return json({ error: "the source didn't answer" }, 502, cors);
    }
  }
};

const json = (body, status, cors) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });

/* Two layers. Cloudflare's cache does nothing on a *.workers.dev address, so a small
   memory of recent answers sits in front of it: it lives as long as this copy of the
   worker does (minutes to hours), which is plenty to stop twenty people searching the
   same new release from asking the source twenty times. Only good answers are kept — a
   "slow down" or an error is passed on once and then forgotten, never served for hours. */
const MEM = new Map(), MEM_MAX = 400;
async function cached(key, ctx, ttl, make) {
  const now = Date.now(), m = MEM.get(key);
  if (m && m.until > now) return new Response(m.body, { status:m.status, headers:m.headers });
  const cache = caches.default;
  const req = new Request(key);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await make();
  if (!res.ok) return res;
  const body = await res.arrayBuffer(), headers = new Headers(res.headers);
  headers.set("Cache-Control", `public, max-age=${ttl}`);
  if (MEM.size >= MEM_MAX) MEM.delete(MEM.keys().next().value);
  MEM.set(key, { body, status:res.status, headers:[...headers], until:now + Math.min(ttl, 60 * 60 * 6) * 1000 });
  const out = new Response(body, { status:res.status, headers });
  ctx.waitUntil(cache.put(req, out.clone()).catch(() => {}));
  return out;
}

/* only the lookups the app actually makes. The Origin check above stops browsers on other
   sites, not a script that sets the header itself, so the paths are the second fence:
   whatever else TMDB or IGDB can answer, this worker won't spend its keys asking. */
const TMDB_OK = /^\/3\/(search\/(movie|tv|person|multi|keyword)|discover\/(movie|tv)|find\/[\w-]+|genre\/(movie|tv)\/list|movie\/upcoming|person\/\d+\/combined_credits|collection\/\d+|(movie|tv)\/\d+(\/(images|recommendations|credits|keywords|watch\/providers|season\/\d+))?)$/;
const IGDB_OK = new Set(["games", "genres", "themes"]);
async function tmdb(url, env, ctx, cors) {
  if (!env.TMDB_KEY) return json({ error: "no TMDB_KEY set" }, 500, cors);
  if (!TMDB_OK.test(url.pathname)) return json({ error: "not a lookup this app makes" }, 404, cors);
  const up = new URL("https://api.themoviedb.org" + url.pathname + url.search);
  up.searchParams.set("api_key", env.TMDB_KEY);
  const res = await cached(up.toString(), ctx, CACHE.tmdb, () => fetch(up.toString()));
  return withCors(res, cors);
}

/* Open Library asks every app to say what it is and how to reach whoever runs it, and
   throttles or blocks requests that don't. CONTACT (an email address, ideally) is set with
   `wrangler secret put CONTACT`; until it is, the app's own address stands in. */
const whoWeAre = env => `Rooms/1.0 (${(env.CONTACT || (env.ORIGIN || "").split(",")[0] || "").trim() || "no contact set"})`;
async function openLibrary(url, env, ctx, cors) {
  const up = "https://openlibrary.org" + url.pathname.replace(/^\/ol/, "") + url.search;
  const res = await cached(up, ctx, CACHE.ol, () => fetch(up, { headers: { "User-Agent": whoWeAre(env) } }));
  return withCors(res, cors);
}

/* the series a book belongs to, from Wikidata, by the Open Library work id it keeps
   (P648). Only the id comes from the app; the query is written here, so this can't be
   used to ask Wikidata anything else. Asked through here so Wikidata never sees who's
   reading, and cached for a week because series don't change often. */
async function wikidataSeries(url, env, ctx, cors) {
  const ol = (url.searchParams.get("ol") || "").toUpperCase();
  if (!/^OL\d{1,12}W$/.test(ol)) return json({ error: "needs an Open Library work id" }, 400, cors);
  const sparql = `SELECT ?series ?seriesLabel ?part ?partLabel ?ord ?date ?ol WHERE {
    ?book wdt:P648 "${ol}" . ?book wdt:P179 ?series .
    ?part p:P179 ?st . ?st ps:P179 ?series . OPTIONAL { ?st pq:P1545 ?ord . }
    OPTIONAL { ?part wdt:P577 ?date . } OPTIONAL { ?part wdt:P648 ?ol . FILTER(STRENDS(?ol, "W")) }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 120`;
  const up = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(sparql);
  const res = await cached(up, ctx, CACHE.wd, () => fetch(up, { headers: { "User-Agent": whoWeAre(env), Accept: "application/sparql-results+json" } }));
  return withCors(res, cors);
}

/* igdb: swap the client credentials for a token, keep it in the cache api until it expires */
async function igdbToken(env) {
  const cache = caches.default;
  const key = new Request("https://igdb.token/internal");
  const hit = await cache.match(key);
  if (hit) return (await hit.json()).access_token;
  const r = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.IGDB_CLIENT_ID,
      client_secret: env.IGDB_CLIENT_SECRET,
      grant_type: "client_credentials"
    })
  });
  if (!r.ok) throw new Error("igdb auth " + r.status);
  const tok = await r.json();
  const keep = new Response(JSON.stringify(tok), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${Math.max(60, (tok.expires_in || 3600) - 300)}` }
  });
  await cache.put(key, keep);
  return tok.access_token;
}

async function igdb(request, url, env, ctx, cors) {
  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET)
    return json({ error: "no IGDB_CLIENT_ID / IGDB_CLIENT_SECRET set" }, 500, cors);
  if (request.method !== "POST") return json({ error: "igdb wants POST with an apicalypse body" }, 405, cors);
  const endpoint = url.pathname.replace(/^\/igdb\//, "");
  if (!IGDB_OK.has(endpoint)) return json({ error: "not a lookup this app makes" }, 404, cors);
  const body = await request.text();
  if (body.length > 2000) return json({ error: "too long" }, 413, cors);
  /* IGDB allows four requests a second across everybody using the app, so the same question
     is answered from memory, and a "too many" gets one polite retry rather than an error */
  const key = "https://igdb.cache/" + endpoint + "?q=" + encodeURIComponent(body);
  const res = await cached(key, ctx, CACHE.igdb, async () => {
    const token = await igdbToken(env);
    const ask = () => fetch("https://api.igdb.com/v4/" + endpoint, {
      method: "POST",
      headers: { "Client-ID": env.IGDB_CLIENT_ID, "Authorization": "Bearer " + token, "Content-Type": "text/plain" },
      body
    });
    let r = await ask();
    if (r.status === 429) { await new Promise(go => setTimeout(go, 350)); r = await ask(); }
    return r; });
  return withCors(res, cors);
}

function withCors(res, cors) {
  const out = new Response(res.body, res);
  Object.entries(cors).forEach(([k, v]) => out.headers.set(k, v));
  return out;
}


/* ---------- invites with a name on them ----------
   A chat app shows whatever the page at a link says about itself, and it never runs the
   app's code — so a link straight to the app shows "Rooms" and nothing else. This page
   says which room (from peek_room, the same look the sign-in screen gets), then forwards the person to the app with the code. */
const SUPABASE_URL = "https://caaxycmobhssxclrakim.supabase.co";
const SUPABASE_ANON = "sb_publishable_zvZhatlvUg6F_CDzTmxX9A_Vlv0n3PX";   /* the public key, same as the app's */
const escHTML = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);
async function invitePage(request, url, env) {
  const [, , code = "", ...rest] = url.pathname.split("/");
  const clean = code.replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
  const home = (env.ORIGIN || "").split(",")[0].trim();
  /* only ever onward to the app's own origin, with a path that's just a path */
  const path = ("/" + rest.join("/").replace(/[^A-Za-z0-9._\/-]/g, "")).replace(/\/{2,}/g, "/");
  const to = `${home}${path}#join=${clean}`;
  let room = null;
  if (request.method !== "HEAD" && clean !== "PING") try { const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/peek_room`, { method:"POST",
      headers:{ "Content-Type":"application/json", apikey:env.SUPABASE_ANON || SUPABASE_ANON, Authorization:`Bearer ${env.SUPABASE_ANON || SUPABASE_ANON}` },
      body:JSON.stringify({ p_code:clean }) });
    if (r.ok) room = (await r.json())[0] || null; } catch {}
  const title = room ? `Come into ${room.name}` : "You're invited to a room";
  const names = room ? (room.handles || []).slice(0, 3) : [];
  const desc = room ? `${names.length ? names.join(", ") + (room.members > names.length ? ` and ${room.members - names.length} more` : "") + (room.members === 1 ? " is" : " are") + " in here" : "A small room"}, logging what they watch, read and play. Tap to come in.`
    : "A small room of friends logging what they watch, read and play. Tap to come in.";
  /* the room's latest cover when it has one — a poster says "these people are into
     things" better than a logo does — and the app's own card when it doesn't */
  const cover = (room?.covers || []).find(c => /^https:\/\/(image\.tmdb\.org|images\.igdb\.com|covers\.openlibrary\.org)\//.test(c));
  const img = cover ? cover.replace("/t/p/w342/", "/t/p/w780/") : `${home}${path.replace(/[^/]*$/, "")}icons/og.png`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHTML(title)} · Rooms</title>
<meta property="og:type" content="website"><meta property="og:site_name" content="Rooms">
<meta property="og:title" content="${escHTML(title)}"><meta property="og:description" content="${escHTML(desc)}">
<meta property="og:image" content="${escHTML(img)}">${cover ? "" : `<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`}
<meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#16131C">
<meta http-equiv="refresh" content="0;url=${escHTML(to)}">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#16131C;color:#F4EDE2;font:600 16px system-ui,sans-serif;text-align:center;padding:24px}a{color:#FFE066}</style>
</head><body><p>${escHTML(title)}…<br><a href="${escHTML(to)}">Open Rooms</a></p>
<script>location.replace(${JSON.stringify(to).replace(/</g, "\\u003c")})</script></body></html>`;
  /* a public page, so anyone may look — the app checks it's there before using it */
  return new Response(request.method === "HEAD" ? null : html, { headers:{ "Content-Type":"text/html; charset=utf-8", "Cache-Control":"public, max-age=300", "Access-Control-Allow-Origin":"*" } });
}

/* ---------- a shared Five Clues or stack ----------
   The same as an invite: a page a chat app can read for its preview, that sends a person
   straight on to the app. /c/<medium> is today's Five Clues; /s/<id> is a stack, with its
   name, who made it and its first poster. */
async function sharePage(request, url, env) {
  const [, kindOf, raw = "", ...rest] = url.pathname.split("/");
  const home = (env.ORIGIN || "").split(",")[0].trim();
  const path = ("/" + rest.join("/").replace(/[^A-Za-z0-9._\/-]/g, "")).replace(/\/{2,}/g, "/");
  let title, desc, img = `${home}${path.replace(/[^/]*$/, "")}icons/og.png`, to, cover = null;
  if (kindOf === "c") { const k = ["film", "tv", "book", "game"].includes(raw) ? raw : "any";
    const what = { film:"film", tv:"show", book:"book", game:"game", any:"film, show, book or game" }[k];
    title = "Five Clues · Rooms"; desc = `Can you guess today's ${what} in five clues? One a day, the same for everyone.`;
    to = `${home}${path}#clues${k === "any" ? "" : "-" + k}`; }
  else { const id = decodeURIComponent(raw).replace(/[^\w:-]/g, "").slice(0, 60);
    to = `${home}${path}#stack=${id}`; title = "A stack on Rooms"; desc = "Films, shows, books and games, stacked by someone on Rooms.";
    if (/^[0-9a-f-]{36}$/.test(id) && request.method !== "HEAD") try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/peek_stack`, { method:"POST",
        headers:{ "Content-Type":"application/json", apikey:env.SUPABASE_ANON || SUPABASE_ANON, Authorization:`Bearer ${env.SUPABASE_ANON || SUPABASE_ANON}` },
        body:JSON.stringify({ p_id:id }) });
      const st = r.ok ? (await r.json())[0] : null;
      if (st) { title = st.title; desc = `A stack of ${st.n} by ${st.handle} on Rooms${st.note ? ` — ${st.note}` : ""}`;
        cover = (st.covers || []).find(c => /^https:\/\/(image\.tmdb\.org|images\.igdb\.com|covers\.openlibrary\.org)\//.test(c)); } } catch {}
    if (cover) img = cover.replace("/t/p/w342/", "/t/p/w780/"); }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHTML(title)}</title>
<meta property="og:type" content="website"><meta property="og:site_name" content="Rooms">
<meta property="og:title" content="${escHTML(title)}"><meta property="og:description" content="${escHTML(desc)}">
<meta property="og:image" content="${escHTML(img)}">${cover ? "" : `<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`}
<meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#16131C">
<meta http-equiv="refresh" content="0;url=${escHTML(to)}">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#16131C;color:#F4EDE2;font:600 16px system-ui,sans-serif;text-align:center;padding:24px}a{color:#FFE066}</style>
</head><body><p>${escHTML(title)}…<br><a href="${escHTML(to)}">Open Rooms</a></p>
<script>location.replace(${JSON.stringify(to).replace(/</g, "\\u003c")})</script></body></html>`;
  return new Response(request.method === "HEAD" ? null : html, { headers:{ "Content-Type":"text/html; charset=utf-8", "Cache-Control":"public, max-age=300", "Access-Control-Allow-Origin":"*" } });
}

/* ---------- a public profile page ----------
   A real page this time, not a stop on the way to the app: somebody's favourites, top
   five and what they've logged lately, for a link in a bio. public_profile only answers
   if they switched it on, and never with anything set to just them or room only. */
const APP_HOME = "https://dontdateleos.github.io/Rooms/";
const COVER_OK = /^https:\/\/(image\.tmdb\.org|images\.igdb\.com|covers\.openlibrary\.org)\//;
const okCover = c => typeof c === "string" && COVER_OK.test(c) ? c : null;
/* the app's avatar colours, in the app's order (profiles.avatar.col indexes these) */
const AV_COLS = ["#FFB36B", "#FF8E6E", "#F5A3C7", "#FFE86A", "#9EF0C9", "#8FD3FF", "#B9A6FF", "#7A7590", "#151320"];
const KIND = { film:{ one:"film", many:"films", label:"Film", c:"#FFB36B" }, tv:{ one:"show", many:"shows", label:"TV", c:"#F5A3C7" },
  book:{ one:"book", many:"books", label:"Book", c:"#FFE066" }, game:{ one:"game", many:"games", label:"Game", c:"#9EF0C9" } };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

async function profilePage(request, url, env) {
  let handle = ""; try { handle = decodeURIComponent(url.pathname.split("/")[2] || ""); } catch {}
  handle = handle.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);
  let d = null, failed = false;
  if (handle.length >= 2) try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/public_profile`, { method:"POST",
      headers:{ "Content-Type":"application/json", apikey:env.SUPABASE_ANON || SUPABASE_ANON, Authorization:`Bearer ${env.SUPABASE_ANON || SUPABASE_ANON}` },
      body:JSON.stringify({ p_handle:handle }) });
    if (r.ok) d = await r.json(); else failed = true; } catch { failed = true; }
  const found = !!(d && d.handle);
  const html = found ? profileHTML(d, `${url.origin}/u/${d.handle}`) : notPublicHTML(failed);
  /* short-lived, so switching the page off takes effect within a couple of minutes */
  return new Response(request.method === "HEAD" ? null : html, { status:found ? 200 : failed ? 503 : 404,
    headers:{ "Content-Type":"text/html; charset=utf-8", "Cache-Control":found ? "public, max-age=120" : "no-store" } });
}

const ROOMS_LOGO = `<svg viewBox="10 10 80 80" aria-hidden="true"><path d="M25.00 14.00L37.00 14.00L38.44 14.09L39.85 14.37L41.21 14.84L42.50 15.47L43.70 16.27L44.78 17.22L45.73 18.30L46.53 19.50L47.16 20.79L47.63 22.15L47.91 23.56L48.00 25.00L48.00 37.00L47.91 38.44L47.63 39.85L47.16 41.21L46.53 42.50L45.73 43.70L45.00 44.53L45.00 40.00L44.91 38.56L44.63 37.15L44.16 35.79L43.53 34.50L42.73 33.30L41.78 32.22L40.70 31.27L39.50 30.47L38.21 29.84L36.85 29.37L35.44 29.09L34.00 29.00L28.00 29.00L26.56 29.09L25.15 29.37L23.79 29.84L22.50 30.47L21.30 31.27L20.22 32.22L19.27 33.30L18.47 34.50L17.84 35.79L17.37 37.15L17.09 38.56L17.00 40.00L17.00 44.53L16.27 43.70L15.47 42.50L14.84 41.21L14.37 39.85L14.09 38.44L14.00 37.00L14.00 25.00L14.09 23.56L14.37 22.15L14.84 20.79L15.47 19.50L16.27 18.30L17.22 17.22L18.30 16.27L19.50 15.47L20.79 14.84L22.15 14.37L23.56 14.09Z" fill="#3a3445"/><path d="M18.30 45.73L17.22 44.78L17.00 44.53L17.00 40.00L17.09 38.56L17.37 37.15L17.84 35.79L18.47 34.50L19.27 33.30L20.22 32.22L21.30 31.27L22.50 30.47L23.79 29.84L25.15 29.37L26.56 29.09L28.00 29.00L34.00 29.00L34.81 29.05L34.81 29.05L35.16 29.75L35.48 30.47L35.77 31.22L36.03 31.98L36.27 32.78L36.48 33.60L36.66 34.44L36.81 35.30L36.94 36.19L37.03 37.11L37.10 38.05L37.15 39.01L37.16 40.00L37.16 47.99L37.00 48.00L25.00 48.00L23.56 47.91L22.15 47.63L20.79 47.16L19.50 46.53Z" fill="#F4EDE2"/><path d="M38.44 47.91L37.16 47.99L37.16 40.00L37.15 39.01L37.10 38.05L37.03 37.11L36.94 36.19L36.81 35.30L36.66 34.44L36.48 33.60L36.27 32.78L36.03 31.98L35.77 31.22L35.48 30.47L35.16 29.75L34.81 29.05L34.81 29.05L35.44 29.09L36.85 29.37L38.21 29.84L39.50 30.47L40.70 31.27L41.78 32.22L42.73 33.30L43.53 34.50L44.16 35.79L44.63 37.15L44.91 38.56L45.00 40.00L45.00 44.53L44.78 44.78L43.70 45.73L42.50 46.53L41.21 47.16L39.85 47.63Z" fill="#d9cbb9"/><rect class="eye" x="27.80" y="33.50" width="4.4" height="9" rx="2.2" fill="#151320"/><rect class="eye" x="35.80" y="33.50" width="4.4" height="9" rx="2.2" fill="#151320"/><path d="M63.00 14.00L75.00 14.00L76.44 14.09L77.85 14.37L79.21 14.84L80.50 15.47L81.70 16.27L82.78 17.22L83.73 18.30L84.53 19.50L85.16 20.79L85.63 22.15L85.91 23.56L86.00 25.00L86.00 37.00L85.91 38.44L85.63 39.85L85.16 41.21L84.53 42.50L83.73 43.70L83.00 44.53L83.00 40.00L82.91 38.56L82.63 37.15L82.16 35.79L81.53 34.50L80.73 33.30L79.78 32.22L78.70 31.27L77.50 30.47L76.21 29.84L74.85 29.37L73.44 29.09L72.00 29.00L66.00 29.00L64.56 29.09L63.15 29.37L61.79 29.84L60.50 30.47L59.30 31.27L58.22 32.22L57.27 33.30L56.47 34.50L55.84 35.79L55.37 37.15L55.09 38.56L55.00 40.00L55.00 44.53L54.27 43.70L53.47 42.50L52.84 41.21L52.37 39.85L52.09 38.44L52.00 37.00L52.00 25.00L52.09 23.56L52.37 22.15L52.84 20.79L53.47 19.50L54.27 18.30L55.22 17.22L56.30 16.27L57.50 15.47L58.79 14.84L60.15 14.37L61.56 14.09Z" fill="#3a3445"/><path d="M56.30 45.73L55.22 44.78L55.00 44.53L55.00 40.00L55.09 38.56L55.37 37.15L55.84 35.79L56.47 34.50L57.27 33.30L58.22 32.22L59.30 31.27L60.50 30.47L61.79 29.84L63.15 29.37L64.56 29.09L66.00 29.00L72.00 29.00L72.81 29.05L72.81 29.05L73.16 29.75L73.48 30.47L73.77 31.22L74.03 31.98L74.27 32.78L74.48 33.60L74.66 34.44L74.81 35.30L74.94 36.19L75.03 37.11L75.10 38.05L75.15 39.01L75.16 40.00L75.16 47.99L75.00 48.00L63.00 48.00L61.56 47.91L60.15 47.63L58.79 47.16L57.50 46.53Z" fill="#F4EDE2"/><path d="M76.44 47.91L75.16 47.99L75.16 40.00L75.15 39.01L75.10 38.05L75.03 37.11L74.94 36.19L74.81 35.30L74.66 34.44L74.48 33.60L74.27 32.78L74.03 31.98L73.77 31.22L73.48 30.47L73.16 29.75L72.81 29.05L72.81 29.05L73.44 29.09L74.85 29.37L76.21 29.84L77.50 30.47L78.70 31.27L79.78 32.22L80.73 33.30L81.53 34.50L82.16 35.79L82.63 37.15L82.91 38.56L83.00 40.00L83.00 44.53L82.78 44.78L81.70 45.73L80.50 46.53L79.21 47.16L77.85 47.63Z" fill="#d9cbb9"/><rect class="eye" x="59.80" y="33.50" width="4.4" height="9" rx="2.2" fill="#151320"/><rect class="eye" x="67.80" y="33.50" width="4.4" height="9" rx="2.2" fill="#151320"/><path d="M25.00 52.00L37.00 52.00L38.44 52.09L39.85 52.37L41.21 52.84L42.50 53.47L43.70 54.27L44.78 55.22L45.73 56.30L46.53 57.50L47.16 58.79L47.63 60.15L47.91 61.56L48.00 63.00L48.00 75.00L47.91 76.44L47.63 77.85L47.16 79.21L46.53 80.50L45.73 81.70L45.00 82.53L45.00 78.00L44.91 76.56L44.63 75.15L44.16 73.79L43.53 72.50L42.73 71.30L41.78 70.22L40.70 69.27L39.50 68.47L38.21 67.84L36.85 67.37L35.44 67.09L34.00 67.00L28.00 67.00L26.56 67.09L25.15 67.37L23.79 67.84L22.50 68.47L21.30 69.27L20.22 70.22L19.27 71.30L18.47 72.50L17.84 73.79L17.37 75.15L17.09 76.56L17.00 78.00L17.00 82.53L16.27 81.70L15.47 80.50L14.84 79.21L14.37 77.85L14.09 76.44L14.00 75.00L14.00 63.00L14.09 61.56L14.37 60.15L14.84 58.79L15.47 57.50L16.27 56.30L17.22 55.22L18.30 54.27L19.50 53.47L20.79 52.84L22.15 52.37L23.56 52.09Z" fill="#3a3445"/><path d="M18.30 83.73L17.22 82.78L17.00 82.53L17.00 78.00L17.09 76.56L17.37 75.15L17.84 73.79L18.47 72.50L19.27 71.30L20.22 70.22L21.30 69.27L22.50 68.47L23.79 67.84L25.15 67.37L26.56 67.09L28.00 67.00L34.00 67.00L34.81 67.05L34.81 67.05L35.16 67.75L35.48 68.47L35.77 69.22L36.03 69.98L36.27 70.78L36.48 71.60L36.66 72.44L36.81 73.30L36.94 74.19L37.03 75.11L37.10 76.05L37.15 77.01L37.16 78.00L37.16 85.99L37.00 86.00L25.00 86.00L23.56 85.91L22.15 85.63L20.79 85.16L19.50 84.53Z" fill="#F4EDE2"/><path d="M38.44 85.91L37.16 85.99L37.16 78.00L37.15 77.01L37.10 76.05L37.03 75.11L36.94 74.19L36.81 73.30L36.66 72.44L36.48 71.60L36.27 70.78L36.03 69.98L35.77 69.22L35.48 68.47L35.16 67.75L34.81 67.05L34.81 67.05L35.44 67.09L36.85 67.37L38.21 67.84L39.50 68.47L40.70 69.27L41.78 70.22L42.73 71.30L43.53 72.50L44.16 73.79L44.63 75.15L44.91 76.56L45.00 78.00L45.00 82.53L44.78 82.78L43.70 83.73L42.50 84.53L41.21 85.16L39.85 85.63Z" fill="#d9cbb9"/><rect class="eye" x="27.80" y="71.50" width="4.4" height="9" rx="2.2" fill="#151320"/><rect class="eye" x="35.80" y="71.50" width="4.4" height="9" rx="2.2" fill="#151320"/><path d="M63.00 52.00L75.00 52.00L76.44 52.09L77.85 52.37L79.21 52.84L80.50 53.47L81.70 54.27L82.78 55.22L83.73 56.30L84.53 57.50L85.16 58.79L85.63 60.15L85.91 61.56L86.00 63.00L86.00 75.00L85.91 76.44L85.63 77.85L85.16 79.21L84.53 80.50L83.73 81.70L83.00 82.53L83.00 78.00L82.91 76.56L82.63 75.15L82.16 73.79L81.53 72.50L80.73 71.30L79.78 70.22L78.70 69.27L77.50 68.47L76.21 67.84L74.85 67.37L73.44 67.09L72.00 67.00L66.00 67.00L64.56 67.09L63.15 67.37L61.79 67.84L60.50 68.47L59.30 69.27L58.22 70.22L57.27 71.30L56.47 72.50L55.84 73.79L55.37 75.15L55.09 76.56L55.00 78.00L55.00 82.53L54.27 81.70L53.47 80.50L52.84 79.21L52.37 77.85L52.09 76.44L52.00 75.00L52.00 63.00L52.09 61.56L52.37 60.15L52.84 58.79L53.47 57.50L54.27 56.30L55.22 55.22L56.30 54.27L57.50 53.47L58.79 52.84L60.15 52.37L61.56 52.09Z" fill="#3a3445"/><path d="M56.30 83.73L55.22 82.78L55.00 82.53L55.00 78.00L55.09 76.56L55.37 75.15L55.84 73.79L56.47 72.50L57.27 71.30L58.22 70.22L59.30 69.27L60.50 68.47L61.79 67.84L63.15 67.37L64.56 67.09L66.00 67.00L72.00 67.00L72.81 67.05L72.81 67.05L73.16 67.75L73.48 68.47L73.77 69.22L74.03 69.98L74.27 70.78L74.48 71.60L74.66 72.44L74.81 73.30L74.94 74.19L75.03 75.11L75.10 76.05L75.15 77.01L75.16 78.00L75.16 85.99L75.00 86.00L63.00 86.00L61.56 85.91L60.15 85.63L58.79 85.16L57.50 84.53Z" fill="#F4EDE2"/><path d="M76.44 85.91L75.16 85.99L75.16 78.00L75.15 77.01L75.10 76.05L75.03 75.11L74.94 74.19L74.81 73.30L74.66 72.44L74.48 71.60L74.27 70.78L74.03 69.98L73.77 69.22L73.48 68.47L73.16 67.75L72.81 67.05L72.81 67.05L73.44 67.09L74.85 67.37L76.21 67.84L77.50 68.47L78.70 69.27L79.78 70.22L80.73 71.30L81.53 72.50L82.16 73.79L82.63 75.15L82.91 76.56L83.00 78.00L83.00 82.53L82.78 82.78L81.70 83.73L80.50 84.53L79.21 85.16L77.85 85.63Z" fill="#d9cbb9"/><rect class="eye" x="59.80" y="71.50" width="4.4" height="9" rx="2.2" fill="#151320"/><rect class="eye" x="67.80" y="71.50" width="4.4" height="9" rx="2.2" fill="#151320"/></svg>`;
const PROFILE_CSS = `:root{--ground:#16131C;--card:#221E2D;--ink:#F4EDE2;--soft:#D9D2C6;--mute:#A099B4;--on:#151320;--paper:#FFF7EC;
--butter:#FFE066;--pink:#F5A3C7;--mint:#9EF0C9;--sky:#8FD3FF;--lilac:#B99CFF;--apricot:#FFB36B;
--head:Outfit,"Avenir Next",system-ui,sans-serif;--body:Inter,system-ui,-apple-system,sans-serif;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font:400 16px/1.5 var(--body);-webkit-font-smoothing:antialiased;overflow-x:clip}
a{color:inherit}
.wrap{max-width:640px;margin:0 auto;padding:0 max(18px,env(safe-area-inset-right)) 0 max(18px,env(safe-area-inset-left))}
h1,h2,h3{font-family:var(--head);font-weight:900;letter-spacing:-.035em;line-height:1;margin:0}
p{margin:0}
.top{display:flex;align-items:center;justify-content:space-between;height:62px;padding-top:env(safe-area-inset-top)}
.logo{display:flex;align-items:center;gap:9px;font:900 21px var(--head);letter-spacing:-.03em;text-decoration:none}
.logo svg{width:30px;height:30px}
.btn{display:inline-flex;align-items:center;justify-content:center;font:800 16px var(--head);padding:14px 22px;border-radius:999px;background:var(--on);color:var(--paper);text-decoration:none;transition:transform .15s}
.btn:hover{transform:translateY(-2px)}
.btn.sm{padding:9px 16px;font-size:14px;background:var(--butter);color:var(--on)}
.btn.line{background:transparent;color:var(--on);box-shadow:inset 0 0 0 2px rgba(21,19,32,.4)}
a:focus-visible{outline:3px solid var(--butter);outline-offset:3px}
.hero{text-align:center;padding:18px 0 4px}
.av{width:104px;height:104px;border-radius:50%;background:var(--a);margin:0 auto 16px;display:flex;align-items:center;justify-content:center;gap:13px;
  box-shadow:inset 0 -10px 0 rgba(0,0,0,.12),inset 0 8px 0 rgba(255,255,255,.18),0 14px 34px rgba(0,0,0,.4)}
.av.dark{box-shadow:0 0 0 2px #3A3650,0 14px 34px rgba(0,0,0,.4)}
.av i{width:10px;height:28px;border-radius:6px;background:var(--e)}
.av i+i{height:31px;margin-top:-5px}
.hero h1{font-size:clamp(40px,13vw,64px);overflow-wrap:anywhere}
.bio{margin:12px auto 0;max-width:30ch;color:var(--soft);font-size:17px;overflow-wrap:anywhere}
.since{margin-top:10px;color:var(--mute);font-size:14px}
section{margin-top:32px}
.lbl{font:800 12.5px var(--head);letter-spacing:.09em;text-transform:uppercase;color:var(--mute);margin:0 0 12px}
.tally{display:grid;grid-template-columns:repeat(auto-fit,minmax(68px,1fr));gap:8px}
.tally div{background:var(--c);color:var(--on);border-radius:18px;padding:13px 12px 11px}
.tally div:nth-child(odd){rotate:-1.2deg}.tally div:nth-child(even){rotate:1deg}
.tally b{display:block;font:900 32px/1 var(--head);letter-spacing:-.03em}
.tally span{font:800 13px var(--head)}
.po{display:block;position:relative;aspect-ratio:2/3;border-radius:12px;overflow:hidden;background:var(--c,#2C2738);box-shadow:0 10px 24px rgba(0,0,0,.35)}
.po img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.po span{position:absolute;left:0;right:0;bottom:0;padding:7px;color:var(--on);font:900 12px/1.1 var(--head);overflow-wrap:break-word;hyphens:auto}
.favs{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.favs figure{margin:0;min-width:0}
.favs figcaption{display:inline-block;margin-top:8px;font:800 11.5px var(--head);background:var(--c);color:var(--on);padding:3px 9px;border-radius:99px}
.five{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
.five li{position:relative;min-width:0}
.five b{position:absolute;left:-5px;top:-8px;z-index:1;width:26px;height:26px;border-radius:50%;background:var(--butter);color:var(--on);display:grid;place-items:center;font:900 14px var(--head);box-shadow:0 4px 10px rgba(0,0,0,.35)}
.five .po{border-radius:10px}
.five small{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-top:7px;font:700 12px/1.2 var(--head);color:var(--soft)}
.log{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.log li{display:grid;grid-template-columns:56px 1fr auto;gap:13px;align-items:start;background:var(--card);border-radius:18px;padding:10px 12px 10px 10px}
.log .po{border-radius:8px;box-shadow:none}
.log h3{font:800 16.5px/1.2 var(--head);letter-spacing:-.015em;margin-top:2px;overflow-wrap:anywhere}
.log .yr{color:var(--mute);font-weight:600;font-size:14px;letter-spacing:0}
.st{display:flex;align-items:center;gap:7px;margin-top:4px;color:var(--butter);font-size:15px;letter-spacing:1px;line-height:1}
.st i{width:8px;height:8px;border-radius:50%;background:var(--c);flex:none}
.log p{margin-top:6px;font-size:14px;line-height:1.45;color:var(--soft);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.sp{display:inline-block;background:rgba(244,237,226,.13);color:var(--mute);border-radius:6px;padding:0 7px;font:700 12px/1.6 var(--head);vertical-align:1px}
.log time{font:700 12px var(--head);color:var(--mute);white-space:nowrap;margin-top:3px}
.empty{color:var(--mute);text-align:center;margin-top:28px}
.cta{background:var(--butter);color:var(--on);border-radius:28px;padding:26px 22px 24px;margin-top:38px;rotate:-.6deg}
.cta h2{font-size:clamp(30px,8.5vw,42px)}
.mk{display:inline-block;background:var(--pink);border-radius:.16em;padding:.03em .1em .06em;rotate:-2deg;line-height:.95}
.cta p{margin:12px 0 18px;font-size:16px;max-width:40ch}
.btns{display:flex;flex-wrap:wrap;gap:10px}
footer{padding:30px 0 calc(34px + env(safe-area-inset-bottom));color:var(--mute);font-size:12.5px;text-align:center;line-height:1.6}
footer a{text-decoration:none;font-weight:600}
.gone{min-height:72vh;display:grid;place-content:center;text-align:center;gap:14px;padding:20px 0}
.gone h1{font-size:clamp(36px,11vw,56px)}
.gone p{color:var(--soft);max-width:32ch;margin:0 auto}
.gone .btns{justify-content:center;margin-top:8px}
.gone .btn{background:var(--butter);color:var(--on)}
@media (prefers-reduced-motion:reduce){.btn{transition:none}}`;

function profileShell({ title, desc, img, canonical, body, noindex, ld }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escHTML(title)}</title><meta name="description" content="${escHTML(desc)}">${noindex ? `<meta name="robots" content="noindex">` : ""}
${canonical ? `<link rel="canonical" href="${escHTML(canonical)}"><meta property="og:url" content="${escHTML(canonical)}">` : ""}
<meta property="og:type" content="profile"><meta property="og:site_name" content="Rooms">
<meta property="og:title" content="${escHTML(title)}"><meta property="og:description" content="${escHTML(desc)}">
<meta property="og:image" content="${escHTML(img)}"><meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#16131C"><link rel="icon" href="${APP_HOME}icons/rooms-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@700;800;900&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
${ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>` : ""}
<style>${PROFILE_CSS}</style></head><body><div class="wrap">
<header class="top"><a class="logo" href="${APP_HOME}" aria-label="Rooms">${ROOMS_LOGO}Rooms</a><a class="btn sm" href="${APP_HOME}">Get Rooms</a></header>
${body}
<footer>Rooms · <a href="${APP_HOME}privacy.html">Privacy</a><br>Film and TV covers from TMDB · game covers from IGDB · book covers from Open Library</footer>
</div></body></html>`;
}

/* a poster: the cover when there's a safe one, a coloured card with the title when not */
function posterHTML(w, lazy = true) {
  const c = okCover(w.cover), k = KIND[w.kind];
  /* the title card sits underneath, so a cover that fails to load just leaves it showing */
  return `<span class="po" style="--c:${k ? k.c : "#2C2738"}"><span${c ? ` aria-hidden="true"` : ""}>${escHTML(w.title)}</span>${c ? `<img src="${escHTML(c)}" alt="${escHTML(w.title)}"${lazy ? ` loading="lazy"` : ""} decoding="async" onerror="this.remove()">` : ""}</span>`;
}
const starsText = s => { const n = Math.max(0, Math.min(10, Math.round(+s || 0))); return "★".repeat(n >> 1) + (n & 1 ? "½" : ""); };
/* spoilers are cut out in the database already; this catches anything that slipped by */
function noteLine(t) {
  let s = String(t || "").replace(/\|\|[\s\S]+?\|\|/g, "[spoiler]").replace(/\s+/g, " ").trim();
  if (s.length > 170) s = s.slice(0, 165).replace(/\s+\S*$/, "") + "…";
  return escHTML(s).replace(/\[spoiler\]/g, `<span class="sp">spoiler</span>`);
}
function dayText(s, year) {
  const [y, m, d] = String(s || "").split("-").map(Number);
  if (!y || !m || !d) return "";
  return `${d} ${MONTHS[m - 1]}${y !== year ? ` ${y}` : ""}`;
}
const listWords = xs => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

function profileHTML(d, canonical) {
  const handle = String(d.handle), year = +d.year || new Date().getUTCFullYear();
  const favs = (d.favourites || []).filter(w => w && w.title).slice(0, 4);
  const top = (d.top || []).filter(w => w && w.title).slice(0, 5);
  const recent = (d.recent || []).filter(w => w && w.title).slice(0, 12);
  const counts = d.counts || {};
  /* their own colour if they picked one, else the one the app makes from their handle */
  const colour = AV_COLS[Number.isInteger(d.colour) && AV_COLS[d.colour] ? d.colour : (avHash(handle) >> 3) % AV_COLS.length];
  const dark = colour === "#151320";
  const tally = Object.keys(KIND).filter(k => +counts[k] > 0)
    .map(k => `<div style="--c:${KIND[k].c}"><b>${+counts[k]}</b><span>${+counts[k] === 1 ? KIND[k].one : KIND[k].many}</span></div>`);
  const yearWords = Object.keys(KIND).filter(k => +counts[k] > 0).map(k => `${+counts[k]} ${+counts[k] === 1 ? KIND[k].one : KIND[k].many}`);
  const [sy, sm] = String(d.since || "").split("-").map(Number);
  const since = sy && sm ? `On Rooms since ${MONTHS_LONG[sm - 1]} ${sy}` : "On Rooms";
  const logged = +d.logged || 0;

  const lead = favs[0] || top[0] || recent[0];
  const cover = lead && okCover(lead.cover);
  const img = cover ? cover.replace("/t/p/w342/", "/t/p/w780/") : `${APP_HOME}icons/og.png`;
  const title = `${handle} on Rooms`;
  const desc = (d.bio ? `${String(d.bio).trim()} · ` : "")
    + (favs.length ? `Favourites: ${listWords(favs.map(w => w.title))}. ` : "")
    + (yearWords.length ? `${listWords(yearWords)} logged in ${year}. ` : "")
    + `See what ${handle} watches, reads and plays on Rooms.`;

  const body = `<main>
<section class="hero" style="margin-top:0">
  <div class="av${dark ? " dark" : ""}" style="--a:${colour};--e:${dark ? "#FFF7EC" : "#151320"}" aria-hidden="true"><i></i><i></i></div>
  <h1>${escHTML(handle)}</h1>
  ${d.bio ? `<p class="bio">${escHTML(d.bio)}</p>` : ""}
  <p class="since">${since}${logged ? ` · ${logged} logged` : ""}</p>
</section>
${tally.length ? `<section><h2 class="lbl">${year} so far</h2><div class="tally">${tally.join("")}</div></section>` : ""}
${favs.length ? `<section><h2 class="lbl">Favourites</h2><div class="favs">${favs.map(w =>
  `<figure>${posterHTML(w, false)}<figcaption style="--c:${KIND[w.kind]?.c || "#A099B4"}">${escHTML(KIND[w.kind]?.label || "")}</figcaption></figure>`).join("")}</div></section>` : ""}
${top.length ? `<section><h2 class="lbl">Top ${top.length === 5 ? "five" : top.length}</h2><ol class="five">${top.map((w, i) =>
  `<li><b>${i + 1}</b>${posterHTML(w)}<small>${escHTML(w.title)}</small></li>`).join("")}</ol></section>` : ""}
${recent.length ? `<section><h2 class="lbl">Recently</h2><ul class="log">${recent.map(w => `<li>${posterHTML(w)}<div>
  <h3>${escHTML(w.title)}${w.year ? ` <span class="yr">${escHTML(String(w.year).slice(0, 4))}</span>` : ""}</h3>
  <div class="st" style="--c:${KIND[w.kind]?.c || "#A099B4"}"><i title="${escHTML(KIND[w.kind]?.label || "")}"></i><span aria-label="${(Math.round(+w.score || 0) / 2)} stars">${starsText(w.score)}</span></div>
  ${w.note ? `<p>${noteLine(w.note)}</p>` : ""}</div><time datetime="${escHTML(w.on)}">${dayText(w.on, year)}</time></li>`).join("")}</ul></section>`
  : `<p class="empty">Nothing logged here yet.</p>`}
<section class="cta">
  <h2>Keep a log with <span class="mk">your people</span></h2>
  <p>${escHTML(handle)} logs what they watch, read and play on Rooms. Start yours with the few friends whose taste you trust. Free on iPhone and the web.</p>
  <div class="btns"><a class="btn" href="${APP_HOME}">Get Rooms</a><a class="btn line" href="${APP_HOME}#u=${escHTML(handle)}">Open in Rooms</a></div>
</section>
</main>`;
  const ld = { "@context":"https://schema.org", "@type":"ProfilePage", url:canonical,
    mainEntity:{ "@type":"Person", name:handle, alternateName:"@" + handle, ...(d.bio ? { description:String(d.bio) } : {}) } };
  return profileShell({ title, desc, img, canonical, body, ld });
}

function notPublicHTML(failed) {
  const title = failed ? "Couldn't load this page" : "This page isn't public";
  const line = failed ? "Rooms didn't answer just then. Try again in a minute."
    : "Whoever's page this is hasn't made it public, or there's nobody by that name.";
  const body = `<main class="gone"><h1>${title}</h1><p>${line}</p>
<p>Rooms is where small groups of friends log the films, shows, books and games they finish.</p>
<div class="btns"><a class="btn" href="${APP_HOME}">Get Rooms</a></div></main>`;
  return profileShell({ title:`${title} · Rooms`, desc:"Rooms: log films, shows, books and games with the few people whose taste you trust.",
    img:`${APP_HOME}icons/og.png`, body, noindex:true });
}

/* ---------- notifications ----------
   Web push, done by hand with the platform's own crypto (RFC 8291 for the message,
   RFC 8292 for who's sending). The sender's own sign-in asks the database who may be
   told, so this worker can only reach people the sender already shares a room with. */
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };
const enc = s => new TextEncoder().encode(s);
async function hkdf(salt, ikm, info, bytes) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name:"HKDF", hash:"SHA-256", salt, info }, k, bytes * 8)); }
let vapidKey = null;
async function vapidJWT(env, endpoint) {
  if (!vapidKey) { const pub = unb64u(env.VAPID_PUBLIC);
    vapidKey = await crypto.subtle.importKey("jwk", { kty:"EC", crv:"P-256", d:env.VAPID_PRIVATE, x:b64u(pub.slice(1, 33)), y:b64u(pub.slice(33, 65)), ext:true },
      { name:"ECDSA", namedCurve:"P-256" }, false, ["sign"]); }
  const head = b64u(enc(JSON.stringify({ typ:"JWT", alg:"ES256" })));
  const contact = (env.CONTACT || "").includes("@") ? `mailto:${env.CONTACT.trim()}` : ((env.ORIGIN || "").split(",")[0].trim() || "mailto:rooms@example.com");
  const body = b64u(enc(JSON.stringify({ aud:new URL(endpoint).origin, exp:Math.floor(Date.now() / 1000) + 12 * 3600, sub:contact })));
  const sig = await crypto.subtle.sign({ name:"ECDSA", hash:"SHA-256" }, vapidKey, enc(`${head}.${body}`));
  return `${head}.${body}.${b64u(sig)}`; }
async function encryptFor(sub, payload) {
  const uaPub = unb64u(sub.p256dh), authSecret = unb64u(sub.auth);
  const eph = await crypto.subtle.generateKey({ name:"ECDH", namedCurve:"P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const theirs = await crypto.subtle.importKey("raw", uaPub, { name:"ECDH", namedCurve:"P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name:"ECDH", public:theirs }, eph.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, cat(enc("WebPush: info\0"), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name:"AES-GCM", iv:nonce }, key, cat(enc(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);                       /* record size 4096 */
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, sealed); }
/* a sender who sends too much is told to wait, per copy of the worker — enough to stop a loop */
const SENT = new Map();
/* ---------- the iPhone app ----------
   The App Store app gets its notifications from Apple's push service rather than the web's.
   One key does it (Certificates, Identifiers & Profiles → Keys, with APNs ticked): the
   request is signed as the team with it, and addressed to the app's bundle id. A build run
   straight from Xcode talks to Apple's test service instead, so a token the live one doesn't
   recognise gets one more try there. */
let apnsTok = null;
async function apnsJWT(env) {
  if (apnsTok && Date.now() - apnsTok.at < 50 * 60e3) return apnsTok.v;    /* Apple wants a fresh one within the hour */
  const der = Uint8Array.from(atob(env.APNS_KEY_P8.replace(/-----[^-]+-----|\s/g, "")), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name:"ECDSA", namedCurve:"P-256" }, false, ["sign"]);
  const head = b64u(enc(JSON.stringify({ alg:"ES256", kid:env.APNS_KEY_ID })));
  const body = b64u(enc(JSON.stringify({ iss:appleTeam(env), iat:Math.floor(Date.now() / 1000) })));
  const sig = await crypto.subtle.sign({ name:"ECDSA", hash:"SHA-256" }, key, enc(`${head}.${body}`));
  apnsTok = { v:`${head}.${body}.${b64u(sig)}`, at:Date.now() }; return apnsTok.v; }
/* the team isn't a secret (it's printed in every app the team ships), so it has a default */
const appleTeam = env => env.APPLE_TEAM_ID || "M6AXSFYX2W";
const apnsReady = env => !!(env.APNS_KEY_P8 && env.APNS_KEY_ID);
async function apnsSend(env, token, note) {
  const body = JSON.stringify({ aps:{ alert:{ title:note.title, body:note.body }, sound:"default", ...(note.tag ? { "thread-id":note.tag } : {}) }, url:note.url || "" });
  for (const host of ["api.push.apple.com", "api.sandbox.push.apple.com"]) {
    const res = await fetch(`https://${host}/3/device/${token}`, { method:"POST", body, headers:{
      authorization:`bearer ${await apnsJWT(env)}`, "apns-topic":env.APNS_TOPIC || "com.touringgroup.rooms",
      "apns-push-type":"alert", "apns-expiration":String(Math.floor(Date.now() / 1000) + 86400),
      ...(note.tag ? { "apns-collapse-id":note.tag.slice(0, 64) } : {}) } });
    if (res.ok) return { ok:true };
    const reason = (await res.json().catch(() => ({}))).reason || "";
    if (reason === "BadDeviceToken" && host === "api.push.apple.com") continue;
    if (reason === "ExpiredProviderToken") apnsTok = null;
    return { ok:false, gone:res.status === 410 || reason === "Unregistered" || reason === "BadDeviceToken" }; }
  return { ok:false }; }

async function pushSend(request, env, ctx, cors) {
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE || !env.SUPABASE_SERVICE_KEY) return json({ error:"notifications aren't set up on the worker" }, 501, cors);
  const auth = request.headers.get("Authorization") || "";
  if (!/^Bearer [\w.-]+$/.test(auth)) return json({ error:"sign in first" }, 401, cors);
  const b = await request.json().catch(() => ({}));
  const clip = (s, n) => String(s || "").slice(0, n);
  /* the tap only ever opens the app: a path and a #room link, never another site */
  const home = (env.ORIGIN || "").split(",")[0].trim();
  let url = ""; try { const u = new URL(clip(b.url, 300)); if (u.origin === home) url = u.pathname + u.hash.replace(/[^\w#=&-]/g, ""); } catch {}
  const note = { title:clip(b.title, 80) || "Rooms", body:clip(b.body, 180), url, tag:clip(b.tag, 60) };
  if (!b.room && !b.to) return json({ error:"who to?" }, 400, cors);
  const who = auth.slice(-40), now = Date.now(), log = (SENT.get(who) || []).filter(t => now - t < 10 * 60e3);
  if (log.length >= 20) return json({ error:"slow down" }, 429, cors);
  SENT.set(who, [...log, now]); if (SENT.size > 2000) SENT.delete(SENT.keys().next().value);
  /* who's sending, from Supabase itself — not from anything the request says */
  const anon = env.SUPABASE_ANON || SUPABASE_ANON;
  const meR = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers:{ apikey:anon, Authorization:auth } });
  if (!meR.ok) return json({ error:"sign in again" }, 401, cors);
  const sender = (await meR.json())?.id; if (!sender) return json({ error:"sign in again" }, 401, cors);
  const svc = env.SUPABASE_SERVICE_KEY;
  const rpc = (fn, args) => fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method:"POST",
    headers:{ "Content-Type":"application/json", apikey:svc, Authorization:`Bearer ${svc}` }, body:JSON.stringify(args) });
  /* "activity" (somebody finished something) and "reminders" can be turned off per room;
     anything else is about the person themselves */
  const kind = b.kind === "activity" || b.kind === "reminders" ? b.kind : null;
  const r = await rpc("push_targets_for", { p_sender:sender, p_room:b.room || null, p_user:b.to || null, p_kind:kind });
  if (!r.ok) return json({ error:"couldn't check who to tell" }, 502, cors);
  const out = await deliver(env, await r.json(), note, ctx);
  return json(out, 200, cors);
}
const PUSH_HOSTS = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)\//;
const svcRpc = (env, fn, args) => fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method:"POST",
  headers:{ "Content-Type":"application/json", apikey:env.SUPABASE_SERVICE_KEY, Authorization:`Bearer ${env.SUPABASE_SERVICE_KEY}` }, body:JSON.stringify(args) });
async function deliver(env, targets, note, ctx) {
  const subs = (targets || []).filter(s => PUSH_HOSTS.test(s.endpoint) || (/^apns:[0-9a-f]{64,200}$/.test(s.endpoint) && apnsReady(env))).slice(0, 200);
  const payload = JSON.stringify(note);
  const forget = async s => { const gone = svcRpc(env, "push_gone", { p_endpoint:s.endpoint }).catch(() => {}); if (ctx) ctx.waitUntil(gone); else await gone; };
  const results = await Promise.all(subs.map(async s => {
    if (s.endpoint.startsWith("apns:")) { try { const r = await apnsSend(env, s.endpoint.slice(5), note); if (r.gone) await forget(s); return r.ok; } catch { return false; } }
    try { const res = await fetch(s.endpoint, { method:"POST", body:await encryptFor(s, payload), headers:{
        "Content-Encoding":"aes128gcm", "Content-Type":"application/octet-stream", TTL:"86400", Urgency:"normal",
        ...(note.tag ? { Topic:note.tag.replace(/[^\w-]/g, "").slice(0, 32) } : {}),
        Authorization:`vapid t=${await vapidJWT(env, s.endpoint)}, k=${env.VAPID_PUBLIC}` } });
      if (res.status === 404 || res.status === 410) { const gone = svcRpc(env, "push_gone", { p_endpoint:s.endpoint }).catch(() => {}); if (ctx) ctx.waitUntil(gone); else await gone; }
      return res.ok; } catch { return false; } }));
  return { sent:results.filter(Boolean).length, of:subs.length };
}

/* ---------- the room's own schedule ----------
   Run every hour; each reminder belongs to one local hour, so it goes out once. The
   question each room gets is worked out exactly as the app works it out (same list,
   same hash of room and week), so the notification and the room always agree. */
const PROMPTS = [
  "Something you'd show someone to make them cry", "The one you'd defend to the death",
  "A perfect thing to put on when you're ill", "Something with an ending that ruined your week",
  "Better the second time", "The best thing you've finished that nobody else has heard of",
  "Something to give a stranger on a train", "A guilty pleasure, minus the guilt",
  "Something that made you want to go somewhere", "The scariest thing you've finished",
  "Safe to put on with your parents", "Your comfort pick",
  "Something that changed your mind about a whole genre", "Far too long, and you'd still do it again",
  "Something you finished in one sitting", "The one that proves you have taste",
  "Better than its reputation", "The best opening ten minutes",
  "Something that made you laugh out loud", "The one you'd save from a burning house",
  "A first-date pick", "Something you'd recommend to exactly one person in this room",
  "The most beautiful thing you've finished", "Something you think about more than you'd admit",
  "Everyone should be made to finish this once" ];
function avHash(s) { let h = 2166136261; for (const ch of String(s || "?")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return Math.abs(h); }
function localNow(tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone:tz, year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", hourCycle:"h23", weekday:"short" }).formatToParts(new Date()).map(p => [p.type, p.value]));
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday);   /* Monday is 0, as in the app */
  const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - wd);
  return { ymd, hour:+parts.hour, wd, week:d.toISOString().slice(0, 10) }; }
const days = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
async function runSchedule(env, at = localNow(env.TZ || "Australia/Sydney")) {
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE || !env.SUPABASE_SERVICE_KEY) return { skipped:"not set up" };
  const { ymd, hour, wd, week } = at, sent = [];
  const toRoom = async (room, note) => { const r = await svcRpc(env, "push_targets_room", { p_room:room, p_kind:"reminders" });
    if (r.ok) sent.push(await deliver(env, await r.json(), note)); };
  const want = (wd === 0 && hour === 9) || (wd === 4 && hour === 18) || hour === 17;
  if (want) {
    const r = await svcRpc(env, "push_schedule", { p_week:week, p_today:ymd });
    const rooms = r.ok ? await r.json() : [];
    for (const R of rooms) { const link = `./#room=${R.room_id}&sec=play`;
      if (wd === 0 && hour === 9) await toRoom(R.room_id, { title:`${R.name}: this week's question`,
        body:`“${PROMPTS[avHash(R.room_id + ":" + week) % PROMPTS.length]}” — answer from your log.`, url:link, tag:`prompt-${R.room_id}`.slice(0, 60) });
      if (wd === 4 && hour === 18 && R.answers >= 2) await toRoom(R.room_id, { title:`Voting's open in ${R.name}`,
        body:`${R.answers} answers to this week's question. Pick your favourite before Sunday.`, url:link, tag:`prompt-${R.room_id}`.slice(0, 60) });
      if (hour === 17 && R.night) await toRoom(R.room_id, { title:`Watch night tonight in ${R.name}`,
        body:"Vote on what you're watching before it starts.", url:link, tag:`night-${R.room_id}`.slice(0, 60) }); } }
  /* Five Clues, for whoever asked for a nudge at this hour (the hour is kept in UTC) */
  { const r = await svcRpc(env, "push_targets_clues", { p_hour:new Date().getUTCHours() }).catch(() => null);
    if (r?.ok) { const subs = await r.json(); if (subs.length) sent.push(await deliver(env, subs, { title:"Today's Five Clues is up",
      body:"A new one to guess. How few clues will it take you?", url:"./#clues", tag:"clues" })); } }
  /* new episodes out today of shows people are on, told at six in the evening */
  if (hour === 18) { const r = await svcRpc(env, "push_targets_episodes", { p_day:ymd }).catch(() => null);
    if (r?.ok) { const rows = await r.json(), by = {};
      for (const x of rows) (by[x.work_id + "|" + x.label] ||= { x, subs:[] }).subs.push(x);
      for (const { x, subs } of Object.values(by)) sent.push(await deliver(env, subs, { title:`New ${x.title} out today`,
        body:`${x.label || "A new episode"} is out. Tap to see it and say where you're up to.`, url:`./#work=${encodeURIComponent(x.work_id)}`, tag:`ep-${x.work_id}`.slice(0, 60) })); } }
  /* 1 December: everybody who logged this year hears their Rooms Wrapped is ready */
  if (ymd.slice(5) === "12-01" && hour === 10) { const r = await svcRpc(env, "push_targets_season", { p_since:ymd.slice(0, 4) + "-01-01" }).catch(() => null);
    if (r?.ok) { const subs = await r.json(); if (subs.length) sent.push(await deliver(env, subs, { title:`Your Rooms Wrapped ${ymd.slice(0, 4)} is ready`,
      body:"Your year in films, shows, books and games, with cards for your stories.", url:"./#wrapped", tag:"wrapped" })); } }
  /* Monday morning: last week's totals are in, for the founder's video and newsletter */
  if (wd === 0 && hour === 8) { const r = await svcRpc(env, "push_targets_founders", {}).catch(() => null);
    if (r?.ok) { const subs = await r.json(); if (subs.length) sent.push(await deliver(env, subs, { title:"Last week on Rooms is ready",
      body:"What people logged, what's rising and the cards for this week's video.", url:"./#trends", tag:"trends" })); } }
  return { at, sent };
}
