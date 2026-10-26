# Rooms

One log for film, TV, books and games — and the friends you argue with about them.

Rate it, single out what you loved, and see how much a room agrees. A single-file
progressive web app: no build step, no framework, no bundler.

## Run it

Open `index.html`. That's it. It runs in **local mode** — everything saves to the
device, nothing leaves it — until you add a backend.

Hosted on GitHub Pages: push this repo, then Settings → Pages → deploy from `main`, root.

## Sources

| Medium | Source | Needs |
|---|---|---|
| Film, TV | TMDB | nothing — the worker holds the key |
| Books | Open Library | nothing |
| Games | IGDB | the worker's IGDB secrets |

All four go through the deployed worker, named by `WORKER` in `index.html`. The key in
Settings is only a fallback for running without one; a TMDB key never goes in this repo.
TMDB's free tier is non-commercial; charging for Rooms would need their commercial licence.

The worker holds real credentials, so it refuses to run without knowing who may
call it. Set `ORIGIN` to the site that serves the app, comma-separating any
others (a custom domain, `http://localhost:8080` for development):

```
wrangler secret put ORIGIN     # https://you.github.io
```

Notifications on people's phones need a key pair the worker signs them with. Make it and
hand both halves to the worker in one go (after `wrangler login`), then deploy:

```
node tools/push-keys.mjs
wrangler secret put SUPABASE_SERVICE_KEY   # Supabase → Project Settings → API → service_role
wrangler deploy
```

The service key stays in Cloudflare: it's how the worker, and only the worker, looks up
where to send a notification, after checking with Supabase who is sending it.

Run that once — a new pair quietly stops every phone that already said yes until it
opens the app again. Without it the app simply doesn't offer notifications.

Unset, every request gets a 503. Set, anything that doesn't come from a listed
origin gets a 403 and never reaches TMDB or IGDB — so a stranger who finds the
worker URL can't spend your API quota. Debugging with curl means naming an
origin yourself: `curl -H "Origin: https://you.github.io" ...`.

## Setting it all up from GitHub (no computer needed)

`.github/workflows/backend.yml` runs `schema.sql` on Supabase and deploys the worker —
making the notification keys the first time — whenever either changes, or by hand from
the Actions tab. Add these once under Settings → Secrets and variables → Actions:

| Secret | Where it comes from |
|---|---|
| `SUPABASE_DB_URL` | Supabase → Connect → Session pooler connection string, password filled in |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → "Edit Cloudflare Workers" template |
| `SUPABASE_SERVICE_KEY` | Supabase → Project Settings → API → service_role |
| `CONTACT` | an email address for the app |

Then Actions → Deploy the backend → Run workflow. Anything not set is skipped with a note.

## The backend, when you want rooms

1. Make a Supabase project.
2. Run `schema.sql` in the SQL editor.
3. Put the project URL and anon key at the top of `index.html`:

```js
const SUPABASE_URL = "https://your-project.supabase.co";
const SUPABASE_ANON_KEY = "your-anon-key";
```

Both are public by design; row-level security in `schema.sql` is what protects the data.
The service-role key must never go near this repo.

## Files

| File | What it is |
|---|---|
| `index.html` | the whole app — markup, styles, logic, the card renderer, the avatar generator |
| `site.html` | the marketing page |
| `schema.sql` | Postgres tables, policies and RPCs, v1 through v34 — one file, run start to finish |
| `worker.js` | Cloudflare Worker: TMDB proxy, Open Library proxy, IGDB OAuth |
| `manifest.webmanifest`, `sw.js`, `icons/` | what makes it installable |

## Layout

Four tabs — **Rooms** · **Queue** · **Challenges** · **You** — with a floating **+** for logging.
Queue is **Up next** (the shelf) and **Finished** (the archive) as two sides of one tab, with a toggle at the top; it
opens on whichever side you left it. Drag sideways anywhere on a page and it comes with your finger, the next tab sliding in beside it; the blocks on each page trail behind like jelly and the bar's pill stretches like taffy. Let go past a third of the way, or flick, and it carries on and lands with a little bounce.
Hold **Queue** to spin the shelf; hold **Rooms** for the list of everywhere to go.
The Rooms tab opens with **Tonight**: what you're on, the next thing on your shelf, the
season if one is running, and the wheel. Tap any title for its work page — log it, shelve
it, hand it to someone or put it in one of your clubs from there; tap any handle for a profile.

Hold a tile on the shelf to arrange it: the grid starts jiggling, drag to reorder, **×** takes
something off, **Done** finishes. Arranging once makes the order yours — until then what's out
sorts ahead of what's still coming. A work's own page has the same switch as a button.

Logging something takes it off the shelf on its own — it moves down into **Off the shelf**
under the grid rather than sitting there with a tick. Correcting an entry you already made
isn't finishing anything, so that leaves the shelf where it is.

**Can't decide?** opens the two ways of being told what to do tonight: **Deal them** turns
the shelf over one card at a time, **Spin for it** puts the lot on a wheel, and each wedge
wears its own poster with the title over the top. Both read the same pool, so the medium
chips and the **In the mood for** chips — the genres and directors covering two or more of
what's left — narrow whichever one you're using.

## Conventions

- Work ids are namespaced: `film:496243`, `tv:1396`, `book:OL27448W`, `game:1942`.
- Scores are half-stars, 1–10, displayed out of five. A tap is a whole star; a hold is a half.
- Agreement is the mean absolute deviation from the median, as a percentage.
- A tag is promoted to the top of the log sheet once five people have logged the work,
  three of them picked it, and it's on a quarter of them. Five at most, built-in and
  custom ranked together. Below that nobody's share is shown, because it wouldn't mean
  anything.
- Every shareable thing has three **cuts** — see `CUTS` in `index.html`.
- Avatars idle by shape — a ball breathes, a cone teeters, a step shifts — and blink on a
  clock seeded from the handle, so two people never blink together. A face you haven't seen
  this session assembles once, then settles.
- Motion marks the moment it belongs to: a log floods the screen in the medium's colour,
  a tick draws itself, the nav pill travels, scores roll a digit at a time. All of it is
  off under `prefers-reduced-motion`.

## Using it

Copyright © 2026 dontdateleos. All rights reserved.

This code is published to be read, not taken. No licence is granted to copy, modify,
distribute or run it, in whole or in part. If you want to do something with it, ask.

Film and TV data is from TMDB, used under their non-commercial terms; this product uses
the TMDB API but is not endorsed or certified by TMDB. Books are from Open Library,
games from IGDB. None of those are covered by the above.


## Recent additions

There is no `migrations/` folder — `schema.sql` is the only file to run, cumulative and
idempotent, so re-running the whole thing against a database that already has some of
it applied is always safe.

**Up to three rooms.** People can create or join up to three rooms in total. Existing
memberships are retained; people already in three or more must leave one before adding
another. Joining a room they already belong to still works past the limit. Enforced by
a trigger on `room_members` (v26) that locks the member's profile row first, so
simultaneous create/join requests can't race past three.

**Edit and Delete on your own reviews**, wherever a review appears — the room feed, a
profile, the everyone feed — not only from the work page.

**Finding somebody ranks by closeness** rather than requiring an exact substring, and
does the ranking in the database (`find_people`, v27) rather than sending the whole
directory to whoever opens the search sheet.

**Provisioned, not yet wired up (v28):** durable invite status, a room member pinning an
entry, a room activity log — `room_invites`, `room_pins`, `room_activity`, and the
functions `toggle_room_pin`, `record_room_activity`, `room_remove_member`,
`room_transfer_owner`. (`room_notification_preferences` is now used — see v31.)

**Notifications that come to you (v31).** Your rooms hear when you finish something.
Once an hour the worker's cron (`[triggers]` in `wrangler.toml`) sends the rooms'
reminders in local time (`TZ`, default Australia/Sydney): Monday 9am this week's
question, Friday 6pm voting's open, 5pm on a watch night, and three nights before a
season ends. Each room's menu sets Everything / Just for me / Nothing. Needs the worker
redeployed after `schema.sql` (v31 adds `push_schedule`, `push_targets_room`,
`push_targets_season`, and a `p_kind` on `push_targets_for`).

**The diary.** Finished has a Diary view (every log by date, month by month, rewatches
marked) and Settings downloads it as a CSV Letterboxd can import.

**How far through.** "Where you're up to" understands `p. 120 of 412`, `40%` and
`S2 E5`: books get a page slider, ticking an episode moves you along, Tonight says the
next episode, and the room's "on now" strip has progress bars. No schema change.

**Your people on your Up next.** A poster someone in your rooms has finished carries
their face and score; the bell tells you when it happens.

**A goal for the year (v32).** `profiles.goals` (`{ "2026": 40 }` or
`{ "2026": { "total": 40, "film": 20, "book": 12 } }`) — a total, a number per medium,
or both. Set at the top of Challenges; the room's Year section shows everyone's, with pace.

**A season all year.** Catch-Up (Jan–Feb), Short Ones (Mar), Old Masters (Apr), Laugh
Lines (May), Whodunnit (Jun), Far, Far Away (Jul–Aug), Second Time Round (Sep), 31
Nights In (Oct), Long Nights (Nov–Dec), each with four ways in. Generated per year in
`seasonsOf()`; the worker's `SEASON_CAL` mirrors the dates for the ending reminder.

**Invite previews (v33).** `peek_room` returns the room's latest public covers and the
invite page uses one as its preview image.

**Picking tonight** is one card in Play: swipe → match → vote, with a link to skip
straight to a vote on your own picks.

**Things happen while you're looking (v34).**
- Likes and replies on your posts arrive live: a toast, the bell rings, and a slip on screen updates in place. v34 adds `reactions` and `replies` to the realtime publication.
- Opening the log sheet shows three dots on your face in the room ("mo is logging something…").
- A new slip flies in from the logger's face.
- Who's here stays live on every tab, and present people's faces glow wherever they appear.
- Reopening the app after a minute away catches up the bell, the "on now" strip and the feed.
- Today's logs say "just now" / "2h ago" and keep ticking.
- "On now" pills show how fresh they are, with a live dot under 45 minutes, and bars slide when they move.
- The weekly prompt shows who it's waiting on; tap a face to nudge them once.
- A vote or answer repaints everyone's Play, via a broadcast on the room channel.
- The demo acts this out once a visit.

**The little guys, kept in their places.** Faces react, dress up and feel things only where `index.html` says they may ("where the little guys are allowed"):
- **Expressions:** the rating buddy and your corner face react to scores.
- **Toasts and loading:** toasts carry a pleased or worried face, and search plus the room feed's first load show a thinking face.
- **Your week:** your corner face shows how your week's been going.
- **The room:** the room's square gets a face only when the last fortnight was loved (8+) or hated (≤4.5).
- **Anniversary:** confetti on the anniversary of joining.
- **Resting look:** stored as `avatar.mood`, so others see it; no schema change.
- **Tilt-to-look:** opt-in, off by default.

**Imports are history, not news.** Entries brought in from another app carry
`context.imported` (and `context.before` when undated, as the welcome picks do); they
count in your year and taste but never in a feed, a week, a race or a season.
