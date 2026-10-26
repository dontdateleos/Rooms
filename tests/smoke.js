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
    await step("moving between places", async () => {
      /* the room's name is the menu: tap it, pick somewhere else, and come back */
      const title = () => page.locator("#feedPick").innerText();
      const was = await title(); await tap("#feedPick"); await wait(500);
      await tap("[data-fp]:not(.on)"); await wait(900);
      if ((await title()) === was) throw new Error("picking another place didn't move");
      await tap("#feedPick"); await wait(500); await tap("[data-fp]"); await wait(900);
      if ((await title()) !== was) throw new Error("couldn't get back to the room"); });
    await step("room picker", async () => { await tap("#feedPick"); await wait(500); await expect("[data-fp]", "rooms to pick"); await closeSheet(); });
    await step("room menu", async () => { await tap("#roomMenu"); await wait(500); await expect("#roomSeats", "the members"); await closeSheet(); });
    await step("bell", async () => { await tap("#bellBtn"); await wait(500); await expect("#noteBody", "the bell's list"); await closeSheet(); });
    await step("archive", async () => { await tap("nav button", "Queue"); await wait(700); await tap("#libBar [data-lib='archive']"); await wait(900); await expect(".archcard", "archive cards");
      await tap('#cabPager [data-place]:nth-child(2)'); await wait(900); await expect(".archcard", "cards for one medium");
      await tap('#cabPager [data-place]'); await wait(700); });
    await step("seasons", async () => { await tap("nav button", "Challenges"); await wait(900); await expect("#seasonPager", "the seasons page");
      await tap('#seasonPager [data-place="clubs"]'); await wait(900);
      if (!(await page.locator("#seasonPager button.on").innerText()).toLowerCase().includes("clubs")) throw new Error("couldn't move to friend clubs");
      await tap('#seasonPager [data-place="season"]'); await wait(700); });
    await step("shelf", async () => { await tap("nav button", "Challenges"); await wait(700);
      /* Library comes back to the side you left it on */
      await tap("nav button", "Queue"); await wait(900); await expect("#tab-archive.on", "the archive, where Library was left");
      await tap("#libBar [data-lib='shelf']"); await wait(900); await expect("#shelfGrid .cell", "shelf posters"); });
    await step("tonight", async () => { await tap("nav button", "Rooms"); await wait(1200); await expect("#tonight", "the tonight card");
      await tap("#tonightSpin"); await wait(700); if (!(await page.$("#sheet.on"))) throw new Error("Can't decide? didn't open the wheel"); await closeSheet(); });
    await step("swipe between tabs", async () => {
      /* a real drag: down, a run of moves, up — the page follows the finger, so a
         start and an end with nothing between would never get going */
      const swipe = async dx => { await page.evaluate(async dx => { const m = document.querySelector("main"), y = 600;
        const t = x => new Touch({ identifier:1, target:m, clientX:x, clientY:y });
        const fire = (type, x) => m.dispatchEvent(new TouchEvent(type, { touches:type === "touchend" ? [] : [t(x)], changedTouches:[t(x)], bubbles:true, cancelable:true }));
        fire("touchstart", 200);
        for (let i = 1; i <= 8; i++) { fire("touchmove", 200 + dx * i / 8); await new Promise(r => setTimeout(r, 16)); }
        fire("touchend", 200 + dx); }, dx); await wait(900); };
      /* a short drag settles back where it was */
      await page.evaluate(async () => { const m = document.querySelector("main"), y = 600;
        const t = x => new Touch({ identifier:1, target:m, clientX:x, clientY:y });
        const fire = (type, x) => m.dispatchEvent(new TouchEvent(type, { touches:type === "touchend" ? [] : [t(x)], changedTouches:[t(x)], bubbles:true, cancelable:true }));
        fire("touchstart", 200); for (let i = 1; i <= 6; i++) { fire("touchmove", 200 - i * 8); await new Promise(r => setTimeout(r, 120)); } fire("touchend", 152); });
      await wait(700); await expect("#tab-doors.on", "Rooms still, after a short drag");
      if (await page.$("section.incoming")) throw new Error("a peeking tab was left behind");
      await swipe(-160); await expect("#tab-shelf.on", "Queue after a swipe left");
      await swipe(160); await expect("#tab-doors.on", "Rooms after a swipe back"); });
    await step("hold library to spin", async () => { await tap("nav button", "Challenges"); await wait(600);
      const b = page.locator('nav button[data-tab="library"]'); const box = await b.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await wait(650); await page.mouse.up(); await wait(700);
      if (!(await page.$("#sheet.on"))) throw new Error("holding Library didn't open the wheel");
      if (await page.$("#tab-shelf.on, #tab-archive.on")) throw new Error("the hold also switched tabs");
      await closeSheet(); });
    await step("your page", async () => { await tap("nav button", "You"); await wait(1200); await expect("#tasteCog", "settings"); });
    await step("log something", async () => { await tap("#add"); await wait(700);
      if (!(await page.$("#sheet.on"))) throw new Error("the + button didn't open anything"); await closeSheet(); });

    for (const e of errors) failures.push(`[${scheme}] page error: ${e}`);
    await page.close(); }
  await browser.close();
  if (failures.length) { console.error(`✗ ${failures.length} problem(s):\n  ` + failures.join("\n  ")); process.exit(1); }
  console.log("✓ every tab and sheet opened without an error, in dark and light");
})().catch(e => { console.error(e); process.exit(1); });
