// The demo's real covers. The demo's films, shows, books and games have made-up ids, so this
// looks each one up by title and year (through the app's own worker, the same way the app
// does) and writes what it finds into demo.js between the REAL_COVERS markers. Anything it
// can't find keeps its drawn cover. Run from the repo root on a machine that can reach the
// worker (the "Screenshots" workflow does):
//   ORIGIN=https://you.github.io node tools/demo-covers.mjs
import fs from "node:fs";

const WORKER = (process.env.WORKER || "https://rooms.jordandf1.workers.dev").replace(/\/+$/, "");
const ORIGIN = (process.env.ORIGIN || "").split(",")[0].trim();
if (!ORIGIN) { console.error("set ORIGIN to the app's own address, as the worker allows it"); process.exit(1); }
const FILE = new URL("../demo.js", import.meta.url);
let src = fs.readFileSync(FILE, "utf8");

const rows = [...src.matchAll(/\["((?:film|tv|book|game):\d+)","(film|tv|book|game)","([^"]+)","(\d{4})","([^"]*)"/g)]
  .map(m => ({ id:m[1], kind:m[2], title:m[3], year:m[4], creator:m[5] }));
const old = (() => { const m = /const REAL_COVERS = (\{[\s\S]*?\});/.exec(src); try { return m ? JSON.parse(m[1]) : {}; } catch { return {}; } })();
const oldBd = (() => { const m = /const REAL_BACKDROPS = (\{[\s\S]*?\});/.exec(src); try { return m ? JSON.parse(m[1]) : {}; } catch { return {}; } })();
const backdrops = { ...oldBd };

const call = async (path, opt = {}) => { const r = await fetch(WORKER + path, { ...opt, headers:{ Origin:ORIGIN, ...(opt.headers || {}) } });
  if (!r.ok) throw new Error(`${r.status} on ${path}`); return r.json(); };
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function find(w) {
  if (w.kind === "film" || w.kind === "tv") {
    const q = new URLSearchParams({ query:w.title, ...(w.kind === "film" ? { year:w.year } : { first_air_date_year:w.year }) });
    const d = await call(`/3/search/${w.kind === "film" ? "movie" : "tv"}?${q}`);
    const hit = (d.results || []).find(x => x.poster_path && norm(x.title || x.name) === norm(w.title)) || (d.results || []).find(x => x.poster_path);
    if (hit?.backdrop_path) backdrops[w.id] = "https://image.tmdb.org/t/p/w780" + hit.backdrop_path;
    return hit ? "https://image.tmdb.org/t/p/w342" + hit.poster_path : null; }
  if (w.kind === "book") {
    const q = new URLSearchParams({ title:w.title, author:w.creator, limit:"5", fields:"title,cover_i" });
    const d = await call(`/ol/search.json?${q}`);
    const hit = (d.docs || []).find(x => x.cover_i);
    return hit ? `https://covers.openlibrary.org/b/id/${hit.cover_i}-L.jpg` : null; }
  if (w.kind === "game") {
    const d = await call("/igdb/games", { method:"POST", headers:{ "Content-Type":"text/plain" }, body:`search "${w.title.replace(/"/g, "")}"; fields name,cover.image_id; limit 10;` });
    const hit = (d || []).find(x => x.cover?.image_id && norm(x.name) === norm(w.title)) || (d || []).find(x => x.cover?.image_id);
    return hit ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${hit.cover.image_id}.jpg` : null; }
  return null; }

const covers = { ...old }; let found = 0, missed = [];
for (const w of rows) {
  try { const u = await find(w); if (u) { covers[w.id] = u; found++; } else missed.push(w.title); }
  catch (e) { missed.push(`${w.title} (${e.message})`); } }
console.log(`covers: ${found} of ${rows.length} found${missed.length ? "; kept the drawn cover for " + missed.join(", ") : ""}`);

const block = `/* REAL_COVERS: filled in by tools/demo-covers.mjs */\nconst REAL_COVERS = ${JSON.stringify(covers, null, 0).replace(/","/g, '",\n  "')};\n/* /REAL_COVERS */`;
src = /\/\* REAL_COVERS:[\s\S]*?\/\* \/REAL_COVERS \*\//.test(src) ? src.replace(/\/\* REAL_COVERS:[\s\S]*?\/\* \/REAL_COVERS \*\//, block) : src;
const bdBlock = `/* REAL_BACKDROPS: filled in by tools/demo-covers.mjs */\nconst REAL_BACKDROPS = ${JSON.stringify(backdrops, null, 0).replace(/","/g, '",\n  "')};\n/* /REAL_BACKDROPS */`;
src = src.replace(/\/\* REAL_BACKDROPS:[\s\S]*?\/\* \/REAL_BACKDROPS \*\//, () => bdBlock);
console.log(`backdrops: ${Object.keys(backdrops).length}`);
fs.writeFileSync(FILE, src);
