/* A walk through the demo, failing on anything that breaks.

   Opens ?demo on a phone-sized screen, goes to every tab and every room section, opens
   the sheets people use most, and fails if the page throws, if a screen comes up empty,
   or if an expected control is missing. It doesn't judge how anything looks — it
   catches the push that would have left the app broken on your phone.

     node tests/smoke.js                 # expects the site on http://127.0.0.1:8934
     BASE=http://localhost:3000 node tests/smoke.js
     CHROMIUM=/path/to/chromium node tests/smoke.js   # use an existing browser */
const { chromium } = require("playwright");
const BASE = (process.env.BASE || "http://127.0.0.1:8934").replace(/\/$/, "");

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath:process.env.CHROMIUM } : {});
  const failures = [];
  for (const scheme of ["dark", "light"]) {
    const page = await browser.newPage({ viewport:{ width:390, height:844 }, colorScheme:scheme });
    const errors = [];
    page.on("pageerror", e => errors.push(String(e)));
    const step = async (name, fn) => {
      try { await fn(); } catch (e) { failures.push(`[${scheme}] ${name}: ${e.message.split("\n")[0]}`); } };
    /* real taps, not element.click(): a tap has to get past whatever is on top of the
       button, and a script click doesn't — that difference once hid a demo nobody could tap */
    const tap = async (sel, text) => {
      const at = text ? page.locator(sel, { hasText:new RegExp(`^\\s*${text}\\s*$`) }) : page.locator(sel);
      await at.first().click({ timeout:4000 }); };
    const expect = async (sel, what) => { if (!(await page.$(sel))) throw new Error(`missing ${what || sel}`); };
    const wait = ms => page.waitForTimeout(ms);
    /* the back gesture is how a sheet closes on a phone, so it's how the walk closes them */
    const closeSheet = async () => { await page.evaluate(() => history.back()); await wait(450);
      if (await page.$("#sheet.on:not(.out)")) throw new Error("the sheet didn't close"); };

    await page.addInitScript(s => { try { localStorage.setItem("rooms.prefs", JSON.stringify({ theme:s })); } catch {} }, scheme);
    await step("load the demo", async () => {
      await page.goto(`${BASE}/index.html?demo`, { waitUntil:"domcontentloaded", timeout:20000 }); await wait(1800);
      await expect("nav button[data-tab]", "the tab bar"); });

    await step("rooms", async () => { await tap("nav button", "Rooms"); await wait(1500);
      await expect("#feedPick", "the room title"); await expect(".roomsecs", "the room sections");
      for (const sec of ["Play", "Charts", "Year", "Talk"]) { await tap("[data-rsecbtn]", sec); await wait(900); }
      await expect("#roomGames .card", "the games"); });
    await step("room picker", async () => { await tap("#feedPick"); await wait(500); await expect("[data-fp]", "rooms to pick"); await closeSheet(); });
    await step("room menu", async () => { await tap("#roomMenu"); await wait(500); await expect("#roomSeats", "the members"); await closeSheet(); });
    await step("bell", async () => { await tap("#bellBtn"); await wait(500); await expect("#noteBody", "the bell's list"); await closeSheet(); });
    await step("archive", async () => { await tap("nav button", "Archive"); await wait(900); await expect(".archcard", "archive cards"); });
    await step("clubs", async () => { await tap("nav button", "Clubs"); await wait(900); await expect("#clubsBody .seg", "the clubs"); });
    await step("shelf", async () => { await tap("nav button", "Shelf"); await wait(900); await expect("#shelfGrid .cell", "shelf posters"); });
    await step("your page", async () => { await tap("#meBtn"); await wait(1200); await expect("#tasteCog", "settings"); });
    await step("log something", async () => { await tap("#add"); await wait(700);
      if (!(await page.$("#sheet.on"))) throw new Error("the + button didn't open anything"); await closeSheet(); });

    for (const e of errors) failures.push(`[${scheme}] page error: ${e}`);
    await page.close(); }
  await browser.close();
  if (failures.length) { console.error(`✗ ${failures.length} problem(s):\n  ` + failures.join("\n  ")); process.exit(1); }
  console.log("✓ every tab and sheet opened without an error, in dark and light");
})().catch(e => { console.error(e); process.exit(1); });
