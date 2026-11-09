// Makes a stack from a little JSON file (stacks/*.json) and puts it on the founder's
// account, so a stack for a post can be set up from GitHub without typing it into the app.
// Each film and book is looked up the way the app looks it up (TMDB and Open Library,
// through the app's own worker), so the stack points at the same titles people log.
// Running it again updates the same stack rather than making a second one.
//   SUPABASE_SERVICE_KEY=… node tools/stack-post.mjs stacks/before-sunrise.json
// Writes out/<slug>/items.json for tools/stack-cards.cjs to draw the post from.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const SUPABASE = "https://caaxycmobhssxclrakim.supabase.co";
const WORKER = "https://rooms.jordandf1.workers.dev";
const ORIGIN = process.env.ROOMS_ORIGIN || "https://dontdateleos.github.io";
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!KEY) { console.error("SUPABASE_SERVICE_KEY isn't set"); process.exit(1); }
const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
const slug = spec.post?.slug || "stack";

const db = async (method, path, body, prefer) => {
  const r = await fetch(`${SUPABASE}/rest/v1/${path}`, { method, headers:{ apikey:KEY, Authorization:`Bearer ${KEY}`, "Content-Type":"application/json",
    ...(prefer ? { Prefer:prefer } : {}) }, body:body ? JSON.stringify(body) : undefined });
  const text = await r.text(); if (!r.ok) throw new Error(`${method} ${path.split("?")[0]} → ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null; };
const look = async path => { const r = await fetch(WORKER + path, { headers:{ Origin:ORIGIN } });
  if (!r.ok) throw new Error(`${path.split("?")[0]} → ${r.status}`); return r.json(); };
const same = (a, b) => String(a).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === String(b).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function film(it) {
  const d = await look(`/3/search/movie?query=${encodeURIComponent(it.q)}&primary_release_year=${it.year}&include_adult=false`);
  const r = (d.results || []).find(x => same(x.title, it.q)) || (d.results || []).find(x => String(x.release_date || "").startsWith(String(it.year)));
  if (!r) throw new Error(`no film found for "${it.q}" (${it.year})`);
  return { id:"film:" + r.id, kind:"film", title:r.title, year:(r.release_date || "").slice(0, 4), cover:r.poster_path ? "https://image.tmdb.org/t/p/w342" + r.poster_path : null }; }
async function book(it) {
  const d = await look(`/ol/search.json?q=${encodeURIComponent(`${it.q} ${it.author || ""}`)}&limit=20&fields=key,title,author_name,first_publish_year,cover_i,number_of_pages_median,edition_count`);
  const docs = (d.docs || []).filter(b => same(b.title, it.q) && (!it.author || (b.author_name || []).some(a => same(a, it.author))))
    .sort((a, b) => (b.edition_count || 0) - (a.edition_count || 0));
  const b = docs[0]; if (!b) throw new Error(`no book found for "${it.q}"`);
  return { id:"book:" + String(b.key).replace("/works/", ""), kind:"book", title:b.title, year:String(b.first_publish_year || it.year || ""), creator:(b.author_name || [])[0] || null,
    length:b.number_of_pages_median || null, cover:b.cover_i ? `https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg` : null }; }

const items = [];
for (const it of spec.items) { const w = it.kind === "film" ? await film(it) : await book(it);
  items.push({ w, why:it.why || null, card:it.card || null }); console.log(`✓ ${it.kind} ${w.title} (${w.year}) → ${w.id}${w.cover ? "" : " (no cover)"}`); }

/* the works go in only if they aren't there yet: what's there may already have more in it */
/* a batch save needs every row to carry the same fields */
await db("POST", "works?on_conflict=id", items.map(({ w }) => ({ id:w.id, kind:w.kind, title:w.title, year:w.year || null, cover:w.cover || null, creator:w.creator || null, length:w.length || null })),
  "resolution=ignore-duplicates,return=minimal");
/* whose account it goes on: the handle given (STACK_OWNER, or "owner" in the file), else the founder */
const ownerHandle = (process.env.STACK_OWNER || spec.owner || "").replace(/^@/, "").trim();
const [founder] = ownerHandle ? await db("GET", `profiles?select=id,handle&handle=eq.${encodeURIComponent(ownerHandle)}&limit=1`)
  : await db("GET", "profiles?select=id,handle&founder=eq.true&limit=1");
let id = null;
if (!founder) console.log(`::warning::No ${ownerHandle ? `account @${ownerHandle}` : "founder account"} found, so the stack wasn't saved. The post is still drawn.`);
else {
const have = await db("GET", `theme_lists?select=id&owner=eq.${founder.id}&title=eq.${encodeURIComponent(spec.title)}&limit=1`);
if (have.length) { id = have[0].id;
  await db("PATCH", `theme_lists?id=eq.${id}`, { note:spec.note || null, ranked:!!spec.ranked, updated_at:new Date().toISOString() }, "return=minimal");
  await db("DELETE", `theme_list_items?list_id=eq.${id}`, null, "return=minimal");
  console.log(`Updated the stack "${spec.title}" on @${founder.handle}`); }
else { [{ id }] = await db("POST", "theme_lists", { owner:founder.id, title:spec.title, note:spec.note || null, ranked:!!spec.ranked, open:false }, "return=representation");
  console.log(`Made the stack "${spec.title}" on @${founder.handle}`); }
await db("POST", "theme_list_items", items.map((x, i) => ({ list_id:id, work_id:x.w.id, added_by:founder.id, position:i })), "return=minimal");
console.log(`${items.length} things on it. Share link: ${WORKER}/s/${id}`); }

/* the thing that's coming out, for the last slide: looked up, but not put on the stack */
const post = { ...(spec.post || {}) };
if (post.finale?.q) { const f = post.finale; post.finale = { ...f, w:f.kind === "book" ? await book(f) : await film(f) };
  console.log(`✓ last slide: ${post.finale.w.title} (${post.finale.w.year})${post.finale.w.cover ? "" : " (no poster yet)"}`); }
mkdirSync(`out/${slug}`, { recursive:true });
writeFileSync(`out/${slug}/items.json`, JSON.stringify({ list:{ id, title:spec.title, note:spec.note }, items, post }, null, 2));
