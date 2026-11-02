// Gathers what the iPhone app ships into www/, which Capacitor copies into the Xcode project.
// The app is the same single page the website serves, bundled on the phone rather than
// loaded from the web: it opens offline, and App Review sees an app, not a website.
// Run with `npm run build` (or `npm run ios`, which also syncs and opens Xcode).
import { cpSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), ".."), OUT = join(ROOT, "www");
/* the page, the demo it can show, the privacy page it links to, and what they load.
   Not the marketing site, the service worker (the app has no use for one) or the
   splash screens the website's home-screen install uses (the app has its own). */
const FILES = ["index.html", "demo.js", "privacy.html", "terms.html", "manifest.webmanifest"];
const DIRS = ["vendor", "icons"];

rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT);
for (const f of FILES) cpSync(join(ROOT, f), join(OUT, f));
for (const d of DIRS) if (existsSync(join(ROOT, d)))
  cpSync(join(ROOT, d), join(OUT, d), { recursive: true, filter: src => !/splash-\d+x\d+\.png$/.test(src) });
/* Capacitor's own runtime, which the website never needs: its browser build, loaded ahead
   of the app's script so window.Capacitor.registerPlugin is there when the page asks. */
cpSync(join(ROOT, "node_modules/@capacitor/core/dist/capacitor.js"), join(OUT, "vendor/capacitor.js"));
const page = join(OUT, "index.html"), html = readFileSync(page, "utf8");
if (!html.includes('<script type="module">')) throw new Error("index.html: couldn't find where to load Capacitor");
writeFileSync(page, html.replace('<script type="module">', '<script src="./vendor/capacitor.js"></script>\n<script type="module">'));
console.log("www/ ready");
