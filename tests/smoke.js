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
    /* a tab can carry a count ("Rooms 3"), so a trailing number still matches.
       real taps, not element.click(): a tap has to get past whatever is on top of the
       button, and a script click doesn't — that difference once hid a demo nobody could tap */
    const tap = async (sel, text) => {
      const at = text ? page.locator(sel, { hasText:new RegExp(`^\\s*${text}\\s*(\\d+\\+?)?\\s*$`) }) : page.locator(sel);
      try { await at.first().click({ timeout:4000 }); }
      catch (e) { /* a picture of what was on screen, for the taps that only fail now and then */
        if (process.env.SMOKE_SHOTS) await page.screenshot({ path:`${process.env.SMOKE_SHOTS}/failed-${scheme}-${sel.replace(/[^a-z0-9]+/gi, "_")}.png` }).catch(() => {}); throw new Error(`couldn't tap ${sel}${text ? ` "${text}"` : ""}: ${(String(e.message).split("\n").find(l => /intercepts|not visible|not stable|outside of the viewport/.test(l)) || e.message.split("\n")[0]).replace(/\x1b\[\d+m/g, "").trim()}`); } };
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
    await step("feed", async () => { await tap("nav button", "Feed"); await wait(1500);
      await expect("#storyRow .sbub.fresh", "a ring with something new"); await expect("#pplFol .slip", "the people you follow");
      await expect("#pplAll .slip", "everyone else");
      await tap("#storyRow .sbub.fresh"); await wait(600); await expect("#storyV .sv-body h2", "the story");
      const first = await page.locator("#storyV .sv-body h2").innerText();
      await page.mouse.click(330, 420); await wait(500);
      if ((await page.locator("#storyV .sv-body h2").innerText()) === first) throw new Error("tapping the story didn't move on");
      await tap("#storyV .sv-x"); await wait(500);
      if (await page.$("#storyV")) throw new Error("the story didn't close"); });
    await step("room picker", async () => { await tap("nav button", "Rooms"); await wait(1200); await tap("#feedPick"); await wait(500); await expect("[data-fp]", "rooms to pick"); await closeSheet(); });
    await step("room menu", async () => { await tap("#roomMenu"); await wait(500); await expect("#roomSeats", "the members"); await closeSheet(); });
    await step("bell", async () => { await tap("#bellBtn"); await wait(500); await expect("#noteBody", "the bell's list"); await closeSheet(); });
    await step("diary and ranked", async () => { await tap("nav button", "Queue"); await wait(700); await tap("#libBar [data-lib='archive']"); await wait(900); await expect(".drow", "the diary");
      await tap('#cabPager [data-place]:nth-child(2)'); await wait(900); await expect(".drow", "the diary for one medium");
      await tap('#cabPager [data-place]'); await wait(700);
      await tap("#libBar [data-lib='ranked']"); await wait(900); await expect(".archcard", "your rankings");
      await tap("#libBar [data-lib='archive']"); await wait(700); await expect(".drow", "back to the diary"); });
    await step("play: five clues and party games", async () => { await tap("nav button", "Rooms"); await wait(1200);
      await tap('[data-rsecbtn="play"]'); await wait(2500); await expect('#playHub [data-ph="clues"]', "the Play hub"); await expect(".pg", "a party game");
      await tap('#playHub [data-ph="clues"]'); await wait(1200); await expect(".clu-list li.on", "the first clue"); await closeSheet();
      await tap("#pgStart"); await wait(600); await expect("[data-pk]", "the party games to pick from"); await tap("#pkNo"); await wait(400);
      await tap('[data-rsecbtn="talk"]'); await wait(600); });
    await step("stacks", async () => { await tap("nav button", "Stacks"); await wait(1200); await expect("#stackPager", "the stacks page");
      await expect(".stk", "a stack"); await tap('#stackPager [data-place="yours"]'); await wait(900);
      if (!(await page.locator("#stackPager button.on").innerText()).toLowerCase().includes("yours")) throw new Error("couldn't move to your stacks");
      await tap(".stk"); await wait(900); await expect(".tlitems", "a stack's things"); await closeSheet();
      await tap('#stackPager [data-place="popular"]'); await wait(700); });
    await step("shelf", async () => { await tap("nav button", "Stacks"); await wait(700);
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
      await swipe(-160); await expect("#tab-people.on", "Feed after a swipe left");
      await swipe(160); await expect("#tab-doors.on", "Rooms after a swipe back"); });
    await step("hold library to spin", async () => { await tap("nav button", "Stacks"); await wait(600);
      const b = page.locator('nav button[data-tab="library"]'); const box = await b.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await wait(650); await page.mouse.up(); await wait(700);
      if (!(await page.$("#sheet.on"))) throw new Error("holding Library didn't open the wheel");
      if (await page.$("#tab-shelf.on, #tab-archive.on")) throw new Error("the hold also switched tabs");
      await closeSheet(); });
    await step("lists, makers and series", async () => { await tap("nav button", "Rooms"); await wait(1200);
      await tap('[data-rsecbtn]', "Charts"); await wait(900); await expect("#roomLists .tlist", "the room's lists");
      await tap("#roomLists .tlist"); await wait(900); await expect(".tlitems .tlitem", "a list's things"); await closeSheet();
      await tap('[data-rsecbtn]', "Talk"); await wait(700);
      await tap('#feedBody [data-work="film:1"]'); await wait(1200);
      await tap("#wMore"); await wait(500); await tap('[data-more="list"]'); await wait(800); await expect("[data-addl]", "your lists to add it to"); await closeSheet();
      await tap('#feedBody [data-work="film:1"]'); await wait(1200);
      await tap(".whead [data-creator]"); await wait(1200); await expect(".crgrid .crw", "the director's films"); await closeSheet(); });
    await step("your page", async () => { await tap("#meBtn"); await wait(1200); await expect("#tasteCog", "settings");
      await tap("#tasteCog"); await wait(900); await expect("#nlSw", "the newsletter switch"); await tap("#nlSw"); await wait(700);
      await expect("#nlSw.on", "the newsletter switch on"); await tap("#nlSw"); await wait(700);
      await expect("#ppSw", "the public page switch"); await tap("#ppSw"); await wait(700);
      await expect("#ppSw.on", "the public page switch on"); await expect("#ppCopy", "the public page link"); await tap("#ppSw"); await wait(700);
      if (await page.$("#ppCopy")) throw new Error("the public page link stayed after switching off");
      await closeSheet(); });
    await step("log something", async () => { await tap("#add"); await wait(700);
      if (!(await page.$("#sheet.on"))) throw new Error("the + button didn't open anything"); await closeSheet(); });

    for (const e of errors) failures.push(`[${scheme}] page error: ${e}`);
    await page.close(); }
  await browser.close();
  if (failures.length) { console.error(`✗ ${failures.length} problem(s):\n  ` + failures.join("\n  ")); process.exit(1); }
  console.log("✓ every tab and sheet opened without an error, in dark and light");
})().catch(e => { console.error(e); process.exit(1); });
