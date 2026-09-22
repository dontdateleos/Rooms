# Getting Rooms into the App Store

Written from the code, not from memory. Every "Not Collected" below is something you can
check in `index.html` rather than something we decided to say.

Re-read this against the code before you submit — if a feature landed since, the answers
may have moved. `policy.test.mjs` catches the privacy page drifting; nothing catches this
file, so it is on you.

---

## 1. App Privacy — the nutrition label

App Store Connect → your app → App Privacy. Work down its list; everything not named
below is **Not Collected**.

### Contact Info → Email Address — **Collected**
- Linked to the user: **Yes**
- Used for tracking: **No**
- Purpose: **App Functionality** only

Held by Supabase Auth for sign-in and the six-digit code. Never in the app's own tables,
never shown to another user, never mailed anything else.

### User Content → Other User Content — **Collected**
- Linked to the user: **Yes**
- Used for tracking: **No**
- Purpose: **App Functionality** only

Entries and what you wrote in them, the parts you singled out, lists, your ten, handover
notes, your bio. All of it typed by the person.

### Identifiers → User ID — **Collected**
- Linked to the user: **Yes**
- Used for tracking: **No**
- Purpose: **App Functionality** only

The account's UUID. It is how a row knows whose it is.

### Everything else — **Not Collected**

Worth knowing *why*, because App Review may ask:

| Apple's category | Why not |
| --- | --- |
| Location | The app never calls `navigator.geolocation`. The two-letter country code for "where can I watch this" comes from the phone's language setting, stays on the device, and is sent only with a streaming-availability lookup. That is not location data under Apple's definition. |
| Purchases, Financial Info | Nothing is sold in the app today. **This changes the day you add a paid tier.** |
| Contacts | Never requested. |
| Health & Fitness, Sensitive Info | Not applicable. |
| Browsing History | None kept. |
| Search History | Searches are passed to the proxy and forgotten. The proxy caches by *title*, never by person, so there is nothing to attribute to anyone. |
| Usage Data | **There is no analytics in the app at all** — no tag manager, no session recorder, no advertising kit, no pixel, no beacon. `offsite.test.mjs` fails if one is added. |
| Diagnostics | No crash reporter. Worth revisiting if you add one in the wrapper — it would become Collected. |
| Identifiers → Device ID | None today. **Adding push notifications adds an APNs token here.** |
| Other Data | Nothing left over. |

### Data Used to Track You: **None**
No advertising identifier, no data broker, no cross-app or cross-site tracking, no
third-party SDK of any kind.

### Third-party SDKs
**None.** The type and the Supabase client are served from the app's own address. Nothing
is fetched from a CDN at runtime; `offsite.test.mjs` is the test that keeps it true.

---

## 2. Guideline 1.2 — User-Generated Content

Built in v21. All four are in place; the last one needs your contact address.

- [x] **A way to filter objectionable material** before it is posted. Three lists, checked
      at the point of writing, on entries, replies, handover notes, handles, bios, room
      names and club names. Slurs go from everything. Swearing goes from everything too,
      with one exception: "this film is fucking great" is a review, and refusing it would
      teach people the app is stupid and to write around it — so that one word stays in a
      review and goes from a name, along with all the rest. A name is stricter because
      everybody else has to read it and cannot look away from it.
      Since v25 the same three lists are in the database as `bad_word()` and `bad_name()`,
      enforced by `claim_handle()` and by check constraints on every name column, so the
      filter is not just a sign on a door that anyone with a console can walk past.
      Every pattern is anchored, and there is a short unanchored list for names only with
      the innocent hosts taken out — Scunthorpe, Hitchcock, assassin, shiitake, Moby Dick,
      Pissarro and Fukunaga are ordinary things to write about films, and a filter that
      trips on them is worse than no filter. `names.test.mjs` holds every one of them.
- [x] **A way to report an entry or a person.** A Report link on every entry that is not
      yours and on every profile that is not yours. Seven reasons and a free line. Rows
      land in `reports`, which nothing can read through the API — **you read them in the
      SQL editor.** The privacy page promises a person looks within a day; that promise
      is yours to keep.
- [x] **A way to block.** Symmetrical: neither of you sees the other, any following
      between you ends, and anything either handed the other goes. Enforced by
      `apart_from()` inside every read policy, so the rows never leave the database — not
      a curtain over something still being delivered. Undone in Settings → Blocked.
- [ ] **Published contact information** reachable from inside the app. The privacy page's
      contact line covers this the moment the two blanks are filled in.

**What you have to actually do:** check the `reports` table. A report mechanism with
nobody reading it is worse than none, and the page says within a day.

```sql
select r.created_at, r.reason, r.note,
       p.handle as about, q.handle as from
  from reports r
  left join profiles p on p.id = r.about_user
  left join profiles q on q.id = r.reporter
 order by r.created_at desc;
```

---

## 3. Other guidelines, and where Rooms stands

| Guideline | Where we are |
| --- | --- |
| **5.1.1(v)** In-app account deletion | **Done.** Settings → Close your account. Needs schema v19 run. |
| **5.1.1(ii)** Data minimisation | Fine. Nothing collected that the app does not use. |
| **1.2** User-generated content | **Done** in v21, bar the contact address. See above. |
| **4.2** Minimum functionality | A wrapped website is the risk. Push notifications, the native share sheet and haptics are the usual answer, and the 34 animations help. |
| **4.8** Sign in with Apple | **Probably not required.** 4.8 bites when an app offers a *third-party or social* login. Rooms has its own email and password account through Supabase, which is first-party, so the requirement should not attach. Worth a second opinion before you rely on it. |
| **3.1.1** In-app purchase | Applies the day you charge. Digital content sold to users must go through Apple's IAP, at Apple's cut. |
| **2.1** App completeness | Give App Review a working demo account in App Review Information. They will not make one. |

---

## 4. Before you can submit

- [ ] Fill the two blanks in `privacy.html` (company name, contact email) — `policy.test.mjs`
      is red until you do.
- [ ] Accept Supabase's data processing agreement. The privacy page says a signed one
      exists; make that true.
- [ ] Run schema **v17** to **v22** in the SQL editor.
- [ ] Set yourself a way of seeing new reports. Nothing notifies you today.
- [ ] Decide what goes in `settings` before the first build. Anything you might want to
      change in a hurry belongs there, because after the first release a one-word change
      costs a build, an upload and a day or two of review. Four keys exist: `nope` (extra
      slur patterns), `foul` (swearing, refused in a review as well as a name), `name_only`
      (refused in a name only) and `report_reasons` (the wording on the report form). None
      can weaken what shipped — extra patterns are added to the bundled lists, never
      substituted, and a bad row is ignored, not obeyed.
- [ ] 1024×1024 icon, no alpha channel, no rounded corners.
- [ ] Wrap it — Capacitor — and get it running on a real device.
- [ ] Watch the 34 animations on real hardware. A phone is not a headless Chromium.
- [ ] Apple Developer Program membership, $99/yr.
- [ ] Privacy policy URL in App Store Connect, pointing at the published `privacy.html`.
