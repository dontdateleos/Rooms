// Cuts the piñata mascots out of art/pinatas-sheet.png into icons/pinatas/<animal>-<f|l|r>.webp.
// The sheet is six animals (rows) by six angles (columns): front, facing left, facing right,
// looking up, looking down, back. The app uses the first three; looking up and down are the
// front tilted in the app, because several of the sheet's own up and down frames are broken.
// The cat's front frame is broken too (drooping eyes, black smudges), so its front is the
// sheet's cat looking up, which faces you square with clean eyes.
//
// Each frame: the dark background taken out (only where it joins the edge, so pupils, noses
// and whiskers stay), a soft edge un-mixed from the background so there's no dark fringe on
// a light page, then every frame of an animal at one scale, centred, standing on one line.
//
// Run: NODE_PATH=$(npm root -g) node tools/pinatas.cjs   (needs Playwright, for its canvas)
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");

const ROOT = path.join(__dirname, ".."), SRC = path.join(ROOT, "art/pinatas-sheet.png"), OUT = path.join(ROOT, "icons/pinatas");
const ANIMALS = ["llama", "dog", "cat", "chicken", "cow", "bunny"];
/* the sheet's cells, found by where its columns and rows of pixels stop being background */
const COLS = [[44, 211], [272, 426], [480, 637], [702, 837], [867, 1012], [1042, 1174]];
const ROWS = [[38, 220], [272, 408], [456, 607], [648, 814], [852, 1004], [1043, 1225]];
const FRAMES = { f:0, l:1, r:2 };
const SWAP = { "cat-f":3 };                     /* a better cell for a frame the sheet got wrong */
const SIZE = 224, FOOT = .93, FIT = .9;        /* output square, where they stand, how much of it they fill */

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch(), p = await b.newPage();
  await p.setContent("<body></body>");
  const out = await p.evaluate(async ({ png, ANIMALS, COLS, ROWS, FRAMES, SWAP, SIZE, FOOT, FIT }) => {
    const im = new Image(); im.src = "data:image/png;base64," + png; await im.decode();
    const sheet = document.createElement("canvas"); sheet.width = im.width; sheet.height = im.height;
    const sx = sheet.getContext("2d"); sx.drawImage(im, 0, 0);
    const BG = [18, 17, 20], LO = 24, HI = 64;
    const diff = (d, i) => Math.max(Math.abs(d[i] - BG[0]), Math.abs(d[i + 1] - BG[1]), Math.abs(d[i + 2] - BG[2]));
    /* one cell, cut out: returns a canvas with alpha and the bounding box of what's left */
    const cut = (r, c, mirrorAt) => {
      const pad = 8, x0 = COLS[c][0] - pad, y0 = ROWS[r][0] - pad, w = COLS[c][1] - COLS[c][0] + pad * 2, h = ROWS[r][1] - ROWS[r][0] + pad * 2;
      const id = sx.getImageData(x0, y0, w, h), d = id.data;
      /* the background is what's dark and joined to the edge */
      const out = new Uint8Array(w * h), q = [];
      for (let x = 0; x < w; x++) { q.push(x, (h - 1) * w + x); } for (let y = 0; y < h; y++) { q.push(y * w, y * w + w - 1); }
      while (q.length) { const k = q.pop(); if (out[k]) continue; if (diff(d, k * 4) > LO) continue; out[k] = 1;
        const x = k % w, y = (k / w) | 0;
        if (x > 0) q.push(k - 1); if (x < w - 1) q.push(k + 1); if (y > 0) q.push(k - w); if (y < h - 1) q.push(k + w); }
      /* a soft edge: next to the background, how far from it says how solid, and the colour
         is taken back out of the dark it was mixed with */
      for (let k = 0; k < w * h; k++) { const i = k * 4;
        if (out[k]) { d[i + 3] = 0; continue; }
        const x = k % w, y = (k / w) | 0;
        const edge = (x > 0 && out[k - 1]) || (x < w - 1 && out[k + 1]) || (y > 0 && out[k - w]) || (y < h - 1 && out[k + w]);
        if (!edge) continue; const df = diff(d, i); if (df >= HI) continue;
        const a = Math.max(.05, (df - LO) / (HI - LO));
        for (let ch = 0; ch < 3; ch++) d[i + ch] = Math.max(0, Math.min(255, Math.round((d[i + ch] - BG[ch] * (1 - a)) / a)));
        d[i + 3] = Math.round(a * 255); }
      /* the cat's front: its left half is its right half, mirrored about the nose */
      if (mirrorAt) { let sum = 0, n = 0;
        for (let k = 0; k < w * h; k++) { const i = k * 4, R = d[i], G = d[i + 1], B = d[i + 2], y = (k / w) | 0;
          if (d[i + 3] > 200 && R > 200 && G < 130 && B > 90 && B < 190 && y > h * .45 && y < h * .8) { sum += k % w; n++; } }
        const cx = n ? Math.round(sum / n) : Math.round(w / 2);
        for (let y = 0; y < h; y++) for (let x = 0; x < cx; x++) { const m = 2 * cx - x; if (m >= w) continue;
          const a = (y * w + x) * 4, b2 = (y * w + m) * 4; for (let ch = 0; ch < 4; ch++) d[a + ch] = d[b2 + ch]; } }
      /* stray specks: keep only pieces at least a fiftieth the size of the biggest one */
      { const lab = new Int32Array(w * h).fill(-1), sizes = []; let n = 0;
        for (let k0 = 0; k0 < w * h; k0++) { if (lab[k0] >= 0 || d[k0 * 4 + 3] <= 40) continue; let sz = 0; const st = [k0]; lab[k0] = n;
          while (st.length) { const k = st.pop(); sz++; const x = k % w, y = (k / w) | 0;
            for (const j of [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, y > 0 ? k - w : -1, y < h - 1 ? k + w : -1])
              if (j >= 0 && lab[j] < 0 && d[j * 4 + 3] > 40) { lab[j] = n; st.push(j); } }
          sizes.push(sz); n++; }
        const big = Math.max(0, ...sizes);
        for (let k = 0; k < w * h; k++) { const l = lab[k]; if (l >= 0 ? sizes[l] < big / 50 : d[k * 4 + 3] > 0 && d[k * 4 + 3] <= 40) d[k * 4 + 3] = 0; } }
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h; cv.getContext("2d").putImageData(id, 0, 0);
      let L = w, T = h, Rr = 0, B = 0;
      for (let k = 0; k < w * h; k++) if (d[k * 4 + 3] > 40) { const x = k % w, y = (k / w) | 0; if (x < L) L = x; if (x > Rr) Rr = x; if (y < T) T = y; if (y > B) B = y; }
      return { cv, box:[L, T, Rr - L + 1, B - T + 1] }; };
    const files = {}, preview = document.createElement("canvas"); preview.width = SIZE * 3; preview.height = SIZE * ANIMALS.length;
    const px = preview.getContext("2d"); px.fillStyle = "#16131C"; px.fillRect(0, 0, preview.width, preview.height);
    ANIMALS.forEach((name, r) => {
      const cuts = Object.fromEntries(Object.entries(FRAMES).map(([k, c]) => [k, cut(r, SWAP[`${name}-${k}`] ?? c)]));
      /* one scale for the whole animal: its biggest frame fills FIT of the square */
      const big = Math.max(...Object.values(cuts).map(c => Math.max(c.box[2], c.box[3])));
      const s = SIZE * FIT / big;
      Object.entries(cuts).forEach(([k, { cv, box }]) => {
        const o = document.createElement("canvas"); o.width = o.height = SIZE; const ox = o.getContext("2d");
        ox.imageSmoothingQuality = "high";
        const w = box[2] * s, h = box[3] * s, dx = (SIZE - w) / 2, dy = SIZE * FOOT - h;
        ox.drawImage(cv, box[0], box[1], box[2], box[3], dx, dy, w, h);
        files[`${name}-${k}.webp`] = o.toDataURL("image/webp", .86).split(",")[1];
        px.drawImage(o, FRAMES[k] * SIZE, r * SIZE); }); });
    files["_preview.png"] = preview.toDataURL("image/png").split(",")[1];
    return files; }, { png:fs.readFileSync(SRC).toString("base64"), ANIMALS, COLS, ROWS, FRAMES, SWAP, SIZE, FOOT, FIT });
  for (const [f, b64] of Object.entries(out)) {
    if (f.startsWith("_")) { fs.writeFileSync(process.env.PREVIEW || path.join(require("os").tmpdir(), "pinatas-preview.png"), Buffer.from(b64, "base64")); continue; }
    fs.writeFileSync(path.join(OUT, f), Buffer.from(b64, "base64")); }
  console.log(Object.keys(out).filter(f => !f.startsWith("_")).length, "frames in icons/pinatas/");
  await b.close(); })();
