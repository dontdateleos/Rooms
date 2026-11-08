// The App Store listing, put into App Store Connect through its API, so nothing has to be typed
// into the website by hand. Every step reports what it did and carries on if one fails.
//   node tools/asc-listing.mjs status   what's there now
//   node tools/asc-listing.mjs apply    name, subtitle, description, keywords, links, category,
//                                       age rating, price, availability, screenshots, the newest
//                                       build and the review details (demo account included)
//   node tools/asc-listing.mjs submit   sends the version to App Review (only when asked to)
// The version is the app's own, MARKETING_VERSION in the Xcode project: made in App Store Connect
// if it isn't there yet, and only ever a build of that version is put on it.
//   node tools/asc-listing.mjs resubmit swaps in a newer build: out of review, apply, back in (only when asked to)
// Needs ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8; REVIEW_EMAIL/REVIEW_PASSWORD for the demo account.
// Not possible through the API, so done once in the website: App Privacy (the "nutrition
// label", answers in STORE.md) and the review contact's name and phone number.
import { createPrivateKey, sign, createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8, BUNDLE_ID = "com.touringgroup.rooms", REVIEW_EMAIL, REVIEW_PASSWORD } = process.env;
const b64u = b => Buffer.from(b).toString("base64url");
function token() { const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg:"ES256", kid:ASC_KEY_ID.trim(), typ:"JWT" }));
  const body = b64u(JSON.stringify({ iss:ASC_ISSUER_ID.trim(), iat:now, exp:now + 1100, aud:"appstoreconnect-v1" }));
  return `${head}.${body}.${b64u(sign("sha256", Buffer.from(`${head}.${body}`), { key:createPrivateKey(ASC_KEY_P8.trim()), dsaEncoding:"ieee-p1363" }))}`; }
async function api(method, path, body) {
  const r = await fetch(path.startsWith("http") ? path : `https://api.appstoreconnect.apple.com${path}`, { method,
    headers:{ Authorization:`Bearer ${token()}`, "Content-Type":"application/json" }, body:body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let j = {}; try { j = text ? JSON.parse(text) : {}; } catch {}
  if (!r.ok) { const e = new Error(`${method} ${path.split("?")[0]} → ${r.status}: ${(j.errors || []).map(e => [e.title, e.detail, e.source?.pointer, e.meta?.associatedErrors && JSON.stringify(e.meta.associatedErrors).slice(0, 1500)].filter(Boolean).join(" — ")).join("; ") || text.slice(0, 300)}`); e.status = r.status; throw e; }
  return j; }
let failed = 0;
async function step(name, fn) { try { const r = await fn(); console.log(`✓ ${name}${typeof r === "string" ? ` — ${r}` : ""}`); return true; }
  catch (e) { failed++; console.log(`✗ ${name}: ${e.message}`); return false; } }

/* ---------- what goes in, read from store/listing.md so there's one source ---------- */
const MD = readFileSync(join(ROOT, "store/listing.md"), "utf8");
const WANT = (readFileSync(join(ROOT, "ios/App/App.xcodeproj/project.pbxproj"), "utf8").match(/MARKETING_VERSION = ([\d.]+);/) || [])[1] || "1.0";
const section = h => { const i = MD.indexOf("## " + h); if (i < 0) return ""; const s = MD.indexOf("\n", i) + 1, e = MD.indexOf("\n## ", s); return MD.slice(s, e < 0 ? undefined : e).trim(); };
const firstLine = h => section(h).split("\n")[0].trim();
const L = {
  name:firstLine("Name"), subtitle:firstLine("Subtitle"),
  promo:section("Promotional text").split("\n").filter(l => l.trim()).slice(1).join(" ").trim(),
  keywords:(section("Keywords").match(/```\n?([\s\S]*?)```/) || [])[1]?.trim(),
  description:section("Description"),
  privacy:"https://dontdateleos.github.io/Rooms/privacy.html", support:"https://dontdateleos.github.io/Rooms/privacy.html",
  marketing:"https://dontdateleos.github.io/Rooms/site.html", copyright:"2026 Touring Group", contact:"joinroomsapp@gmail.com",
  /* the first version can't have notes; every one after must */
  whatsNew:section("What's new in this version").split("\n").filter(l => !l.startsWith("(")).join("\n").trim(),
  notes:(section("App Review Information").match(/(^> .*\n?)+/m) || [""])[0].replace(/^> ?/gm, "").trim(),
};
const SHOTS = readdirSync(join(ROOT, "store/screenshots")).filter(f => /^iphone-6\.9-\d+\.jpg$/.test(f)).sort((a, b) => parseInt(a.match(/(\d+)\.jpg/)[1]) - parseInt(b.match(/(\d+)\.jpg/)[1]));

async function find() {
  const app = (await api("GET", `/v1/apps?filter[bundleId]=${BUNDLE_ID}`)).data?.[0];
  if (!app) throw new Error(`No app with bundle id ${BUNDLE_ID} in App Store Connect`);
  const infos = (await api("GET", `/v1/apps/${app.id}/appInfos`)).data || [];
  /* the app's name, category and age rating live on its info, which Apple only lets you change
     while there's an editable copy; with a version out and nothing to change there may not be one */
  const LIVE = /READY_FOR_DISTRIBUTION|READY_FOR_SALE|REPLACED|ACCEPTED|PENDING_RELEASE/;
  const info = infos.find(i => !LIVE.test(i.attributes.state || "") && !LIVE.test(i.attributes.appStoreState || "")) || null;
  const versions = (await api("GET", `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=10`)).data || [];
  /* this version, never one that's already out */
  const version = versions.find(v => v.attributes.versionString === WANT) || null;
  return { app, info, version, versions }; }

async function status() {
  const { app, info, version, versions } = await find();
  console.log(`App: ${app.attributes.name} (${app.id}), primary language ${app.attributes.primaryLocale}`);
  for (const v of versions) console.log(`Version ${v.attributes.versionString}: ${v.attributes.appStoreState || v.attributes.appVersionState}`);
  if (info) for (const l of (await api("GET", `/v1/appInfos/${info.id}/appInfoLocalizations`)).data || []) console.log(`Listing (${l.attributes.locale}): name "${l.attributes.name}", subtitle "${l.attributes.subtitle || ""}"`);
  if (version) { const b = await api("GET", `/v1/appStoreVersions/${version.id}/build`).catch(() => ({}));
    console.log(`Build on the version: ${b.data ? b.data.attributes.version : "none"}`); }
  const builds = (await api("GET", `/v1/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=3`)).data || [];
  for (const b of builds) console.log(`Build ${b.attributes.version}: ${b.attributes.processingState}`); }

async function apply() {
  const { app } = await find(); let { version } = await find();
  console.log(`App ${app.attributes.name} (${app.id})`);
  const made = await step(`Version ${WANT} exists`, async () => { if (version) return `${version.attributes.versionString}, ${version.attributes.appStoreState}`;
    version = (await api("POST", "/v1/appStoreVersions", { data:{ type:"appStoreVersions", attributes:{ platform:"IOS", versionString:WANT }, relationships:{ app:{ data:{ type:"apps", id:app.id } } } } })).data; return "made it"; });
  if (!made) return;
  /* a new version opens a new, editable copy of the app's info: find it again */
  const { info } = await find();
  await step("Content rights: uses third-party content (posters and details from TMDB, IGDB, Open Library)", () =>
    api("PATCH", `/v1/apps/${app.id}`, { data:{ type:"apps", id:app.id, attributes:{ contentRightsDeclaration:"USES_THIRD_PARTY_CONTENT" } } }));
  if (!info) console.log("· Name, category and age rating: unchanged from the version that's out (Apple has them locked until something there changes)");
  if (info) await step("Category: Entertainment, then Social Networking", () =>
    api("PATCH", `/v1/appInfos/${info.id}`, { data:{ type:"appInfos", id:info.id, relationships:{
      primaryCategory:{ data:{ type:"appCategories", id:"ENTERTAINMENT" } }, secondaryCategory:{ data:{ type:"appCategories", id:"SOCIAL_NETWORKING" } } } } }));
  if (info) for (const l of (await api("GET", `/v1/appInfos/${info.id}/appInfoLocalizations`)).data || [])
    await step(`Name, subtitle and privacy link (${l.attributes.locale})`, () => api("PATCH", `/v1/appInfoLocalizations/${l.id}`, { data:{ type:"appInfoLocalizations", id:l.id,
      attributes:{ name:L.name, subtitle:L.subtitle, privacyPolicyUrl:L.privacy } } }).then(() => `"${L.name}"`));
  if (info) await step("Age rating questionnaire", async () => {
    const d = (await api("GET", `/v1/appInfos/${info.id}/ageRatingDeclaration`)).data; const have = d.attributes, set = {};
    /* the content questions: Rooms makes none of this itself */
    const NONE = ["alcoholTobaccoOrDrugUseOrReferences", "contests", "gamblingSimulated", "medicalOrTreatmentInformation", "profanityOrCrudeHumor", "sexualContentGraphicAndNudity",
      "sexualContentOrNudity", "horrorOrFearThemes", "matureOrSuggestiveThemes", "violenceCartoonOrFantasy", "violenceRealistic", "violenceRealisticProlongedGraphicOrSadistic", "gunsOrOtherWeapons"];
    /* the features: people post reviews and replies to each other and follow each other, with
       report, block and a word filter; there's no web browser, chat, ads, loot boxes or gambling */
    const YES = ["userGeneratedContent", "socialMedia"];
    const NO = ["gambling", "unrestrictedWebAccess", "lootBox", "advertising", "healthOrWellnessTopics", "parentalControls", "ageAssurance", "messagingAndChat", "seventeenPlus"];
    for (const k of NONE) if (k in have) set[k] = "NONE";
    for (const k of NO) if (k in have) set[k] = false;
    for (const k of YES) if (k in have) set[k] = true;
    /* Apple keeps adding questions; whatever it says is missing gets the answer above, or a no */
    for (let tries = 0; tries < 12; tries++) {
      try { await api("PATCH", `/v1/ageRatingDeclarations/${d.id}`, { data:{ type:"ageRatingDeclarations", id:d.id, attributes:set } }); return `${Object.keys(set).length} answers`; }
      catch (e) { const miss = [...e.message.matchAll(/attribute '(\w+)'/g)].map(m => m[1]).filter(k => !(k in set));
        const bad = [...e.message.matchAll(/\/data\/attributes\/(\w+)/g)].map(m => m[1]).filter(k => !miss.includes(k) && typeof set[k] === "boolean" && !YES.includes(k));
        if (!miss.length && !bad.length) throw e;
        for (const k of miss) set[k] = YES.includes(k) ? true : NONE.includes(k) ? "NONE" : false;
        for (const k of bad) set[k] = "NONE";
        console.log(`  …also answering: ${[...miss, ...bad].join(", ")}`); } }
    throw new Error("gave up after twelve tries"); });
  await step("Copyright and release when approved", () => api("PATCH", `/v1/appStoreVersions/${version.id}`, { data:{ type:"appStoreVersions", id:version.id,
    attributes:{ copyright:L.copyright, releaseType:"AFTER_APPROVAL" } } }));
  const locs = (await api("GET", `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`)).data || [];
  for (const l of locs) {
    await step(`Description, keywords, promotional text and links (${l.attributes.locale})`, () => api("PATCH", `/v1/appStoreVersionLocalizations/${l.id}`, { data:{ type:"appStoreVersionLocalizations", id:l.id,
      attributes:{ description:L.description, keywords:L.keywords, promotionalText:L.promo, supportUrl:L.support, marketingUrl:L.marketing,
        ...(WANT !== "1.0" ? { whatsNew:L.whatsNew } : {}) } } }).then(() => `${L.description.length} characters${WANT !== "1.0" ? `, what's new ${L.whatsNew.length}` : ""}`));
    await step(`Screenshots (${l.attributes.locale})`, () => screenshots(l.id)); }
  await step(`Newest ${WANT} build attached`, async () => {
    /* the newest build of this version; if Apple is still processing it, wait for it (up to half an hour) */
    let b;
    for (let i = 0; i < 60; i++) {
      b = ((await api("GET", `/v1/builds?filter[app]=${app.id}&filter[preReleaseVersion.version]=${WANT}&sort=-uploadedDate&limit=1`)).data || [])[0];
      if (!b) throw new Error(`no ${WANT} build uploaded yet`);
      if (b.attributes.processingState === "VALID") break;
      if (/FAILED|INVALID/.test(b.attributes.processingState)) throw new Error(`build ${b.attributes.version} is ${b.attributes.processingState}`);
      if (i === 59) throw new Error(`build ${b.attributes.version} still ${b.attributes.processingState} after 30 minutes`);
      console.log(`  build ${b.attributes.version} is ${b.attributes.processingState}, waiting…`); await new Promise(r => setTimeout(r, 30000)); }
    await api("PATCH", `/v1/appStoreVersions/${version.id}/relationships/build`, { data:{ type:"builds", id:b.id } }); return `build ${b.attributes.version}`; });
  await step("Free, in every country", () => price(app.id));
  await step("Available in every country", () => availability(app.id));
  await step("Review details and the demo account", async () => {
    const attributes = { contactEmail:L.contact, demoAccountRequired:true, demoAccountName:REVIEW_EMAIL, demoAccountPassword:REVIEW_PASSWORD, notes:L.notes };
    if (!REVIEW_EMAIL || !REVIEW_PASSWORD) { delete attributes.demoAccountName; delete attributes.demoAccountPassword; }
    const cur = await api("GET", `/v1/appStoreVersions/${version.id}/appStoreReviewDetail`).catch(e => { if (e.status === 404) return {}; throw e; });
    if (cur.data) await api("PATCH", `/v1/appStoreReviewDetails/${cur.data.id}`, { data:{ type:"appStoreReviewDetails", id:cur.data.id, attributes } });
    else { try { await api("POST", "/v1/appStoreReviewDetails", { data:{ type:"appStoreReviewDetails", attributes, relationships:{ appStoreVersion:{ data:{ type:"appStoreVersions", id:version.id } } } } }); }
      catch (e) { if (/contactFirstName|contactPhone/.test(e.message)) throw new Error("Apple needs your name and phone number first: App Store Connect → the app → version 1.0 → App Review Information → Contact Information. Save, then run this again."); throw e; } }
    return REVIEW_EMAIL ? `signs in as ${REVIEW_EMAIL}` : "no demo account given"; });
  console.log(failed ? `\n${failed} step(s) need a look (above).` : "\nAll done.");
  console.log("Still to do in the website: App Privacy (answers in STORE.md), and your name and phone number under App Review Information."); }

/* the 6.9-inch set: whatever's there is replaced, in order */
async function screenshots(locId) {
  const sets = (await api("GET", `/v1/appStoreVersionLocalizations/${locId}/appScreenshotSets`)).data || [];
  let set = sets.find(s => s.attributes.screenshotDisplayType === "APP_IPHONE_67");
  if (!set) set = (await api("POST", "/v1/appScreenshotSets", { data:{ type:"appScreenshotSets", attributes:{ screenshotDisplayType:"APP_IPHONE_67" },
    relationships:{ appStoreVersionLocalization:{ data:{ type:"appStoreVersionLocalizations", id:locId } } } } })).data;
  for (const old of (await api("GET", `/v1/appScreenshotSets/${set.id}/appScreenshots`)).data || []) await api("DELETE", `/v1/appScreenshots/${old.id}`);
  for (const f of SHOTS) { const buf = readFileSync(join(ROOT, "store/screenshots", f));
    const res = (await api("POST", "/v1/appScreenshots", { data:{ type:"appScreenshots", attributes:{ fileName:f, fileSize:buf.length },
      relationships:{ appScreenshotSet:{ data:{ type:"appScreenshotSets", id:set.id } } } } })).data;
    for (const op of res.attributes.uploadOperations) {
      const r = await fetch(op.url, { method:op.method, headers:Object.fromEntries((op.requestHeaders || []).map(h => [h.name, h.value])), body:buf.subarray(op.offset, op.offset + op.length) });
      if (!r.ok) throw new Error(`uploading ${f}: ${r.status}`); }
    await api("PATCH", `/v1/appScreenshots/${res.id}`, { data:{ type:"appScreenshots", id:res.id, attributes:{ uploaded:true, sourceFileChecksum:createHash("md5").update(buf).digest("hex") } } }); }
  return `${SHOTS.length} uploaded`; }

async function price(appId) {
  const have = await api("GET", `/v1/apps/${appId}/appPriceSchedule`).catch(e => { if (e.status === 404) return {}; throw e; });
  if (have.data) { const m = await api("GET", `/v1/appPriceSchedules/${have.data.id}/manualPrices?include=appPricePoint&limit=5`).catch(() => ({}));
    if ((m.data || []).length) return "already set"; }
  const points = (await api("GET", `/v1/apps/${appId}/appPricePoints?filter[territory]=USA&limit=200`)).data || [];
  const free = points.find(p => Number(p.attributes.customerPrice) === 0); if (!free) throw new Error("no free price point found");
  await api("POST", "/v1/appPriceSchedules", { data:{ type:"appPriceSchedules", relationships:{ app:{ data:{ type:"apps", id:appId } },
      baseTerritory:{ data:{ type:"territories", id:"USA" } }, manualPrices:{ data:[{ type:"appPrices", id:"${free}" }] } } },
    included:[{ type:"appPrices", id:"${free}", attributes:{ startDate:null }, relationships:{ appPricePoint:{ data:{ type:"appPricePoints", id:free.id } } } }] });
  return "free"; }

async function availability(appId) {
  const have = await api("GET", `/v1/apps/${appId}/appAvailabilityV2`).catch(e => { if (e.status === 404) return {}; throw e; });
  if (have.data) return "already set";
  let terr = [], next = "/v1/territories?limit=200";
  while (next) { const r = await api("GET", next); terr = terr.concat(r.data || []); next = r.links?.next || null; }
  const items = terr.map((t, i) => ({ type:"territoryAvailabilities", id:`\${t${i}}`, attributes:{ available:true },
    relationships:{ territory:{ data:{ type:"territories", id:t.id } } } }));
  await api("POST", "/v2/appAvailabilities", { data:{ type:"appAvailabilities", attributes:{ availableInNewTerritories:true },
      relationships:{ app:{ data:{ type:"apps", id:appId } }, territoryAvailabilities:{ data:items.map(i => ({ type:i.type, id:i.id })) } } }, included:items });
  return `${terr.length} countries`; }

async function submit() {
  const { app, version } = await find();
  if (!version) throw new Error(`there's no version ${WANT} in App Store Connect yet: run apply first`);
  if (/READY_FOR_SALE|READY_FOR_DISTRIBUTION|WAITING_FOR_REVIEW|IN_REVIEW/.test(version.attributes.appStoreState)) { console.log(`Version ${WANT} is already ${version.attributes.appStoreState}.`); return; }
  /* a version can be in only one open submission: if one already holds it (say after a build was
     refused), send that one again; otherwise reuse an empty unsent one, or make one */
  const subs = (await api("GET", `/v1/reviewSubmissions?filter[app]=${app.id}&filter[platform]=IOS&limit=20`)).data || [];
  const open = subs.filter(x => !/COMPLETE|CANCELING|CANCELED|WAITING_FOR_REVIEW|IN_REVIEW/.test(x.attributes.state));
  let sub = null; const empty = [];
  for (const x of open) {
    const its = (await api("GET", `/v1/reviewSubmissions/${x.id}/items?include=appStoreVersion`).catch(() => ({}))).data || [];
    console.log(`  submission ${x.id.slice(0, 8)}: ${x.attributes.state}, ${its.length} item(s)`);
    if (its.some(it => it.relationships?.appStoreVersion?.data?.id === version.id)) sub = sub || x; else if (!its.length) empty.push(x); }
  if (sub && sub.attributes.state === "UNRESOLVED_ISSUES") {
    /* the submission a refused build left behind won't take the new build; close it and start afresh */
    await api("PATCH", `/v1/reviewSubmissions/${sub.id}`, { data:{ type:"reviewSubmissions", id:sub.id, attributes:{ canceled:true } } });
    console.log(`  closed the old submission ${sub.id.slice(0, 8)}`);
    for (let i = 0; i < 40; i++) {
      const st = (await api("GET", `/v1/reviewSubmissions/${sub.id}`)).data.attributes.state;
      if (/CANCELED|COMPLETE/.test(st)) break; await new Promise(r => setTimeout(r, 15000)); }
    sub = null; }
  if (sub) { for (const x of empty) await api("PATCH", `/v1/reviewSubmissions/${x.id}`, { data:{ type:"reviewSubmissions", id:x.id, attributes:{ canceled:true } } }).catch(() => {}); }
  else sub = empty[0] || (await api("POST", "/v1/reviewSubmissions", { data:{ type:"reviewSubmissions", attributes:{ platform:"IOS" }, relationships:{ app:{ data:{ type:"apps", id:app.id } } } } })).data;
  const items = (await api("GET", `/v1/reviewSubmissions/${sub.id}/items`).catch(() => ({}))).data || [];
  /* freshly uploaded screenshots take a minute or two to process, and the version can't be sent until they have */
  const ITEM = { data:{ type:"reviewSubmissionItems", relationships:{ reviewSubmission:{ data:{ type:"reviewSubmissions", id:sub.id } },
    appStoreVersion:{ data:{ type:"appStoreVersions", id:version.id } } } } };
  if (!items.length) for (let i = 0; ; i++) {
    try { await api("POST", "/v1/reviewSubmissionItems", ITEM); break; }
    catch (e) { if (!/IN_POST_PROCESSING|not ready to be submitted/.test(e.message) || i >= 20) throw e; console.log("  Apple is still processing (screenshots or build), waiting…"); await new Promise(r => setTimeout(r, 30000)); } }
  for (let i = 0; ; i++) {
    try { await api("PATCH", `/v1/reviewSubmissions/${sub.id}`, { data:{ type:"reviewSubmissions", id:sub.id, attributes:{ submitted:true } } }); break; }
    catch (e) { if (!/IN_POST_PROCESSING|not ready to be submitted/.test(e.message) || i >= 20) throw e; console.log("  Apple is still processing (screenshots or build), waiting…"); await new Promise(r => setTimeout(r, 30000)); } }
  console.log(`Submitted version ${version.attributes.versionString} for review.`); }

/* swap a newer build into a version that's already waiting for review: wait for the build to finish
   processing, take the version out of review, fill everything in again (attaching that build), send it back */
const wait = ms => new Promise(r => setTimeout(r, ms));
async function resubmit() {
  const { app, version } = await find();
  const onIt = (await api("GET", `/v1/appStoreVersions/${version.id}/build`).catch(() => ({}))).data;
  const was = +(onIt?.attributes.version || 0);
  console.log(`Version ${version.attributes.versionString} is ${version.attributes.appStoreState}, with build ${was || "none"}`);
  let newest;
  for (let i = 0; i < 60; i++) {
    newest = ((await api("GET", `/v1/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=1`)).data || [])[0];
    const n = +(newest?.attributes.version || 0), st = newest?.attributes.processingState;
    if (n > was && st === "VALID") break;
    if (n > was && /FAILED|INVALID/.test(st)) throw new Error(`build ${n} is ${st}; the version is left in review as it was`);
    if (i === 59) throw new Error(`no newer processed build after 30 minutes (newest ${n}, ${st}); the version is left as it was`);
    console.log(`  waiting for a build newer than ${was} (newest ${n}: ${st || "not uploaded yet"})`); await wait(30000); }
  console.log(`Build ${newest.attributes.version} is ready`);
  if (/WAITING_FOR_REVIEW|IN_REVIEW/.test(version.attributes.appStoreState)) {
    const subs = (await api("GET", `/v1/reviewSubmissions?filter[app]=${app.id}&filter[platform]=IOS&limit=20`)).data || [];
    for (const s of subs.filter(s => /WAITING_FOR_REVIEW|IN_REVIEW|UNRESOLVED_ISSUES/.test(s.attributes.state))) {
      await api("PATCH", `/v1/reviewSubmissions/${s.id}`, { data:{ type:"reviewSubmissions", id:s.id, attributes:{ canceled:true } } });
      console.log(`Took submission ${s.id} out of review`); }
    for (let i = 0; ; i++) {
      const st = (await api("GET", `/v1/appStoreVersions/${version.id}`)).data.attributes.appStoreState;
      if (!/WAITING_FOR_REVIEW|IN_REVIEW/.test(st)) { console.log(`Version is now ${st}`); break; }
      if (i === 40) throw new Error("the version didn't come out of review after 20 minutes");
      await wait(30000); } }
  await apply();
  if (failed) throw new Error("something in the listing didn't save, so it wasn't sent to review");
  await submit(); console.log(`(with build ${newest.attributes.version})`); }

/* fill everything in, then send it, but only if everything saved */
async function applyAndSubmit() { await apply(); if (failed) throw new Error("something in the listing didn't save, so it wasn't sent to review"); await submit(); }
const mode = process.argv[2] || "status";
({ status, apply, submit, resubmit, "apply-submit":applyAndSubmit })[mode]?.().catch(e => { console.error(e.message); process.exit(1); }).then(() => { if (failed) process.exitCode = 1; });
