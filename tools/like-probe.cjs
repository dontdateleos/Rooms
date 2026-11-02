// Tries "find similar" on the live site, with real search results, and prints what comes back.
// Run from the Actions tab ("Probe the live site"); the sources only answer the app's own address.
const { chromium } = require("playwright");
const SITE = process.env.SITE || "https://dontdateleos.github.io/Rooms/index.html?demo";
const QUERIES = (process.env.QUERIES?.trim() || "like Heat|games like Heat|books like Heat|films like The Last of Us|like Dune|shows like Pachinko|games like Severance|films like Gone Girl").split("|");
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport:{ width:390, height:844 } });
  const errs = []; p.on("pageerror", e => errs.push(e.message));
  p.on("console", m => { if (/find similar/.test(m.text())) errs.push(m.text()); });
  p.on("response", async r => { if (r.status() >= 400 && /workers\.dev/.test(r.url())) errs.push(`${r.status()} ${r.url().replace(/^https:\/\/[^/]+/, "")} ${r.request().postData() || ""} → ${(await r.text().catch(() => "")).slice(0, 200)}`); });
  /* wait for the newest page to be the one GitHub Pages serves */
  for (let i = 0; i < 20; i++) { const r = await fetch(SITE.split("?")[0] + "?t=" + Date.now()).then(r => r.text()).catch(() => "");
    if (r.includes(process.env.NEEDS || "crossLike")) break; console.log("waiting for the site to update…"); await new Promise(r => setTimeout(r, 15000)); }
  await p.goto(SITE); await p.waitForTimeout(4000);
  await p.click("#add"); await p.waitForTimeout(800);
  for (const q of QUERIES) {
    await p.fill("#aSearch", ""); await p.fill("#aSearch", q);
    await p.waitForFunction(() => !document.querySelector("#aMsg .thinker") && document.querySelector("#aResults")?.children.length, null, { timeout:40000 }).catch(() => {});
    await p.waitForTimeout(800);
    const out = await p.$$eval("#aResults > *", els => { const g = []; for (const e of els) { if (e.classList.contains("lbl")) g.push([e.textContent, []]); else if (e.dataset.add) (g.at(-1) || (g.push(["", []]), g.at(-1)))[1].push(e.querySelector("b")?.textContent); else g.push([e.textContent.trim().slice(0, 120), []]); } return g; });
    console.log(`\n“${q}”`); for (const [l, t] of out) console.log(`  ${l}${t.length ? ": " + t.join(", ") : ""}`); }
  /* the title page row, switched to games and books */
  console.log("\nerrors:", errs.length ? errs : "none"); await b.close(); })();
