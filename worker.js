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
      if (url.pathname.startsWith("/ol/")) return await openLibrary(url, ctx, cors);
      if (url.pathname.startsWith("/igdb/")) return await igdb(request, url, env, cors);
      return json({ error: "unknown route" }, 404, cors);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 502, cors);
    }
  }
};

const json = (body, status, cors) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });

async function cached(key, ctx, ttl, make) {
  const cache = caches.default;
  const req = new Request(key);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await make();
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", `public, max-age=${ttl}`);
  ctx.waitUntil(cache.put(req, out.clone()));
  return out;
}

async function tmdb(url, env, ctx, cors) {
  if (!env.TMDB_KEY) return json({ error: "no TMDB_KEY set" }, 500, cors);
  const up = new URL("https://api.themoviedb.org" + url.pathname + url.search);
  up.searchParams.set("api_key", env.TMDB_KEY);
  const res = await cached(up.toString(), ctx, CACHE.tmdb, () => fetch(up.toString()));
  return withCors(res, cors);
}

async function openLibrary(url, ctx, cors) {
  const up = "https://openlibrary.org" + url.pathname.replace(/^\/ol/, "") + url.search;
  const res = await cached(up, ctx, CACHE.ol, () => fetch(up, { headers: { "User-Agent": "feature-feature/1.0" } }));
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

async function igdb(request, url, env, cors) {
  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET)
    return json({ error: "no IGDB_CLIENT_ID / IGDB_CLIENT_SECRET set" }, 500, cors);
  if (request.method !== "POST") return json({ error: "igdb wants POST with an apicalypse body" }, 405, cors);
  const endpoint = url.pathname.replace(/^\/igdb\//, "");
  const token = await igdbToken(env);
  const res = await fetch("https://api.igdb.com/v4/" + endpoint, {
    method: "POST",
    headers: {
      "Client-ID": env.IGDB_CLIENT_ID,
      "Authorization": "Bearer " + token,
      "Content-Type": "text/plain"
    },
    body: await request.text()
  });
  return withCors(res, cors);
}

function withCors(res, cors) {
  const out = new Response(res.body, res);
  Object.entries(cors).forEach(([k, v]) => out.headers.set(k, v));
  return out;
}
