// The App Store screenshots, step two: each raw screen in a phone frame under a headline (frame.html).
const { chromium } = require('playwright'); const fs = require('fs');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 3 });
  const out = process.argv[2] || require('path').join(__dirname, '../../store/screenshots'); fs.mkdirSync(out, { recursive: true });
  for (let n = 1; n <= 6; n++) { await p.goto(`http://127.0.0.1:8934/tools/store-shots/frame.html?n=${n}`, { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/iphone-6.9-${n}.jpg`, type: 'jpeg', quality: 92 }); console.log('made', n); }
  await b.close(); })();
