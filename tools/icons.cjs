// Draws every app icon, splash screen and the link preview image from the Rooms mark.
// Run from the repo root after changing the mark:  node tools/icons.cjs
// Needs Playwright (npx playwright, or a global install).
const fs = require("fs"), path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, ".."), OUT = path.join(ROOT, "icons");
const IOS = path.join(ROOT, "ios/App/App/Assets.xcassets");
const GROUND = "#16131C", TEXT = "#F4EDE2", SUB = "#C9C1D9";
/* Outfit is one variable font file covering weights 500 to 900 */
const FONT = `data:font/woff2;base64,${fs.readFileSync(path.join(ROOT, "vendor/fonts/outfit-500-latin.woff2")).toString("base64")}`;

/* the mark: you up front, lit, and three rooms behind with the lights off */
/* each room is shaded like the faces: a lighter lid on top, a darker strip down the right */
const MARK = `<svg viewBox="10 10 80 80" xmlns="http://www.w3.org/2000/svg">
  <g opacity=".48"><rect x="13" y="13" width="31" height="31" rx="10" fill="#F5A3C7"/><path d="M23 13H34A10 10 0 0 1 44 23V23H13V23A10 10 0 0 1 23 13Z" fill="#f8bfd8"/><path d="M44 23V34A10 10 0 0 1 34 44Q37.8 44 37.8 38V23Z" fill="#c986a3"/></g><g opacity=".48"><rect x="41" y="11" width="31" height="31" rx="10" fill="#FFB36B"/><path d="M51 11H62A10 10 0 0 1 72 21V21H41V21A10 10 0 0 1 51 11Z" fill="#ffca97"/><path d="M72 21V32A10 10 0 0 1 62 42Q65.8 42 65.8 36V21Z" fill="#d19358"/></g><g opacity=".48"><rect x="11" y="41" width="31" height="31" rx="10" fill="#B9A6FF"/><path d="M21 41H32A10 10 0 0 1 42 51V51H11V51A10 10 0 0 1 21 41Z" fill="#cec1ff"/><path d="M42 51V62A10 10 0 0 1 32 72Q35.8 72 35.8 66V51Z" fill="#9888d1"/></g><g ><rect x="35" y="35" width="53" height="53" rx="16" fill="#8FD3FF"/><path d="M51 35H72A16 16 0 0 1 88 51V51H35V51A16 16 0 0 1 51 35Z" fill="#b1e0ff"/><path d="M88 51V72A16 16 0 0 1 72 88Q77.4 88 77.4 78.4V51Z" fill="#75add1"/></g><g  fill="#151320"><rect x="44.93" y="57.55" width="7.55" height="16.9" rx="3.77"/><rect x="59.52" y="57.95" width="7.55" height="16.9" rx="3.77"/></g>
</svg>`;

const page = body => `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Outfit;font-weight:500 900;src:url(${FONT})}
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

/* the App Store's icon: the full square, edge to edge, since iOS rounds the corners itself;
   and the launch screen, the mark alone in the middle of a big square that iOS crops */
const appIcon = size => page(`<div style="width:${size}px;height:${size}px;display:grid;place-items:center">
  <div style="width:${size * .62}px;height:${size * .62}px">${MARK}</div></div>`);
const launch = size => page(`<div style="width:${size}px;height:${size}px;display:grid;place-items:center">
  <div style="width:${size * .1}px;height:${size * .1}px">${MARK}</div></div>`);

/* App Store Connect refuses an icon with an alpha channel, even a fully opaque one, and a
   browser screenshot always has one. So the iOS images are re-encoded as plain RGB here,
   with nothing but Node: undo the PNG row filters, drop every fourth byte, write it back. */
const zlib = require("zlib");
const CRC = Array.from({ length:256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4), crc = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type), data]);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
function dropAlpha(png) {
  let pos = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (pos < png.length) { const len = png.readUInt32BE(pos), type = png.toString("ascii", pos + 4, pos + 8), data = png.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; if (data[8] !== 8 || data[12]) throw new Error("unexpected PNG"); }
    if (type === "IDAT") idat.push(data); pos += 12 + len; }
  if (ct === 2) return png;
  const bpp = 4, stride = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) { const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride;
    for (let x = 0; x < stride; x++) { const a = x >= bpp ? px[row + x - bpp] : 0, b = y ? px[row - stride + x] : 0, c = x >= bpp && y ? px[row - stride + x - bpp] : 0;
      const pr = () => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
      px[row + x] = (src[x] + [0, a, b, (a + b) >> 1, pr()][f]) & 255; } }
  const out = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.copy(out, y * (w * 3 + 1) + 1 + x * 3, y * stride + x * 4, y * stride + x * 4 + 3);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([png.subarray(0, 8), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(out, { level:9 })), chunk("IEND", Buffer.alloc(0))]); }

const JOBS = [
  ["rooms-180.png", 180, 180, icon(180, .6)], ["rooms-192.png", 192, 192, icon(192, .6)], ["rooms-512.png", 512, 512, icon(512, .6)],
  ["rooms-mask-192.png", 192, 192, icon(192, .46)], ["rooms-mask-512.png", 512, 512, icon(512, .46)],
  ...[[750, 1334], [828, 1792], [1125, 2436], [1170, 2532], [1179, 2556], [1206, 2622], [1290, 2796], [1320, 2868]]
    .map(([w, h]) => [`splash-${w}x${h}.png`, w, h, splash(w, h)]),
  ["og.png", 1200, 630, og()],
  /* the iPhone app's, once the Xcode project exists (npx cap add ios) */
  ...(fs.existsSync(IOS) ? [["AppIcon.appiconset/AppIcon-512@2x.png", 1024, 1024, appIcon(1024), IOS],
    ...["", "-1", "-2"].map(n => [`Splash.imageset/splash-2732x2732${n}.png`, 2732, 2732, launch(2732), IOS])] : [])];

(async () => {
  const browser = await chromium.launch(), p = await browser.newPage();
  for (const [name, w, h, html, dir = OUT] of JOBS) {
    await p.setViewportSize({ width: w, height: h });
    await p.setContent(html); await p.evaluate(() => document.fonts.ready);
    const shot = await p.screenshot();
    fs.writeFileSync(path.join(dir, name), dir === IOS ? dropAlpha(shot) : shot);
    console.log("drew", name);
  }
  await browser.close();
})();
