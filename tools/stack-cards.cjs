// Draws a stack's post (the slides to swipe through) with the app's own drawing code, in
// both shapes: tall for TikTok and 4:5 for Instagram. Reads out/<slug>/items.json from
// tools/stack-post.mjs and writes out/<slug>/tiktok-01.png … and instagram-01.png ….
// Needs the app served on :8080 (python3 -m http.server 8080) and Playwright.
const { chromium } = require("playwright");
const fs = require("fs");
const slug = process.argv[2]; const dir = `out/${slug}`;
const data = JSON.parse(fs.readFileSync(`${dir}/items.json`, "utf8"));
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport:{ width:390, height:844 } });
  p.on("pageerror", e => console.log("page error:", String(e)));
  await p.goto("http://127.0.0.1:8080/index.html?demo");
  await p.waitForFunction(() => window.__rooms?.stackSets, null, { timeout:30000 });
  await p.evaluate(async () => { await Promise.all(["900 60px Outfit", "800 30px Outfit", "700 30px Inter", "600 30px Inter"].map(f => document.fonts.load(f))); await document.fonts.ready; });
  for (const [fmt, name] of [["tall", "tiktok"], ["post", "instagram"]]) {
    const pngs = await p.evaluate(async ({ data, fmt }) => {
      const items = data.items.map(x => ({ w:x.w, why:x.why, title:x.card }));
      const [set] = window.__rooms.stackSets(data.list, items, data.post, fmt), out = [];
      for (const [, draw] of set.slides) out.push((await draw()).toDataURL("image/png"));
      return out; }, { data, fmt });
    pngs.forEach((u, i) => fs.writeFileSync(`${dir}/${name}-${String(i + 1).padStart(2, "0")}.png`, Buffer.from(u.split(",")[1], "base64")));
    console.log(`${name}: ${pngs.length} slides`); }
  await b.close(); })().catch(e => { console.error(e); process.exit(1); });
