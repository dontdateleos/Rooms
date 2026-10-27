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
 *
 * and once an hour, on its own (the [triggers] cron in wrangler.toml), the room's
 * reminders: this week's question is up, voting's open, watch night tonight, a season
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

const CACHE = { tmdb: 60 * 60 * 24, ol: 60 * 60 * 24, igdb: 60 * 60 * 12 };

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(runSchedule(env).catch(() => {})); },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    /* an invite is opened by a chat app's preview fetcher and then by a person tapping
       it — neither says where it came from, so this one route comes before the origin
       check. It only ever sends people on to the app's own address. */
    if (url.pathname.startsWith("/i/")) return await invitePage(request, url, env);

    /* fail closed. an unrestricted worker is an open proxy: anyone who finds the
       url spends this worker's TMDB key and IGDB credentials. so a missing ORIGIN
       serves nothing, and a request that does not name an allowed origin — one
       with no Origin header included — never reaches the upstreams. */
    const allowed = (env.ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
    if (!allowed.length)
      return json({ error: "worker not configured: wrangler secret put ORIGIN" }, 503);

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
const TMDB_OK = /^\/3\/(search\/(movie|tv|person)|discover\/(movie|tv)|find\/[\w-]+|genre\/(movie|tv)\/list|movie\/upcoming|person\/\d+\/combined_credits|(movie|tv)\/\d+(\/(images|recommendations|credits|watch\/providers|season\/\d+))?)$/;
const IGDB_OK = new Set(["games", "genres"]);
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
  const subs = (targets || []).filter(s => PUSH_HOSTS.test(s.endpoint)).slice(0, 200);
  const payload = JSON.stringify(note);
  const results = await Promise.all(subs.map(async s => {
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
/* the seasons, as the app has them: the same calendar every year — only the dates matter here */
const SEASON_CAL = [["The Catch-Up", 1, 2], ["Short Ones", 3, 3], ["Old Masters", 4, 4], ["Laugh Lines", 5, 5], ["Whodunnit", 6, 6],
  ["Far, Far Away", 7, 8], ["Second Time Round", 9, 9], ["31 Nights In", 10, 10], ["Long Nights", 11, 12]];
const seasonDates = y => SEASON_CAL.map(([name, a, b]) => [name, `${y}-${String(a).padStart(2, "0")}-01`,
  new Date(Date.UTC(y, b, 0)).toISOString().slice(0, 10)]);
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
  /* three nights before a season ends, everybody who's been logging hears about it once */
  if (hour === 18) for (const [name, starts, ends] of seasonDates(+ymd.slice(0, 4))) if (days(ymd, ends) === 2) {
    const r = await svcRpc(env, "push_targets_season", { p_since:starts });
    if (r.ok) sent.push(await deliver(env, await r.json(), { title:`${name} ends in three nights`,
      body:"Three nights left to get your medals. Challenges has where you're up to.", url:"./#seasons", tag:"season-end" })); }
  return { at, sent };
}
