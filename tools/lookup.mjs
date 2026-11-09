// Finds a film, show, game or book the way the app finds it (TMDB, IGDB and Open Library,
// through the app's own worker), so what the tools save points at the same titles people log.
export const WORKER = "https://rooms.jordandf1.workers.dev";
const ORIGIN = process.env.ROOMS_ORIGIN || "https://dontdateleos.github.io";
export const look = async path => { const r = await fetch(WORKER + path, { headers:{ Origin:ORIGIN } });
  if (!r.ok) throw new Error(`${path.split("?")[0]} → ${r.status}`); return r.json(); };
const same = (a, b) => String(a).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === String(b).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function film(it) {
  const d = await look(`/3/search/movie?query=${encodeURIComponent(it.q)}&primary_release_year=${it.year}&include_adult=false`);
  const r = (d.results || []).find(x => same(x.title, it.q)) || (d.results || []).find(x => String(x.release_date || "").startsWith(String(it.year)));
  if (!r) throw new Error(`no film found for "${it.q}" (${it.year})`);
  return { id:"film:" + r.id, kind:"film", title:r.title, year:(r.release_date || "").slice(0, 4), cover:r.poster_path ? "https://image.tmdb.org/t/p/w342" + r.poster_path : null }; }
async function tv(it) {
  const d = await look(`/3/search/tv?query=${encodeURIComponent(it.q)}${it.year ? `&first_air_date_year=${it.year}` : ""}&include_adult=false`);
  const r = (d.results || []).find(x => same(x.name, it.q)) || (d.results || [])[0];
  if (!r) throw new Error(`no show found for "${it.q}"`);
  return { id:"tv:" + r.id, kind:"tv", title:r.name, year:(r.first_air_date || "").slice(0, 4), cover:r.poster_path ? "https://image.tmdb.org/t/p/w342" + r.poster_path : null }; }
async function game(it) {
  const r = await fetch(WORKER + "/igdb/games", { method:"POST", headers:{ Origin:ORIGIN, "Content-Type":"text/plain" },
    body:`search "${String(it.q).replace(/"/g, "")}"; fields name,first_release_date,cover.image_id,involved_companies.company.name,total_rating_count; limit 15;` });
  if (!r.ok) throw new Error(`/igdb/games → ${r.status}`);
  const gs = (await r.json()).filter(g => same(g.name, it.q)).sort((a, b) => (b.total_rating_count || 0) - (a.total_rating_count || 0));
  const g = gs[0]; if (!g) throw new Error(`no game found for "${it.q}"`);
  return { id:"game:" + g.id, kind:"game", title:g.name, year:g.first_release_date ? String(new Date(g.first_release_date * 1000).getFullYear()) : "",
    creator:g.involved_companies?.[0]?.company?.name || null, cover:g.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg` : null }; }
export const lookUp = it => ({ film, tv, game, book })[it.kind](it);
async function book(it) {
  const d = await look(`/ol/search.json?q=${encodeURIComponent(`${it.q} ${it.author || ""}`)}&limit=20&fields=key,title,author_name,first_publish_year,cover_i,number_of_pages_median,edition_count`);
  const docs = (d.docs || []).filter(b => same(b.title, it.q) && (!it.author || (b.author_name || []).some(a => same(a, it.author))))
    .sort((a, b) => (b.edition_count || 0) - (a.edition_count || 0));
  const b = docs[0]; if (!b) throw new Error(`no book found for "${it.q}"`);
  return { id:"book:" + String(b.key).replace("/works/", ""), kind:"book", title:b.title, year:String(b.first_publish_year || it.year || ""), creator:(b.author_name || [])[0] || null,
    length:b.number_of_pages_median || null, cover:b.cover_i ? `https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg` : null }; }

