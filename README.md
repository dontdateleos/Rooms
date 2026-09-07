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
| `schema.sql` | Postgres tables, policies and RPCs, v1 through v9 |
| `worker.js` | Cloudflare Worker: TMDB proxy, Open Library proxy, IGDB OAuth |
| `manifest.webmanifest`, `sw.js`, `icons/` | what makes it installable |

## Layout

Four tabs — **Doors** (your room · following · everyone) · **Shelf** · **Taste** · **Clubs** —
with a floating **+** for logging. Tap any title for its work page; tap any handle for a profile.

## Conventions

- Work ids are namespaced: `film:496243`, `tv:1396`, `book:OL27448W`, `game:1942`.
- Scores are half-stars, 1–10, displayed out of five.
- Agreement is the mean absolute deviation from the median, as a percentage.
- Every shareable thing has three **cuts** — see `CUTS` in `index.html`.
