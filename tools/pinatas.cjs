// Cuts the piñata mascots out of art/pinatas-16.png into icons/pinatas/<animal>-<f|l>.webp.
// The sheet is sixteen animals, four by four, each drawn three ways: three-quarters facing
// left, front, and back. The app uses the first two; facing right is the left one mirrored.
//
// The background is a warm cream (a little different in each cell, so each cell measures
// its own), with soft shadows under each piñata. It's filled in from the edge of the cell
// through anything of the cream's tint that's smooth: every piñata has a faint edge where it
// meets the cream, which stops the fill, so the panda's, zebra's and unicorn's whites stay
// even where they're nearly the cream's colour. Along the bottom the fill also takes the
// shadows (light, reddish, washed out). The three views are split at the gaps between them
// (or their thinnest column, where they touch), anything below each one's base is cleared,
// the edge softened and the cream un-mixed from it, and both frames of an animal set at one
// scale on one line.
//
// Run: NODE_PATH=$(npm root -g) node tools/pinatas.cjs   (needs Playwright, for its canvas)
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");

const ROOT = path.join(__dirname, ".."), SRC = path.join(ROOT, "art/pinatas-16.png"), OUT = path.join(ROOT, "icons/pinatas");
const ANIMALS = ["horse", "donkey", "bull", "dog", "bear", "panda", "chicken", "pig", "crocodile", "goat", "ram", "parrot", "flamingo", "zebra", "giraffe", "unicorn"];
/* each row's band of pictures, between its titles and its labels; columns are quarters */
const BANDS = [[44, 224], [306, 470], [553, 709], [789, 966]];
const SIZE = 192, FOOT = .95, FIT = .92;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch(), p = await b.newPage();
  await p.setContent("<body></body>");
  const out = await p.evaluate(async ({ png, ANIMALS, BANDS, SIZE, FOOT, FIT }) => {
    const im = new Image(); im.src = "data:image/png;base64," + png; await im.decode();
    const sheet = document.createElement("canvas"); sheet.width = im.width; sheet.height = im.height;
    const sx = sheet.getContext("2d"); sx.drawImage(im, 0, 0);
    const CW = im.width / 4; let BG = [251, 234, 219];
    /* how far a pixel's tint is from the cream's (about R-B 32, G-B 15, but it drifts across
       the sheet, so each cell measures its own from its edges) */
    const tint = (d, i) => Math.abs((d[i] - d[i + 2]) - (BG[0] - BG[2])) + Math.abs((d[i + 1] - d[i + 2]) - (BG[1] - BG[2]));
    const LO = 11, HI = 26;
    const files = {}, prev = document.createElement("canvas"); prev.width = SIZE * 8; prev.height = SIZE * 4;
    const pv = prev.getContext("2d"); pv.fillStyle = "#16131C"; pv.fillRect(0, 0, prev.width, prev.height);
    ANIMALS.forEach((name, n) => {
      const col = n % 4, row = n >> 2, x0 = Math.round(col * CW) + 4, y0 = BANDS[row][0], w = Math.round(CW) - 8, h = BANDS[row][1] - BANDS[row][0];
      const id = sx.getImageData(x0, y0, w, h), d = id.data, bg = new Uint8Array(w * h), q = [];
      { const edge = []; for (let x = 0; x < w; x += 2) edge.push(x * 4, ((h - 1) * w + x) * 4); for (let y = 0; y < h; y += 2) edge.push(y * w * 4, (y * w + w - 1) * 4);
        const med = c => { const v = edge.map(i => d[i + c]).sort((a, b) => a - b); return v[v.length >> 1]; }; BG = [med(0), med(1), med(2)]; }
      for (let x = 0; x < w; x++) q.push(x, (h - 1) * w + x); for (let y = 0; y < h; y++) q.push(y * w, y * w + w - 1);
      /* how sharply each pixel differs from its neighbours: the cream and the shadows are
         smooth, and every piñata, even a white one, has a faint edge where it meets them */
      const gr = new Uint8Array(w * h);
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const k = y * w + x, i = k * 4; let m = 0;
        for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(d[i + 4 + c] - d[i - 4 + c]) + Math.abs(d[i + w * 4 + c] - d[i - w * 4 + c])); gr[k] = Math.min(255, m); }
      /* the shadows under the piñatas are the cream darker and warmer, so along the bottom of
         the band anything light, reddish and washed out is background too (a white piñata's
         white is cooler than the cream, a pink one is stronger) */
      const shade = (k, y) => { if (y < h - 40) return false; const i = k * 4, l = (d[i] + d[i + 1] + d[i + 2]) / 3;
        const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
        return gr[k] < 28 && l > 140 && d[i] === mx && d[i] - d[i + 2] >= 10 && mx - mn < 62; };
      const GR = 12;
      while (q.length) { const k = q.pop(); if (bg[k]) continue; const ky = (k / w) | 0; if (!((tint(d, k * 4) <= LO && gr[k] < GR) || shade(k, ky))) continue; bg[k] = 1; const x = k % w, y = ky;
        if (x > 0) q.push(k - 1); if (x < w - 1) q.push(k + 1); if (y > 0) q.push(k - w); if (y < h - 1) q.push(k + w); }
      /* the fill stops a pixel short of each edge (that pixel's neighbours differ): take off
         the cream-coloured ring it leaves, or it shows as a light halo */
      for (let pass = 0; pass < 2; pass++) { const ring = [];
        for (let k = 0; k < w * h; k++) { if (bg[k]) continue; const x = k % w, y = (k / w) | 0;
          if (((x > 0 && bg[k - 1]) || (x < w - 1 && bg[k + 1]) || (y > 0 && bg[k - w]) || (y < h - 1 && bg[k + w])) && (tint(d, k * 4) <= LO + 4 || shade(k, y))) ring.push(k); }
        ring.forEach(k => bg[k] = 1); }
      /* the soft edge: next to the background, how unlike the cream says how solid */
      for (let k = 0; k < w * h; k++) { const i = k * 4; if (bg[k]) { d[i + 3] = 0; continue; }
        const x = k % w, y = (k / w) | 0, edge = (x > 0 && bg[k - 1]) || (x < w - 1 && bg[k + 1]) || (y > 0 && bg[k - w]) || (y < h - 1 && bg[k + w]);
        if (!edge) continue; const t = tint(d, i); if (t >= HI) continue; const a = Math.max(.08, (t - LO) / (HI - LO));
        for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, Math.round((d[i + c] - BG[c] * (1 - a)) / a))); d[i + 3] = Math.round(a * 255); }
      /* the three pictures, by the gaps between them above the shadows (the shadows can join
         them at the bottom): runs of columns with something in them, the three widest */
      const SH = 12, cols = new Array(w).fill(0);
      for (let y = 0; y < h - SH; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] >= 40) cols[x]++;
      let runs = [], st0 = -1; for (let x = 0; x <= w; x++) { const on = x < w && cols[x] > 1; if (on && st0 < 0) st0 = x; if (!on && st0 >= 0) { runs.push([st0, x - 1]); st0 = -1; } }
      runs = runs.reduce((m, r) => { const last = m[m.length - 1]; if (last && r[0] - last[1] < 5) last[1] = r[1]; else m.push(r.slice()); return m; }, []);
      /* where two pictures touch (a horn, a tail, a shadow), split the widest run at its
         thinnest column, away from its ends, until there are three */
      while (runs.length < 3) { const r = runs.reduce((m, q) => q[1] - q[0] > m[1] - m[0] ? q : m), span = r[1] - r[0];
        let at = -1; for (let x = r[0] + (span * .2 | 0); x <= r[1] - (span * .2 | 0); x++) if (at < 0 || cols[x] < cols[at]) at = x;
        runs.splice(runs.indexOf(r), 1, [r[0], at - 1], [at + 1, r[1]]); runs.sort((p, q) => p[0] - q[0]); }
      runs = runs.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0])).slice(0, 3).sort((a, b) => a[0] - b[0]);
      /* each picture's own column range: out to halfway to its neighbours */
      const ranges = runs.map((r, i) => [i ? Math.ceil((runs[i - 1][1] + r[0]) / 2) : 0, i < runs.length - 1 ? Math.floor((r[1] + runs[i + 1][0]) / 2) : w - 1]);
      /* where the fringe ends: the lowest row with a few properly solid pixels (strong colour,
         black or white); below it is only shadow */
      const solid = i => { const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]), l = (d[i] + d[i + 1] + d[i + 2]) / 3;
        return d[i + 3] >= 200 && (mx - mn > 70 || l < 60 || (l > 205 && mx - mn < 14)); };
      const lab = new Int32Array(w * h).fill(-1), comps = ranges.map((r, n) => ({ n, L:w, R:0, T:h, B:0 }));
      ranges.forEach(([a, b2], n) => { let base = h - 1;
        for (let y = h - 1; y > 0; y--) { let k = 0; for (let x = a; x <= b2; x++) if (solid((y * w + x) * 4)) k++; if (k >= 5) { base = y; break; } }
        for (let y = 0; y < h; y++) for (let x = a; x <= b2; x++) { const k = y * w + x;
          if (y > base + 1) { d[k * 4 + 3] = 0; continue; } if (d[k * 4 + 3] >= 40) lab[k] = n; } });
      /* specks: inside each picture keep the main piece and anything a fiftieth its size */
      const seen = new Uint8Array(w * h);
      comps.forEach(c => { const pieces = [];
        for (let k0 = 0; k0 < w * h; k0++) { if (seen[k0] || lab[k0] !== c.n) continue; const st = [k0], px = []; seen[k0] = 1;
          while (st.length) { const k = st.pop(); px.push(k); const x = k % w, y = (k / w) | 0;
            for (const j of [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, y > 0 ? k - w : -1, y < h - 1 ? k + w : -1]) if (j >= 0 && !seen[j] && lab[j] === c.n) { seen[j] = 1; st.push(j); } }
          pieces.push(px); }
        const big = Math.max(0, ...pieces.map(p => p.length));
        pieces.forEach(px => { if (px.length < big / 50) px.forEach(k => { lab[k] = -1; d[k * 4 + 3] = 0; });
          else px.forEach(k => { const x = k % w, y = (k / w) | 0; if (x < c.L) c.L = x; if (x > c.R) c.R = x; if (y < c.T) c.T = y; if (y > c.B) c.B = y; }); }); });
      const big = comps;
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h; cv.getContext("2d").putImageData(id, 0, 0);
      /* a little fringe of each picture's neighbour can sit inside its box: mask by its own piece */
      const pick = c => { const pw = c.R - c.L + 1, ph = c.B - c.T + 1, o = document.createElement("canvas"); o.width = pw; o.height = ph;
        const ox = o.getContext("2d"); ox.drawImage(cv, c.L, c.T, pw, ph, 0, 0, pw, ph); const od = ox.getImageData(0, 0, pw, ph);
        const near = (X, Y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = c.L + X + dx, yy = c.T + Y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && lab[yy * w + xx] === c.n) return true; } return false; };
        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const l = lab[(c.T + y) * w + c.L + x];
          if ((l >= 0 && l !== c.n) || (l < 0 && !near(x, y))) od.data[(y * pw + x) * 4 + 3] = 0; }
        ox.putImageData(od, 0, 0); return o; };
      const [L, F] = big, s = SIZE * FIT / Math.max(L.R - L.L + 1, L.B - L.T + 1, F.R - F.L + 1, F.B - F.T + 1);
      [["l", L], ["f", F]].forEach(([k, c], j) => { const o = document.createElement("canvas"); o.width = o.height = SIZE; const ox = o.getContext("2d"); ox.imageSmoothingQuality = "high";
        const pw = (c.R - c.L + 1) * s, ph = (c.B - c.T + 1) * s; ox.drawImage(pick(c), (SIZE - pw) / 2, SIZE * FOOT - ph, pw, ph);
        files[`${name}-${k}.webp`] = o.toDataURL("image/webp", .88).split(",")[1];
        pv.drawImage(o, (col * 2 + j) * SIZE, row * SIZE); }); });
    files["_preview.png"] = prev.toDataURL("image/png").split(",")[1];
    return files; }, { png:fs.readFileSync(SRC).toString("base64"), ANIMALS, BANDS, SIZE, FOOT, FIT });
  for (const [f, b64] of Object.entries(out)) {
    if (f.startsWith("_")) { fs.writeFileSync(process.env.PREVIEW || path.join(require("os").tmpdir(), "pinatas-preview.png"), Buffer.from(b64, "base64")); continue; }
    fs.writeFileSync(path.join(OUT, f), Buffer.from(b64, "base64")); }
  console.log(Object.keys(out).filter(f => !f.startsWith("_")).length, "frames in icons/pinatas/");
  await b.close(); })();
