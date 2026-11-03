// The website's screens (site/*.jpg): the raw screenshots, small. Run after raw.cjs.
const { chromium } = require('playwright'); const fs = require('fs');
const SRC = __dirname + '/', OUT = __dirname + '/../../site/';
fs.mkdirSync(OUT, { recursive: true });
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 2 });
  for (const [n, name] of [[1, 'room'], [6, 'play'], [5, 'stacks'], [7, 'feed'], [8, 'diary']]) {
    const data = fs.readFileSync(SRC + `raw-${n}.png`).toString('base64');
    await p.setContent(`<body style="margin:0;background:#000"><img id="i" src="data:image/png;base64,${data}" style="width:330px;display:block"></body>`);
    await p.waitForTimeout(300);
    await p.locator('#i').screenshot({ path: OUT + `${name}.jpg`, type: 'jpeg', quality: 78 });
    console.log(name, fs.statSync(OUT + `${name}.jpg`).size); }
  await b.close(); })();
