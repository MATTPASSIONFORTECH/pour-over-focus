# Deployment

Pour Over Focus is a static site: HTML, CSS, JS and images. There is **no build step** — what
is in the repo is what gets served.

- [Run it locally](#run-it-locally)
- [Deploy to GitHub Pages](#deploy-to-github-pages)
- [Alternative: deploy from a branch](#alternative-deploy-from-a-branch)
- [Custom domain and sub-paths](#custom-domain-and-sub-paths)
- [Offline and caching](#offline-and-caching)
- [Troubleshooting](#troubleshooting)
- [Optional: the leaderboard backend](#optional-the-leaderboard-backend)
- [Post-deploy checklist](#post-deploy-checklist)

---

## Run it locally

A service worker (and therefore install + offline) needs `http://`, not `file://`.

```bash
python3 -m http.server 8000     # → http://localhost:8000/
# or
npx serve .
```

`http://localhost` counts as a secure origin, so the full PWA install flow works locally too.

---

## Deploy to GitHub Pages

The repository includes `.github/workflows/pages.yml`, which publishes the app on every push to
`main`.

### 1. Create the repository and push

```bash
# from the project folder
gh repo create pour-over-focus --public --source=. --push
# — or —
git remote add origin https://github.com/<owner>/pour-over-focus.git
git push -u origin main
```

### 2. Turn on Pages with Actions as the source

Repository → **Settings** → **Pages** → **Build and deployment**:

- **Source:** `GitHub Actions`

That is the only setting. No branch selection, no build command, no `gh-pages` branch.

### 3. Wait for the first run

**Actions** → *Deploy to GitHub Pages* → the `deploy` job prints the site URL. It will be:

```
https://<owner>.github.io/<repo>/
```

### What the workflow does

| Step | Purpose |
| :-- | :-- |
| `actions/checkout@v7` | Fetch the repo |
| *Stage the app shell* | Copy `index.html`, `pomodoro.html`, `sw.js`, `manifest.webmanifest`, `404.html` and `assets/` into `_site/`, plus an empty `.nojekyll` |
| `actions/configure-pages@v6` | Resolve Pages metadata for the repo |
| `actions/upload-pages-artifact@v5` | Package `_site` as the Pages artifact |
| `actions/deploy-pages@v5` | Publish it to the Pages environment |

Only the shell is staged on purpose: `README.md`, `docs/`, `.github/` and `LICENSE` stay in the
repo but are never served from the site.

Two workflow niceties worth knowing: `concurrency: pages` with `cancel-in-progress` means a
quick second push does not fight the first deploy, and `workflow_dispatch` lets you re-deploy
from the Actions tab without an empty commit.

### Renaming, forking or moving domains

This repo's README already points at its own Pages URL. If you fork, rename the repository or
move to a custom domain, update the links in one pass:

```bash
perl -pi -e 's/mattpassionfortech/<your-username>/g' README.md docs/deployment.md
git commit -am "docs: point links at the new URL" && git push
```

---

## Alternative: deploy from a branch

If you would rather not use Actions:

1. **Settings → Pages → Source: Deploy from a branch**
2. Branch `main`, folder `/ (root)`
3. Save.

The committed `.nojekyll` stops Jekyll from processing the files, which keeps every asset path
exactly as authored. Everything at the repo root becomes public, including `README.md` and
`docs/` (markdown renders as text there — harmless, just noise).

---

## Custom domain and sub-paths

All app URLs are **relative** (`./assets/...`, `start_url: "./"`, `scope: "./"`), so the app works
identically at:

- `https://<owner>.github.io/<repo>/` — a project sub-path
- `https://example.com/` — a custom apex domain
- `https://example.com/cafe/` — a sub-folder of a domain

The service worker scopes itself to the directory it is served from, so a project sub-path
doesn't leak into sibling projects on the same origin.

For a custom domain: **Settings → Pages → Custom domain**, then add the DNS record GitHub
shows (an `A`/`AAAA` set or a `CNAME`). Tick **Enforce HTTPS** once the certificate is issued.
A `CNAME` file in the published output is managed by GitHub when you use the Actions flow, so
there is nothing to commit.

---

## Offline and caching

`sw.js` is a small, explicit service worker. Its rules, and why:

| Situation | Strategy | Why |
| :-- | :-- | :-- |
| First install | Precache both pages, manifest, icons, splash art, drink photos — each asset added independently | One flaky URL must not abort the install and leave the app with no offline support |
| Page navigation | Network-first, cached **under the request's own URL**, fall back to that page, then `index.html` | Fresh HTML after a deploy; and visiting `pomodoro.html` can never overwrite the main app's offline copy |
| Other same-origin GETs | Cache-first, then network | Instant repeat loads; the version number is the refresh mechanism |
| Any response | Only `2xx` is stored | A transient 404/5xx cannot get pinned in the cache for the life of a version |
| Activate | Delete caches from other versions; refill the shell if it was evicted | Recovery after the browser clears storage while keeping the worker installed |
| `sw.js` itself | Not intercepted | The browser must be free to do its own update checks |

### Publishing an update

1. Change the app.
2. **Bump `VERSION` in `sw.js`** (e.g. `pour-over-focus-v9` → `v10`).
3. Commit and push.

On the next visit the new worker installs, activates immediately (`skipWaiting` + `clients.claim`)
and deletes the old cache. The page itself then picks up the new HTML on reload. The app also
asks the worker to check for updates at most once an hour when you return to the tab.

> Forgetting the version bump is the classic cause of "my change didn't ship": assets are
> cache-first, so the old copies keep being served until the cache name changes.

### Testing offline locally

1. Serve the folder over `http://localhost`.
2. Load the app once and wait a second for the precache to finish
   (`DevTools → Application → Cache Storage → pour-over-focus-vN` should list ~26 entries).
3. `DevTools → Network → Offline`, then reload. Both `/` and `/pomodoro.html` should render.
4. Or just stop the server and reload — the worker answers from cache.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| :-- | :-- | :-- |
| Edits don't appear after a push | `VERSION` not bumped | Bump it in `sw.js` |
| App won't install; no install button | Manifest not valid JSON, wrong MIME, or missing 192/512 icons | Confirm `manifest.webmanifest` returns `application/manifest+json` and both icon sizes resolve |
| Icon looks cropped on Android | `purpose: "any"` icon used as `maskable` | Keep the dedicated `icon-maskable-*.png` files (artwork inside the safe circle) |
| Offline shows the wrong page | An old worker with the pre-fix routing still active | Hard-reload / unregister the worker once; the current code caches per URL |
| 404 page appears for a real file | File not staged by the workflow | Add it to the `cp` list in `.github/workflows/pages.yml` |
| Leaderboard says "Offline" | No backend, or it isn't reachable at `api/` beside the page | Run the backend (below) or ignore it — nothing else depends on it |
| Install or offline fails only in Safari | Safari requires HTTPS (or localhost) and installs via Share → Add to Home Screen | Use HTTPS; there is no install prompt on iOS |

To reset locally: `DevTools → Application → Storage → Clear site data`, then reload.

---

## Optional: the leaderboard backend

Everything else works without it. The backend lives in [`server/`](../server): a TypeScript
service with **zero runtime dependencies** that runs directly on Node 24+ (native type
stripping, so there is no build step). It serves the API and the published app shell from one
origin, so the relative `api/` URLs resolve beside `index.html`.

```bash
npm start                                   # → http://127.0.0.1:3000/  (in-memory)
DATA_FILE=data/board.json npm start         # survive restarts (atomic JSON writes)
PORT=8080 HOST=0.0.0.0 npm start            # listen publicly
npm ci && npm run check                     # type-check + unit/integration tests
```

### Contract

| Endpoint | Method | Body / response |
| :-- | :-- | :-- |
| `api/health` | GET | `{ "ok": true, "players": n, "streams": n }` |
| `api/leaderboard` | GET | `{ "today": Row[], "all": Row[] }` (top 50 each) |
| `api/stream` | GET (SSE) | `event: leaderboard` + `data: <same snapshot>`; `: ping` heartbeat every 25s |
| `api/report` | POST | `{ id, name, minutes, cash, reportId? }` → snapshot |

`Row = { id, name, minutes, cash }`, ranked by descending `minutes`, then `cash`, then name, so
every client renders ties identically. `today` uses the server's UTC date.

| `api/report` outcome | Status |
| :-- | :-- |
| Applied | `200` + snapshot |
| Replay of a `reportId` already seen for this player | `200` + snapshot + `Idempotent-Replay: true` (not recounted) |
| Malformed JSON, bad `id`/`reportId`, `minutes` outside 0–120, `cash` outside 0–5 | `400` |
| Body over 4 KB | `413` |
| Would push a player past 1,440 focus minutes in one day | `422` |
| Wrong method on any `api/` route | `405` with `Allow` |

### Delivery semantics

The client generates one `reportId` per finished round and retries up to three times on
network errors or `5xx`. That makes delivery **at-least-once**; the server remembers the last
256 `reportId`s per player (persisted with the data file), so each round is counted
**exactly once**. Reports without a `reportId` are still accepted for older clients.

Broadcasts are coalesced: a burst of reports in one event-loop turn produces a single
serialized snapshot for all streams. A stream that buffers more than 1 MB is dropped, and
`EventSource` reconnects using the server's `retry: 5000` hint.

### What it replaced

Earlier versions of this page carried an inline `server.js`. Probing it side by side with the
new service found:

| Defect in the old snippet | Observed | Now |
| :-- | :-- | :-- |
| All-time totals reused the daily counters | 25 min yesterday + 25 today → all-time **25** | **50**, separate counters |
| Retried report counted twice | same report ×2 → **50** min | **25**, replay flagged |
| No input bounds | `minutes: 1e9` → **200** | **400** |
| Served the whole working tree | `GET /.git/config` → **200** | **404**, only the files Pages publishes |
| Prefix containment check (`startsWith(__dirname)`) | `GET /..%2fapp-secrets/env` read a **sibling directory** | **404**, separator-aware check |
| No SSE heartbeat | idle proxies may close the stream | `: ping` every 25s |

### Running it in public

- `id` is a random, client-generated string (`p_…`); there is no authentication, so treat it as
  a friendly leaderboard. Bounds and the daily cap limit damage, not identity spoofing.
- Put it behind a reverse proxy for TLS and per-IP rate limiting. Disable proxy buffering for
  `api/stream` (the service already sends `X-Accel-Buffering: no` for nginx).
- On GitHub Pages the API needs a separate host plus a change to where `API` is built in
  `index.html`, because Pages cannot run the service.

---

## Post-deploy checklist

- [ ] The site URL loads and the order screen renders.
- [ ] `/pomodoro.html` loads.
- [ ] The install button appears (desktop Chrome) and installs.
- [ ] DevTools → Application → Cache Storage shows the precache filled (~26 entries).
- [ ] Offline reload still renders the app, not the browser's dinosaur.
- [ ] `manifest.webmanifest` is served as `application/manifest+json`.
- [ ] Lighthouse → PWA installability has no blocking errors.
- [ ] README links point at your real URL (search for `github.io`).
