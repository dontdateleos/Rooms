// Signing for the TestFlight upload, made fresh on each run through the App Store Connect API,
// so there are no certificates to export or keep in step.
//   node tools/asc-sign.mjs make     a distribution certificate (into a temporary keychain) and
//                                    an App Store profile for the app, both named for this run
//   node tools/asc-sign.mjs cleanup  removes the temporary keychain
// The certificate is NOT revoked after the upload: App Review checks a build's signature again
// when it's submitted, and a build signed by a revoked certificate fails with ITMS-90035
// "Invalid Signature". Apple allows only a few distribution certificates, so "make" first revokes
// old ones, keeping only the one that signed a build that's in or waiting for review.
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
  await makeRoom();
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

/* room for this run's certificate: keep the newest one, and the one that signed a build that's on
   a version in or waiting for review (the certificate made last before that build was uploaded;
   a certificate's life is a year, so it was made a year before it expires); revoke the rest */
const madeAt = c => new Date(c.attributes.expirationDate).getTime() - 365 * 864e5;
async function makeRoom() {
  /* Apple allows two distribution certificates, so only one is kept for this run to sit beside:
     the one that signed a build in (or waiting for) review, else the one on a version being
     prepared, else the newest. A TestFlight-only build doesn't need its certificate afterwards. */
  const certs = ((await api("GET", "/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=50")).data || []).sort((a, b) => madeAt(b) - madeAt(a));
  let keep = null;
  try {
    const app = (await api("GET", `/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`)).data?.[0];
    const versions = app ? (await api("GET", `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=10`)).data || [] : [];
    const rank = v => /WAITING_FOR_REVIEW|IN_REVIEW|PENDING_DEVELOPER_RELEASE|PENDING_APPLE_RELEASE|PROCESSING_FOR_APP_STORE/.test(v.attributes.appStoreState || "") ? 0
      : /PREPARE_FOR_SUBMISSION|READY_FOR_REVIEW|DEVELOPER_REJECTED|REJECTED/.test(v.attributes.appStoreState || "") ? 1 : 9;
    for (const v of versions.filter(v => rank(v) < 9).sort((a, b) => rank(a) - rank(b))) {
      const b = (await api("GET", `/v1/appStoreVersions/${v.id}/build`).catch(() => ({}))).data;
      if (!b) continue;
      const up = new Date(b.attributes.uploadedDate).getTime(), signer = certs.find(c => madeAt(c) <= up + 60e3);
      if (signer) { keep = signer; console.log(`keeping the certificate that signed build ${b.attributes.version} (on version ${v.attributes.versionString}, ${v.attributes.appStoreState})`); break; } }
  } catch (e) { console.log(`couldn't check versions (${e.message.slice(0, 120)}); keeping the newest certificate`); }
  keep ||= certs[0];
  for (const c of certs.filter(c => c.id !== keep?.id))
    await api("DELETE", `/v1/certificates/${c.id}`).then(() => console.log(`revoked an old certificate (${c.attributes.displayName || c.id}, expiring ${c.attributes.expirationDate.slice(0, 10)})`), e => console.log(String(e)));
  /* profiles of earlier runs whose certificate has gone are no use to anyone */
  const profs = (await api("GET", "/v1/profiles?filter[profileType]=IOS_APP_STORE&limit=100")).data || [];
  for (const p of profs.filter(p => /^Rooms TestFlight /.test(p.attributes.name) && p.attributes.profileState !== "ACTIVE"))
    await api("DELETE", `/v1/profiles/${p.id}`).then(() => console.log(`deleted the old profile "${p.attributes.name}"`), () => {}); }

async function cleanup() {
  /* the certificate and profile stay: see the top of this file */
  const { ROOMS_KEYCHAIN } = process.env;
  if (ROOMS_KEYCHAIN) try { sh("security", ["delete-keychain", ROOMS_KEYCHAIN]); } catch {} }

const what = process.argv[2];
(what === "make" ? make() : what === "cleanup" ? cleanup() : Promise.reject(new Error("make or cleanup")))
  .catch(e => { console.log(`::error::${e.message}`); process.exit(1); });
