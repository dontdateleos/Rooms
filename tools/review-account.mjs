// The account Apple's reviewers sign in with, made (or brought up to date) on the live database.
// Apple rejects an app it can't get into, and an empty app shows them nothing, so the reviewer
// gets a room with two test friends who have logged a few things in it, and follows them.
// Everything the friends log is room-only, so none of it reaches anyone else's Everyone feed.
//   SUPABASE_SERVICE_KEY and REVIEW_PASSWORD from the environment; run by .github/workflows/appstore.yml
const URL = process.env.SUPABASE_URL || "https://caaxycmobhssxclrakim.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_KEY, PASSWORD = process.env.REVIEW_PASSWORD;
if (!KEY || !PASSWORD) { console.error("Needs SUPABASE_SERVICE_KEY and REVIEW_PASSWORD"); process.exit(1); }
export const REVIEW_EMAIL = process.env.REVIEW_EMAIL || "joinroomsapp+review@gmail.com";
const H = { apikey:KEY, Authorization:`Bearer ${KEY}`, "Content-Type":"application/json" };
async function call(method, path, body, extra = {}) {
  const r = await fetch(URL + path, { method, headers:{ ...H, ...extra }, body:body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
  if (!r.ok) throw new Error(`${method} ${path.split("?")[0]} → ${r.status}: ${t.slice(0, 300)}`);
  return j; }
const rest = (m, p, b, prefer) => call(m, "/rest/v1/" + p, b, prefer ? { Prefer:prefer } : {});

/* a person: their sign-in, and a profile with a handle */
async function person(email, handle, password) {
  let id;
  try { id = (await call("POST", "/auth/v1/admin/users", { email, password, email_confirm:true })).id; }
  catch (e) { if (!/already|exists|registered/i.test(e.message)) throw e;
    for (let page = 1; page < 50 && !id; page++) {
      const r = await call("GET", `/auth/v1/admin/users?page=${page}&per_page=200`);
      const u = (r.users || []).find(x => x.email === email); if (u) id = u.id; if (!(r.users || []).length) break; }
    if (!id) throw new Error(`couldn't find ${email}`);
    await call("PUT", `/auth/v1/admin/users/${id}`, { password, email_confirm:true }); }
  await rest("POST", "profiles?on_conflict=id", [{ id, handle }], "resolution=merge-duplicates,return=minimal");
  return id; }

const WORKS = [
  ["film:949", "film", "Heat", "1995", "Michael Mann"], ["film:496243", "film", "Parasite", "2019", "Bong Joon Ho"],
  ["film:666277", "film", "Past Lives", "2023", "Celine Song"], ["film:965150", "film", "Aftersun", "2022", "Charlotte Wells"],
  ["film:693134", "film", "Dune: Part Two", "2024", "Denis Villeneuve"], ["tv:1438", "tv", "The Wire", "2002", "David Simon"],
  ["tv:95396", "tv", "Severance", "2022", "Dan Erickson"], ["tv:136315", "tv", "The Bear", "2022", "Christopher Storer"]];
const ago = h => new Date(Date.now() - h * 36e5).toISOString(), day = h => ago(h).slice(0, 10);
const FRIEND_LOGS = {
  demo_mia:[["film:965150", 10, "The last shot. That's the review.", 3], ["tv:95396", 9, "The finale made me stand up.", 20], ["film:949", 8, "Two men explaining themselves over coffee. Perfect.", 70]],
  demo_tom:[["film:693134", 8, "Loud in exactly the right way.", 6], ["tv:136315", 7, "Too much yelling this season. Still in.", 30], ["film:496243", 10, "", 96]] };

(async () => {
  const pw = h => PASSWORD + "-" + h;    // the friends never sign in; their passwords are just long
  const me = await person(REVIEW_EMAIL, "appreview", PASSWORD);
  const mia = await person("joinroomsapp+mia@gmail.com", "demo_mia", pw("mia"));
  const tom = await person("joinroomsapp+tom@gmail.com", "demo_tom", pw("tom"));
  /* the works they talk about, only where the catalogue doesn't already have them */
  await rest("POST", "works?on_conflict=id", WORKS.map(([id, kind, title, year, creator]) => ({ id, kind, title, year, creator })), "resolution=ignore-duplicates,return=minimal");
  /* one room, the three of them in it */
  let room = (await rest("GET", `rooms?select=id,code&created_by=eq.${me}&name=eq.${encodeURIComponent("Movie Night")}`))[0];
  if (!room) { const code = Array.from({ length:6 }, () => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)]).join("");
    room = (await rest("POST", "rooms", [{ name:"Movie Night", code, created_by:me }], "return=representation"))[0]; }
  await rest("POST", "room_members?on_conflict=room_id,user_id", [me, mia, tom].map(user_id => ({ room_id:room.id, user_id })), "resolution=ignore-duplicates,return=minimal");
  await rest("POST", "follows?on_conflict=follower,followee", [mia, tom].map(followee => ({ follower:me, followee })), "resolution=ignore-duplicates,return=minimal").catch(e => console.log("follows:", e.message));
  /* fresh logs each run, so the Feed's rings have something from the last two days */
  for (const [handle, id] of [["demo_mia", mia], ["demo_tom", tom]]) {
    await rest("DELETE", `entries?user_id=eq.${id}`);
    await rest("POST", "entries", FRIEND_LOGS[handle].map(([work_id, score, note, h]) => ({ user_id:id, work_id, score, note:note || null, rated_on:day(h), created_at:ago(h), room_only:true })), "return=minimal"); }
  console.log(`Review account ready: ${REVIEW_EMAIL}, in the room "Movie Night" (code ${room.code}) with demo_mia and demo_tom.`);
})().catch(e => { console.error(e.message); process.exit(1); });
