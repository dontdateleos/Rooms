// Paints every piñata in every palette: icons/pinatas/<animal>-<f|l>.webp (cut by
// tools/pinatas.cjs) into icons/pinatas/<animal>-<f|l>-<n>.webp, one for each palette in
// PIN_PALS in index.html (read from there, so the two can't drift apart).
//
// A palette is the head's colour, then the bands down the fringes: the head takes the top
// half or so of the piñata, the rest of its height is split evenly between the other
// colours, with a soft join between each. Each pixel keeps the paper's light and shade (how
// bright it is against the animal's brightest paper), in its band's colour. The eyes, the
// pupils and anything black (noses, the panda's and zebra's black, the beaks) are left
// exactly as drawn.
//
// Run after tools/pinatas.cjs, or after changing PIN_PALS:
//   NODE_PATH=$(npm root -g) node tools/pinata-colours.cjs   (needs Playwright, for its canvas)
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");

const ROOT = path.join(__dirname, ".."), DIR = path.join(ROOT, "icons/pinatas");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const PALS = Function(`return ${html.match(/const PIN_PALS = (\[[\s\S]*?\]);/)[1]}`)();
/* some eyes by hand (x, y, radius of the white, in the 192px frame): the white animals',
   whose paper is as white as their eyes, so the eyes can't be told apart by colour */
const EYES = {
  "panda-f":[[79, 86, 12], [124, 85, 12]], "panda-l":[[87, 85, 15], [48, 75, 9]],
  "zebra-f":[[60, 71, 16], [130, 72, 16]], "zebra-l":[[100, 78, 17]],
  "unicorn-f":[[64, 92, 11], [127, 92, 11]], "unicorn-l":[[100, 92, 15]],
  /* and the front views' side-on eyes, which the search misses */
  "goat-f":[[68, 86, 11], [123, 86, 11]], "crocodile-f":[[55, 87, 12], [141, 93, 10]], "bull-f":[[59, 83, 10], [125, 83, 10]],
  "giraffe-f":[[64, 88, 11], [127, 88, 11]], "horse-f":[[58, 87, 9], [134, 89, 8]], "donkey-f":[[60, 91, 12], [129, 90, 12]] };
const ANIMALS = Function(`return ${html.match(/const PINATAS = (\[[^\]]*\]);/)[1]}`)();

(async () => {
  const b = await chromium.launch(), p = await b.newPage(); await p.setContent("<body></body>");
  const frames = {}; for (const a of ANIMALS) for (const f of ["f", "l"]) frames[`${a}-${f}`] = fs.readFileSync(path.join(DIR, `${a}-${f}.webp`)).toString("base64");
  const out = await p.evaluate(async ({ frames, PALS, EYES }) => {
    const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const files = {}, S = 192, prev = document.createElement("canvas"); prev.width = S * PALS.length; prev.height = S * 2;
    const pv = prev.getContext("2d"); pv.fillStyle = "#15131c"; pv.fillRect(0, 0, prev.width, prev.height);
    for (const [name, b64] of Object.entries(frames)) {
      const im = new Image(); im.src = "data:image/webp;base64," + b64; await im.decode();
      const W = im.width, H = im.height, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      const cx = cv.getContext("2d"); cx.drawImage(im, 0, 0); const base = cx.getImageData(0, 0, W, H).data;
      const L = k => (base[k * 4] + base[k * 4 + 1] + base[k * 4 + 2]) / 3;
      const span = k => { const i = k * 4; return Math.max(base[i], base[i + 1], base[i + 2]) - Math.min(base[i], base[i + 1], base[i + 2]); };
      const on = k => base[k * 4 + 3] > 0;
      /* what stays as drawn: anything black, and the googly eyes. An eye is a dark pupil with
         white round it (or, seen from the side at the edge of a face, round most of it): each
         pupil's white is found by looking outward from it, and kept out to where it stops */
      const keep = new Uint8Array(W * H), dark = new Uint8Array(W * H);
      for (let k = 0; k < W * H; k++) if (on(k) && L(k) < 80 && span(k) < 22) { keep[k] = 1; dark[k] = 1; }
      const comps = (test, cb) => { const seen = new Uint8Array(W * H);
        for (let k0 = 0; k0 < W * H; k0++) { if (seen[k0] || !test(k0)) continue; const st = [k0], pc = []; seen[k0] = 1;
          while (st.length) { const k = st.pop(); pc.push(k); const x = k % W, y = (k / W) | 0;
            for (const j of [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, y > 0 ? k - W : -1, y < H - 1 ? k + W : -1]) if (j >= 0 && !seen[j] && test(j)) { seen[j] = 1; st.push(j); } }
          cb(pc); } };
      const white = k => on(k) && L(k) > 175 && span(k) < 40;
      const byHand = EYES[name];
      if (byHand) byHand.forEach(([ex, ey, R]) => { for (let y = ey - R; y <= ey + R; y++) for (let x = ex - R; x <= ex + R; x++) { if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const k = y * W + x; if (on(k) && (x - ex) ** 2 + (y - ey) ** 2 <= R * R && span(k) < 45) keep[k] = 1; } });
      else comps(k => dark[k], pc => { if (pc.length < 12 || pc.length > 1600) return;
        let sx = 0, sy = 0; pc.forEach(k => { sx += k % W; sy += (k / W) | 0; }); const cx0 = sx / pc.length, cy0 = sy / pc.length, r = Math.sqrt(pc.length / Math.PI);
        let light = 0, open = 0, far = 0; const reach = [];
        for (let a = 0; a < 16; a++) { const dx = Math.cos(a * Math.PI / 8), dy = Math.sin(a * Math.PI / 8); let t = r * .7, met = false, skip = 0;
          while (t < r * 3.2) { const x = Math.round(cx0 + dx * t), y = Math.round(cy0 + dy * t); if (x < 0 || y < 0 || x >= W || y >= H || !on(y * W + x)) { open++; break; }
            const k = y * W + x; if (white(k)) { met = true; skip = 0; } else if (met) break; else if (!dark[k] && ++skip > 4) break; t += .5; }
          if (met) { light++; reach.push(t); if (t >= r * 3.2) far++; } }
        /* a googly eye's white is a ring that stops at an edge; a nose sits in fur that goes on */
        if (pc.length > 700 || light < 5 || light + open < 12 || far > 3) return;
        reach.sort((a, b) => a - b); const R = Math.min(reach[Math.floor(reach.length * .3)], r * 2.4) + 1.2;
        for (let y = Math.floor(cy0 - R); y <= cy0 + R; y++) for (let x = Math.floor(cx0 - R); x <= cx0 + R; x++) { if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const k = y * W + x; if (on(k) && (x - cx0) ** 2 + (y - cy0) ** 2 <= R * R && span(k) < 45) keep[k] = 1; } });
      /* and a googly eye's white is pure white, unlike any paper but the unicorn's */
      if (!byHand) comps(k => on(k) && L(k) > 215 && span(k) < 14, pc => { if (pc.length >= 30) pc.forEach(k => keep[k] = 1); });
      const V = new Float32Array(W * H); let T = H, B = 0; const vs = [];
      for (let k = 0; k < W * H; k++) { const i = k * 4; if (!base[i + 3]) continue; const mx = Math.max(base[i], base[i + 1], base[i + 2]);
        V[k] = mx; if (base[i + 3] > 128) { const y = (k / W) | 0; if (y < T) T = y; if (y > B) B = y; if (!keep[k]) vs.push(mx); } }
      vs.sort((a, b) => a - b); const vref = vs[Math.floor(vs.length * .85)] || 255;
      PALS.forEach((pal, n) => {
        const cols = pal.c.map(hex), head = cols.length > 3 ? .5 : .62, rest = (1 - head) / (cols.length - 1);
        const edges = cols.slice(1).map((_, i) => head + i * rest), SOFT = .025;
        const colAt = t => { let c = cols[0].slice();
          edges.forEach((e, i) => { const w = Math.min(1, Math.max(0, (t - (e - SOFT)) / (2 * SOFT))); const s = w * w * (3 - 2 * w); c = c.map((v, k) => v + (cols[i + 1][k] - v) * s); });
          return c; };
        const id = cx.createImageData(W, H), d = id.data;
        for (let k = 0; k < W * H; k++) { const i = k * 4; d[i + 3] = base[i + 3]; if (!base[i + 3]) continue;
          if (keep[k]) { d[i] = base[i]; d[i + 1] = base[i + 1]; d[i + 2] = base[i + 2]; continue; }
          const y = (k / W) | 0, c = colAt((y - T) / Math.max(1, B - T)), s = V[k] / vref;
          for (let j = 0; j < 3; j++) d[i + j] = Math.round(s <= 1 ? c[j] * s : c[j] + (255 - c[j]) * Math.min(1, (s - 1) * 2)); }
        const o = document.createElement("canvas"); o.width = W; o.height = H; o.getContext("2d").putImageData(id, 0, 0);
        files[`${name}-${n}.webp`] = o.toDataURL("image/webp", .86).split(",")[1];
        if (name.startsWith("horse-") || name.startsWith("panda-")) pv.drawImage(o, n * S, (name.startsWith("horse-l") ? 0 : name.startsWith("panda-l") ? 1 : -1) * S); }); }
    files["_preview.png"] = prev.toDataURL("image/png").split(",")[1];
    return files; }, { frames, PALS, EYES });
  let n = 0;
  for (const [f, b64] of Object.entries(out)) {
    if (f.startsWith("_")) { fs.writeFileSync(process.env.PREVIEW || path.join(require("os").tmpdir(), "pinata-colours.png"), Buffer.from(b64, "base64")); continue; }
    fs.writeFileSync(path.join(DIR, f), Buffer.from(b64, "base64")); n++; }
  console.log(n, "painted frames in icons/pinatas/");
  await b.close(); })();
