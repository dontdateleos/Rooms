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

/* the mark: four rooms, three with the lights off and one lit with someone home */
/* each room is drawn like the faces: a lit top, a shaded side */
const MARK = `<svg viewBox="10 10 80 80" xmlns="http://www.w3.org/2000/svg">
  <clipPath id="i28"><rect x="12" y="12" width="37" height="37" rx="11"/></clipPath><g opacity=".48" clip-path="url(#i28)"><rect x="12" y="12" width="37" height="37" fill="#b0758f"/><rect x="12" y="12" width="29" height="37" rx="11" fill="#f9cadf"/><rect x="12" y="20" width="29" height="29" rx="11" fill="#F5A3C7"/><rect x="12" y="31" width="29" height="18" fill="#F5A3C7"/></g>
  <clipPath id="i29"><rect x="51" y="12" width="37" height="37" rx="11"/></clipPath><g opacity=".48" clip-path="url(#i29)"><rect x="51" y="12" width="37" height="37" fill="#b8814d"/><rect x="51" y="12" width="29" height="37" rx="11" fill="#ffd3a9"/><rect x="51" y="20" width="29" height="29" rx="11" fill="#FFB36B"/><rect x="51" y="31" width="29" height="18" fill="#FFB36B"/></g>
  <clipPath id="i30"><rect x="12" y="51" width="37" height="37" rx="11"/></clipPath><g opacity=".48" clip-path="url(#i30)"><rect x="12" y="51" width="37" height="37" fill="#8578b8"/><rect x="12" y="51" width="29" height="37" rx="11" fill="#d6cbff"/><rect x="12" y="59" width="29" height="29" rx="11" fill="#B9A6FF"/><rect x="12" y="70" width="29" height="18" fill="#B9A6FF"/></g>
  <clipPath id="i31"><rect x="51" y="51" width="37" height="37" rx="11"/></clipPath><g clip-path="url(#i31)"><rect x="51" y="51" width="37" height="37" fill="#6798b8"/><rect x="51" y="51" width="29" height="37" rx="11" fill="#bee5ff"/><rect x="51" y="59" width="29" height="29" rx="11" fill="#8FD3FF"/><rect x="51" y="70" width="29" height="18" fill="#8FD3FF"/></g>
  <g fill="#151320"><rect x="57" y="59.5" width="5.6" height="12.5" rx="2.8"/><rect x="67.8" y="59.5" width="5.6" height="12.5" rx="2.8"/></g></svg>`;

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
