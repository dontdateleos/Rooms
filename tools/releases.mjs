// The hand-picked "big ones" for the app's Out soon list. Books and new seasons of shows
// carry no hype numbers anywhere the app can ask, so the most anticipated of those are
// chosen by hand in stacks/releases.json; this looks each one up and writes releases.json,
// which the app reads from the website.
//   node tools/releases.mjs stacks/releases.json
// A film with no "date" gets its Australian cinema date from TMDB.
import { readFileSync, writeFileSync } from "node:fs";
import { lookUp, look } from "./lookup.mjs";

const spec = JSON.parse(readFileSync(process.argv[2] || "stacks/releases.json", "utf8"));
async function auDate(id) {
  const d = await look(`/3/movie/${id.replace("film:", "")}?append_to_response=release_dates`);
  const au = (d.release_dates?.results || []).find(r => r.iso_3166_1 === "AU")?.release_dates || [];
  const cinema = au.filter(r => r.type === 3 || r.type === 2).map(r => r.release_date.slice(0, 10)).sort()[0];
  return cinema || (d.release_date || "").slice(0, 10) || null; }
const items = [];
for (const it of spec.items) {
  try { const w = await lookUp(it), date = it.date || (w.kind === "film" ? await auDate(w.id) : null);
    if (!date) { console.log(`::warning::${it.q}: no date, left out`); continue; }
    items.push({ ...w, date, where:it.where || null, why:it.why || null });
    console.log(`✓ ${w.kind} ${w.title} (${w.year}) → ${w.id}, out ${date}${w.cover ? "" : " (no cover)"}`); }
  catch (e) { console.log(`::warning::${it.q}: ${e.message}, left out`); } }
items.sort((a, b) => a.date.localeCompare(b.date));
/* only rewritten when something in it changed, so a quiet Monday commits nothing */
let had = null; try { had = JSON.parse(readFileSync("releases.json", "utf8")).items; } catch {}
if (JSON.stringify(had) !== JSON.stringify(items))
  writeFileSync("releases.json", JSON.stringify({ updated:new Date().toISOString().slice(0, 10), items }, null, 1) + "\n");
console.log(`${items.length} big ones in releases.json`);
