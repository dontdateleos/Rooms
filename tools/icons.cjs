// Draws every app icon, splash screen and the link preview image from the Rooms mark.
// Run from the repo root after changing the mark:  node tools/icons.cjs
// Needs Playwright (npx playwright, or a global install).
const fs = require("fs"), path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, ".."), OUT = path.join(ROOT, "icons");
const GROUND = "#16131C", TEXT = "#F4EDE2", SUB = "#C9C1D9";
const font = w => `data:font/woff2;base64,${fs.readFileSync(path.join(ROOT, `vendor/fonts/outfit-${w}-latin.woff2`)).toString("base64")}`;

/* the mark: four rooms, three with the lights off and one lit with someone home */
const MARK = `<svg viewBox="10 10 80 80" xmlns="http://www.w3.org/2000/svg">
  <rect x="12" y="12" width="36" height="36" rx="10" fill="#F5A3C7" fill-opacity=".32"/>
  <rect x="52" y="12" width="36" height="36" rx="10" fill="#FFB36B" fill-opacity=".32"/>
  <rect x="12" y="52" width="36" height="36" rx="10" fill="#B9A6FF" fill-opacity=".32"/>
  <rect x="52" y="52" width="36" height="36" rx="10" fill="#8FD3FF"/>
  <g fill="#151320"><rect x="63" y="63" width="4.6" height="10" rx="2.3"/><rect x="72.4" y="64" width="4.6" height="11" rx="2.3"/></g></svg>`;

const page = body => `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Outfit;font-weight:700;src:url(${font(700)})}
@font-face{font-family:Outfit;font-weight:900;src:url(${font(900)})}
html,body{margin:0;background:${GROUND};overflow:hidden}
svg{display:block;width:100%;height:100%}
</style>${body}`;

/* a square icon with the mark taking `share` of the width (smaller for maskable icons, which get cropped to a circle) */
const icon = (size, share) => page(`<div style="width:${size}px;height:${size}px;display:grid;place-items:center">
  <div style="width:${size * share}px;height:${size * share}px">${MARK}</div></div>`);

const splash = (w, h) => page(`<div style="width:${w}px;height:${h}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${w * .07}px">
  <div style="width:${w * .25}px;height:${w * .25}px">${MARK}</div>
  <div style="font:900 ${w * .085}px/1 Outfit;letter-spacing:-.03em;color:${TEXT}">Rooms</div></div>`);

const og = () => page(`<div style="width:1200px;height:630px;position:relative">
  <div style="position:absolute;left:140px;top:205px;width:210px;height:210px">${MARK}</div>
  <div style="position:absolute;left:466px;top:160px;font:900 140px/1 Outfit;letter-spacing:-.03em;color:${TEXT}">Rooms</div>
  <div style="position:absolute;left:470px;top:330px;font:700 38px/1.3 Outfit;color:${SUB}">What your friends are watching,<br>reading and playing.</div>
  <div style="position:absolute;left:470px;top:468px;display:flex;gap:14px">${["#F5A3C7", "#9EF0C9", "#B9A6FF", "#8FD3FF", "#FFB36B", "#FFE86A"]
    .map(c => `<span style="width:54px;height:76px;border-radius:12px 12px 4px 4px;background:${c}"></span>`).join("")}</div></div>`);

const JOBS = [
  ["rooms-180.png", 180, 180, icon(180, .6)], ["rooms-192.png", 192, 192, icon(192, .6)], ["rooms-512.png", 512, 512, icon(512, .6)],
  ["rooms-mask-192.png", 192, 192, icon(192, .46)], ["rooms-mask-512.png", 512, 512, icon(512, .46)],
  ...[[750, 1334], [828, 1792], [1125, 2436], [1170, 2532], [1179, 2556], [1206, 2622], [1290, 2796], [1320, 2868]]
    .map(([w, h]) => [`splash-${w}x${h}.png`, w, h, splash(w, h)]),
  ["og.png", 1200, 630, og()]];

(async () => {
  const browser = await chromium.launch(), p = await browser.newPage();
  for (const [name, w, h, html] of JOBS) {
    await p.setViewportSize({ width: w, height: h });
    await p.setContent(html); await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(OUT, name) });
    console.log("drew", name);
  }
  await browser.close();
})();
