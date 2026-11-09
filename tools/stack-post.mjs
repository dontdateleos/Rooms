// Makes a stack from a little JSON file (stacks/*.json) and puts it on the founder's
// account, so a stack for a post can be set up from GitHub without typing it into the app.
// Each film and book is looked up the way the app looks it up (TMDB and Open Library,
// through the app's own worker), so the stack points at the same titles people log.
// Running it again updates the same stack rather than making a second one.
//   SUPABASE_SERVICE_KEY=… node tools/stack-post.mjs stacks/before-sunrise.json
// Writes out/<slug>/items.json for tools/stack-cards.cjs to draw the post from.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { lookUp, WORKER } from "./lookup.mjs";

const SUPABASE = "https://caaxycmobhssxclrakim.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!KEY) { console.error("SUPABASE_SERVICE_KEY isn't set"); process.exit(1); }
const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
const slug = spec.post?.slug || "stack";

const db = async (method, path, body, prefer) => {
  const r = await fetch(`${SUPABASE}/rest/v1/${path}`, { method, headers:{ apikey:KEY, Authorization:`Bearer ${KEY}`, "Content-Type":"application/json",
    ...(prefer ? { Prefer:prefer } : {}) }, body:body ? JSON.stringify(body) : undefined });
  const text = await r.text(); if (!r.ok) throw new Error(`${method} ${path.split("?")[0]} → ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null; };
const items = [];
for (const it of spec.items) { const w = await lookUp(it);
  items.push({ w, why:it.why || null, card:it.card || null, when:it.when || null, where:it.where || null }); console.log(`✓ ${it.kind} ${w.title} (${w.year}) → ${w.id}${w.cover ? "" : " (no cover)"}`); }

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
if (post.finale?.q) { const f = post.finale; post.finale = { ...f, w:await lookUp(f) };
  console.log(`✓ last slide: ${post.finale.w.title} (${post.finale.w.year})${post.finale.w.cover ? "" : " (no poster yet)"}`); }
mkdirSync(`out/${slug}`, { recursive:true });
writeFileSync(`out/${slug}/items.json`, JSON.stringify({ list:{ id, title:spec.title, note:spec.note }, items, post }, null, 2));
