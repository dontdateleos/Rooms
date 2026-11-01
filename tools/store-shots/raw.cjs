// The App Store screenshots, step one: the app's screens from the demo, at an iPhone's size.
// Serve the repo (python3 -m http.server 8934, from its root), then:
//   node tools/store-shots/raw.cjs          (all six, or e.g. `raw.cjs 2,4` for some)
//   node tools/store-shots/compose.cjs      (the framed 1320×2868 images, into store/screenshots)
const { chromium } = require('playwright'); const D = __dirname;
(async () => { const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, colorScheme: 'dark', hasTouch: false });
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { if (!sessionStorage.x) { sessionStorage.x = 1; localStorage.setItem('rooms.prefs', JSON.stringify({ theme: 'dark', holdTip: 1, toured: 1, pushAsked: 1 })); } });
  await p.goto('http://127.0.0.1:8934/index.html?demo', { waitUntil: 'networkidle' }); await p.waitForTimeout(3500);
  await p.addStyleTag({ content: '#demobar{display:none!important} .toast{display:none!important} #newPill{display:none!important}' });
  const only = process.argv[2] ? process.argv[2].split(',').map(Number) : null;
  const shot = async n => { if (only && !only.includes(n)) return; await p.waitForTimeout(900); await p.screenshot({ path: `${D}/raw-${n}.png` }); console.log('shot', n); };
  const top = async () => { await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(400); };
  const tab = async t => { await p.locator('nav button', { hasText: t }).first().click(); await p.waitForTimeout(1600); await top(); };
  const back = async () => { await p.evaluate(() => history.back()); await p.waitForTimeout(900); };
  // 1 the room
  await tab('Rooms'); await shot(1);
  // 2 a title page
  await p.locator('#feedBody [data-work]').first().click(); await p.waitForTimeout(2200); await p.evaluate(() => scrollTo(0, 0)); await shot(2); await back();
  // 3 logging
  await tab('Queue'); await p.locator("#libBar [data-lib='shelf']").click(); await p.waitForTimeout(1200);
  await p.locator('[data-t]').first().click(); await p.waitForTimeout(1300);
  const rb = await p.locator('#rateWrap').boundingBox(); await p.mouse.click(rb.x + rb.width * .9, rb.y + rb.height / 2); await p.waitForTimeout(700);
  await p.locator('#sheetBody .chip', { hasText: 'the atmosphere' }).first().click().catch(() => {}); await shot(3); await back();
  // 4 picks for you
  await tab('You'); await p.waitForTimeout(2500); await p.evaluate(() => { const r = document.querySelector('#recCard'); scrollTo(0, r.getBoundingClientRect().top + scrollY - 92); }); await shot(4);
  // 5 watch together
  await tab('Rooms'); await p.locator('[data-rsecbtn="play"]').first().evaluate(e => e.click()); await p.waitForTimeout(3200); await top(); await shot(5);
  // 6 diary and rankings
  await tab('Queue'); await p.locator("#libBar [data-lib='archive']").click(); await p.waitForTimeout(1500); await top(); await shot(6);
  console.log('errors', errs.length ? errs : 'none'); await b.close(); })();
