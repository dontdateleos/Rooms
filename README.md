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
| Film, TV | TMDB | a free API key, pasted into the app under your name → Edit |
| Books | Open Library | nothing |
| Games | IGDB | `worker.js` deployed to Cloudflare Workers |

A TMDB key never goes in this repo — it lives in the browser's localStorage.
TMDB's free tier is non-commercial; charging for Rooms would need their commercial licence.

The worker holds real credentials, so it refuses to run without knowing who may
call it. Set `ORIGIN` to the site that serves the app, comma-separating any
others (a custom domain, `http://localhost:8080` for development):

```
wrangler secret put ORIGIN     # https://you.github.io
```

Unset, every request gets a 503. Set, anything that doesn't come from a listed
origin gets a 403 and never reaches TMDB or IGDB — so a stranger who finds the
worker URL can't spend your API quota. Debugging with curl means naming an
origin yourself: `curl -H "Origin: https://you.github.io" ...`.

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
| `schema.sql` | Postgres tables, policies and RPCs, v1 through v11 |
| `worker.js` | Cloudflare Worker: TMDB proxy, Open Library proxy, IGDB OAuth |
| `manifest.webmanifest`, `sw.js`, `icons/` | what makes it installable |

## Layout

Four tabs — **Doors** (your room · following · everyone) · **Shelf** · **Taste** · **Clubs** —
with a floating **+** for logging. Tap any title for its work page; tap any handle for a profile.

Hold a tile on the shelf to arrange it: the grid starts jiggling, drag to reorder, **×** takes
something off, **Done** finishes. Arranging once makes the order yours — until then what's out
sorts ahead of what's still coming. A work's own page has the same switch as a button.

## Conventions

- Work ids are namespaced: `film:496243`, `tv:1396`, `book:OL27448W`, `game:1942`.
- Scores are half-stars, 1–10, displayed out of five.
- Agreement is the mean absolute deviation from the median, as a percentage.
- Every shareable thing has three **cuts** — see `CUTS` in `index.html`.
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
