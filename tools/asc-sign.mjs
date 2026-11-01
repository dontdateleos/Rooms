// Signing for the TestFlight upload, made fresh on each run through the App Store Connect API
// and taken away again afterwards, so there are no certificates to export or keep in step.
//   node tools/asc-sign.mjs make     a distribution certificate (into a temporary keychain) and
//                                    an App Store profile for the app, both named for this run
//   node tools/asc-sign.mjs cleanup  revokes the certificate and deletes the profile
// Xcode's own automatic signing can't do this on a fresh account: it wants a registered iPhone
// before it will make anything, even for a build that's only going to the App Store.
// Needs ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 and BUNDLE_ID; writes what it made to GITHUB_ENV.
import { createPrivateKey, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync, appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8, BUNDLE_ID = "com.touringgroup.rooms", GITHUB_ENV, GITHUB_RUN_NUMBER = "local" } = process.env;
const b64u = b => Buffer.from(b).toString("base64url");
function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg:"ES256", kid:ASC_KEY_ID.trim(), typ:"JWT" }));
  const body = b64u(JSON.stringify({ iss:ASC_ISSUER_ID.trim(), iat:now, exp:now + 1100, aud:"appstoreconnect-v1" }));
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key:createPrivateKey(ASC_KEY_P8.trim()), dsaEncoding:"ieee-p1363" });
  return `${head}.${body}.${b64u(sig)}`; }
async function api(method, path, body) {
  const r = await fetch(`https://api.appstoreconnect.apple.com${path}`, { method,
    headers:{ Authorization:`Bearer ${token()}`, "Content-Type":"application/json" }, body:body ? JSON.stringify(body) : undefined });
  const text = await r.text(); const j = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${(j.errors || []).map(e => e.detail || e.title).join("; ") || text.slice(0, 300)}`);
  return j; }
const env = (k, v) => { if (GITHUB_ENV) appendFileSync(GITHUB_ENV, `${k}=${v}\n`); console.log(`${k}=${v}`); };
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio:["ignore", "pipe", "inherit"], ...opts }).toString();

async function make() {
  const dir = join(tmpdir(), "rooms-sign"); mkdirSync(dir, { recursive:true });
  /* the app's id, with push switched on for it */
  const ids = await api("GET", `/v1/bundleIds?filter[identifier]=${encodeURIComponent(BUNDLE_ID)}&limit=5`);
  const bundle = (ids.data || []).find(b => b.attributes.identifier === BUNDLE_ID);
  if (!bundle) throw new Error(`No app id ${BUNDLE_ID} in Certificates, Identifiers & Profiles. Register it there first.`);
  const caps = await api("GET", `/v1/bundleIds/${bundle.id}/bundleIdCapabilities`);
  if (!(caps.data || []).some(c => c.attributes.capabilityType === "PUSH_NOTIFICATIONS")) {
    await api("POST", "/v1/bundleIdCapabilities", { data:{ type:"bundleIdCapabilities", attributes:{ capabilityType:"PUSH_NOTIFICATIONS" },
      relationships:{ bundleId:{ data:{ type:"bundleIds", id:bundle.id } } } } });
    console.log("switched on push for the app id"); }
  /* a distribution certificate from a key made here; LibreSSL (/usr/bin/openssl) writes a .p12
     the macOS keychain can read */
  sh("/usr/bin/openssl", ["req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "dist.key"), "-out", join(dir, "dist.csr"), "-subj", `/CN=Rooms TestFlight ${GITHUB_RUN_NUMBER}`]);
  const cert = await api("POST", "/v1/certificates", { data:{ type:"certificates", attributes:{ certificateType:"DISTRIBUTION", csrContent:readFileSync(join(dir, "dist.csr"), "utf8") } } });
  env("ASC_CERT_ID", cert.data.id);
  writeFileSync(join(dir, "dist.cer"), Buffer.from(cert.data.attributes.certificateContent, "base64"));
  sh("/usr/bin/openssl", ["x509", "-inform", "DER", "-in", join(dir, "dist.cer"), "-out", join(dir, "dist.pem")]);
  sh("/usr/bin/openssl", ["pkcs12", "-export", "-inkey", join(dir, "dist.key"), "-in", join(dir, "dist.pem"), "-out", join(dir, "dist.p12"), "-passout", "pass:rooms"]);
  const kc = join(dir, "rooms.keychain-db"), pw = "rooms-ci";
  sh("security", ["create-keychain", "-p", pw, kc]);
  sh("security", ["set-keychain-settings", "-lut", "3600", kc]);
  sh("security", ["unlock-keychain", "-p", pw, kc]);
  sh("security", ["import", join(dir, "dist.p12"), "-k", kc, "-P", "rooms", "-T", "/usr/bin/codesign", "-T", "/usr/bin/security"]);
  sh("security", ["set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", pw, kc]);
  const list = sh("security", ["list-keychains", "-d", "user"]).split("\n").map(s => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
  sh("security", ["list-keychains", "-d", "user", "-s", kc, ...list]);
  env("ROOMS_KEYCHAIN", kc);
  /* an App Store profile for the app, signed by that certificate */
  const name = `Rooms TestFlight ${GITHUB_RUN_NUMBER}`;
  const prof = await api("POST", "/v1/profiles", { data:{ type:"profiles", attributes:{ name, profileType:"IOS_APP_STORE" },
    relationships:{ bundleId:{ data:{ type:"bundleIds", id:bundle.id } }, certificates:{ data:[{ type:"certificates", id:cert.data.id }] } } } });
  const uuid = prof.data.attributes.uuid, content = Buffer.from(prof.data.attributes.profileContent, "base64");
  for (const d of [join(homedir(), "Library/MobileDevice/Provisioning Profiles"), join(homedir(), "Library/Developer/Xcode/UserData/Provisioning Profiles")]) {
    mkdirSync(d, { recursive:true }); writeFileSync(join(d, `${uuid}.mobileprovision`), content); }
  env("ASC_PROFILE_ID", prof.data.id); env("ASC_PROFILE_NAME", name); env("ASC_PROFILE_UUID", uuid); }

async function cleanup() {
  /* revoking a distribution certificate doesn't touch builds already uploaded or on the store */
  const { ASC_CERT_ID, ASC_PROFILE_ID, ROOMS_KEYCHAIN } = process.env;
  if (ASC_PROFILE_ID) await api("DELETE", `/v1/profiles/${ASC_PROFILE_ID}`).then(() => console.log("profile deleted"), e => console.log(String(e)));
  if (ASC_CERT_ID) await api("DELETE", `/v1/certificates/${ASC_CERT_ID}`).then(() => console.log("certificate revoked"), e => console.log(String(e)));
  if (ROOMS_KEYCHAIN) try { sh("security", ["delete-keychain", ROOMS_KEYCHAIN]); } catch {} }

const what = process.argv[2];
(what === "make" ? make() : what === "cleanup" ? cleanup() : Promise.reject(new Error("make or cleanup")))
  .catch(e => { console.log(`::error::${e.message}`); process.exit(1); });
