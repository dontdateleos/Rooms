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

**This is a rejection today, and it is the largest piece of work left.**

An entry that is not marked room-only is visible to anyone, and anyone can like it.
Handles, bios and handover notes are user-written and visible to strangers. That makes
Rooms a UGC app, and Apple requires all four of the following:

- [ ] **A way to filter objectionable material** before it is posted.
- [ ] **A way to report an entry or a person**, with the report acted on within 24 hours.
- [ ] **A way to block an abusive user** — their entries, likes and handovers gone from
      your view, and no way for them to reach you.
- [ ] **Published contact information** reachable from inside the app. The privacy page's
      contact line covers this once it is filled in.

None of the first three exist in the code today. Blocking is the one with real design
weight: it has to hold in the feed, in rooms, in handovers, in the bell and in the live
subscriptions, and it belongs in the database policies rather than in the UI, or a blocked
person's rows still arrive and are merely not drawn.

---

## 3. Other guidelines, and where Rooms stands

| Guideline | Where we are |
| --- | --- |
| **5.1.1(v)** In-app account deletion | **Done.** Settings → Close your account. Needs schema v19 run. |
| **5.1.1(ii)** Data minimisation | Fine. Nothing collected that the app does not use. |
| **1.2** User-generated content | **Not started.** See above. |
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
- [ ] Run schema **v17**, **v18** and **v19** in the SQL editor.
- [ ] Build the four UGC requirements above.
- [ ] 1024×1024 icon, no alpha channel, no rounded corners.
- [ ] Wrap it — Capacitor — and get it running on a real device.
- [ ] Watch the 34 animations on real hardware. A phone is not a headless Chromium.
- [ ] Apple Developer Program membership, $99/yr.
- [ ] Privacy policy URL in App Store Connect, pointing at the published `privacy.html`.
