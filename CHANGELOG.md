# Changelog

Notable changes to Pour Over Focus. Dates are ISO (`YYYY-MM-DD`).

## 2026-11-10 — Leaderboard service

**Added**

- `server/`: a typed, tested leaderboard service with no runtime dependencies (Node 24+, run
  with `npm start`) that replaces the inline `server.js` snippet. Features: idempotent reports,
  input bounds and a daily cap, deterministic ranking, top-50 snapshots, coalesced SSE
  broadcasts with heartbeat and slow-client eviction, optional atomic JSON persistence
  (`DATA_FILE`), and graceful shutdown.
- 23 `node:test` unit and integration tests, plus `.github/workflows/ci.yml` (type-check + tests).
- `docs/portfolio/`: an engineering case study.

**Fixed** (in the previously documented backend)

- All-time totals reset daily because they shared the daily counters.
- Retried reports were double counted.
- Unbounded `minutes`/`cash` were accepted.
- The static handler served `.git/` and, via `..%2f`, files from sibling directories.

**Changed**

- Each round's report from `index.html` now carries a `reportId` and is retried up to three
  times on network or `5xx` errors. `sw.js` `VERSION` bumped to `pour-over-focus-v12`.

## 2026-10-18 — Repository restructure and GitHub Pages

**Added**

- `README.md` — interactive menu: jump links, a clickable feature table, collapsible cards per
  feature, deploy steps and a project map.
- `docs/features.md` — complete reference: every option, price, achievement, endpoint and shortcut.
- `docs/deployment.md` — local serving, GitHub Pages (Actions and branch flows), custom domains,
  caching rules, troubleshooting, and a dependency-free leaderboard backend.
- `docs/architecture.md` — code sections, state shape, timer design, service worker, and how to add
  content.
- `.github/workflows/pages.yml` — publishes the app shell to Pages on every push to `main`
  (only the app files are staged, so docs stay off the live site).
- `404.html` — branded not-found page with a relative link home.
- `LICENSE` (MIT), `.gitignore`, `.nojekyll`, this changelog.

**Changed**

- Assets reorganised out of the repo root into `assets/icons/`, `assets/splash/` and `assets/img/`.
  Every reference was updated in `index.html`, `manifest.webmanifest` and `sw.js`.
- `sw.js` `VERSION` bumped to `pour-over-focus-v9` so installed clients pick up the new paths.
- Leaderboard nickname save now treats a successful snapshot as success (`if (res)`), instead of
  checking `.ok` on a parsed JSON object — the welcome toast fired only by accident before.
- The leaderboard's "server offline" toast pointed at a non-existent `run.md`; it now points at
  `docs/deployment.md`.

## 2026-10-18 — PWA and offline correctness fixes

**Fixed**

- **Offline pages overwrote each other.** Every navigation was cached at `./index.html`, so opening
  `pomodoro.html` replaced the main app's offline copy. Navigations are now cached under their own
  URL and fall back to that page, then the shell.
- **One broken precache URL disabled offline entirely.** `cache.addAll()` is atomic; a single
  failing asset aborted `install` and left no service worker. Assets are now added independently
  with failures logged and skipped.
- **404s were pinned in the cache.** Only `2xx` responses are stored now.
- **`pomodoro.html` was never precached** and could not be opened offline.
- **Cache eviction was permanent.** If the browser cleared storage while the worker stayed
  installed, nothing refilled it; `activate` now restores the shell.
- **Maskable icon was cropped** on Android adaptive masks (artwork filled 93% of the canvas).
  Added dedicated `icon-maskable-192/512.png` with the artwork inside the safe circle and a
  seamless background gradient.
- **Install button did nothing** when no install prompt was available; it now explains the
  browser-menu route, and shows Share → Add to Home Screen instructions on iOS.

**Added**

- `appinstalled` handling, hourly update checks, and a persistent-storage request.
- `lang`, `dir`, and normalised `start_url`/`id` in the manifest.
