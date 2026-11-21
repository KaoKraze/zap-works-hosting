# Zap Works — developer notes

## Run locally
```
npm start            # same as: node server.js
```
Open http://localhost:3000 (set `PORT` to change it). Node 18+ is required (the server uses the built-in `fetch`).
Live numbers come from the Roblox API through `/api/stats`; the first load after a cold start can take a few seconds.

## Structure
- `index.html`, `games.html`, `about.html`, `careers.html`, `contact.html`, `404.html` — plain static pages (no build step).
- `css/styles.css` — the whole design system (tokens at the top: colours, type scale, spacing, motion).
- `js/main.js` — header, mobile menu, partner logo marquee (logo list + display mode lives here), contact form, page transitions.
- `js/live.js` — reads `/api/stats` and renders hero stats, the homepage showcase, the games list, communities and the chart.
- `js/motion.js` — GSAP + ScrollTrigger + SplitText animations and Lenis smooth scrolling. Everything still works if it fails to load,
  and it switches itself off for visitors who prefer reduced motion. Lenis only runs for mouse/trackpad users.
- `js/vendor/` — GSAP 3.15.1 and Lenis 1.3.27 (see `LICENSES.md`).
- `fonts/` — self-hosted Archivo, Inter and JetBrains Mono (SIL OFL).
- `images/logos/` — optimised WebP partner logos (made from `images/partners/`, which is kept as the source).
- `data.js` / `js/data.js` — tracked games, groups and Discord invites (server and browser fallback). Edit both when adding a game.
  Any group that owns a tracked game is counted automatically (Groups page + member total); `groups` in `data.js` only needs groups that own none of the listed games.

## Editing notes
- Header and footer are repeated in each page. Change them in every HTML file.
- Bump `?v=20261114` on the CSS/JS links when you change those files, so browsers fetch the new version.
- `server.js` sends a Content-Security-Policy. It allows the small inline `<script>` in each page's `<head>` by its SHA-256 hash.
  If you edit that inline script, update the hash in `SECURITY_HEADERS` (otherwise animations simply stay off).
- New image hosts (anything other than `*.rbxcdn.com`) must be added to `img-src` in the same policy.

## Keeping the live-player history (Railway)
The server stores its caches and the chart history in a data folder. Railway's normal disk is wiped on every
restart/redeploy, so attach a **Volume** to the web service (any mount path, e.g. `/data`). Railway sets
`RAILWAY_VOLUME_MOUNT_PATH` automatically and the server uses it — no code or variable changes needed.
The deploy log shows `Data folder: /data (Railway volume)` when it's working. Locally it uses `./data`
(ignored by Git). `DATA_DIR` can override the folder if ever needed.

## Contact form → Discord
Both forms (Contact and Partner) post to `/api/contact`, which sends an embed to a Discord channel.
Set `DISCORD_WEBHOOK_URL` in Railway → service → Variables (never put it in the code or on GitHub).
Without it, the forms fall back to opening the visitor's email app. The deploy log shows
`Contact form → Discord: on` when it's set. Built-in protections: hidden spam-trap field, 5 messages
per 10 minutes per visitor (40 total), @everyone/@here pings disabled, message size limits.
