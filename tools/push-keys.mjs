/* Makes the key pair notifications are signed with and hands both halves to the worker.
   Run once, from this folder's parent, after `wrangler login`:

     node tools/push-keys.mjs

   Running it again makes a new pair, which quietly stops every phone that has already said
   yes from getting anything until it opens the app again — so only do that on purpose. */
import { webcrypto as c } from "node:crypto";
import { execSync } from "node:child_process";
const b64u = b => Buffer.from(b).toString("base64url");
const k = await c.subtle.generateKey({ name:"ECDSA", namedCurve:"P-256" }, true, ["sign"]);
const pub = b64u(await c.subtle.exportKey("raw", k.publicKey)), priv = (await c.subtle.exportKey("jwk", k.privateKey)).d;
for (const [name, value] of [["VAPID_PUBLIC", pub], ["VAPID_PRIVATE", priv]]) {
  try { execSync(`npx wrangler secret put ${name}`, { input:value, stdio:["pipe", "inherit", "inherit"] }); }
  catch { console.log(`\nCouldn't set ${name} automatically. Run \`wrangler secret put ${name}\` and paste:\n${value}\n`); } }
console.log("\nDone. Notifications are on once the worker's deployed (wrangler deploy).");
