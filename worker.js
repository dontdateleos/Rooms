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
 *
 * igdb is the reason this exists: it needs a client secret and an oauth token,
 * neither of which can live on a phone.
 */

const CACHE = { tmdb: 60 * 60 * 24, ol: 60 * 60 * 24, igdb: 60 * 60 * 12 };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

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
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    try {
      if (url.pathname.startsWith("/3/")) return await tmdb(url, env, ctx, cors);
      if (url.pathname.startsWith("/ol/")) return await openLibrary(url, env, ctx, cors);
      if (url.pathname.startsWith("/igdb/")) return await igdb(request, url, env, ctx, cors);
      return json({ error: "unknown route" }, 404, cors);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 502, cors);
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

async function tmdb(url, env, ctx, cors) {
  if (!env.TMDB_KEY) return json({ error: "no TMDB_KEY set" }, 500, cors);
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
  const body = await request.text();
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
