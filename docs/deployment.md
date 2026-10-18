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
perl -pi -e 's/MATTPASSIONFORTECH/<your-username>/g' README.md docs/deployment.md
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

Everything else works without it. The contract is four endpoints, relative to the app:

| Endpoint | Method | Body / response |
| :-- | :-- | :-- |
| `api/health` | GET | `{ "ok": true }` |
| `api/leaderboard` | GET | `{ "today": Row[], "all": Row[] }` |
| `api/stream` | GET (SSE) | `event: leaderboard` + `data: <same snapshot>` |
| `api/report` | POST | accepts `{ id, name, minutes, cash }`, returns the snapshot |

`Row = { id, name, minutes, cash }`, ranked by descending `minutes`, `cash` as the tiebreak.

A dependency-free Node implementation, saved as `server.js` and run with `node server.js`
(serving the app and the API from the same origin so `api/` resolves beside `index.html`):

```js
const http = require("http");
const fs = require("fs");
const path = require("path");

const players = new Map();          // id -> { id, name, minutes, cash, day }
const streams = new Set();
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".webmanifest": "application/manifest+json",
                ".png": "image/png", ".jpg": "image/jpeg", ".css": "text/css" };

const today = () => new Date().toISOString().slice(0, 10);
const rank = rows => rows.sort((a, b) => b.minutes - a.minutes || b.cash - a.cash);
const bare = ({ id, name, minutes, cash }) => ({ id, name, minutes, cash });   // keep internal fields private
const snapshot = () => {
  const all = [...players.values()];
  return { today: rank(all.filter(p => p.day === today())).map(bare), all: rank(all.slice()).map(bare) };
};
const broadcast = () => {
  const payload = "event: leaderboard\ndata: " + JSON.stringify(snapshot()) + "\n\n";
  for (const res of streams) res.write(payload);
};

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const json = (code, body) => {
    res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === "/api/health") return json(200, { ok: true });
  if (url.pathname === "/api/leaderboard") return json(200, snapshot());

  if (url.pathname === "/api/stream") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write("event: leaderboard\ndata: " + JSON.stringify(snapshot()) + "\n\n");
    streams.add(res);
    req.on("close", () => streams.delete(res));
    return;
  }

  if (url.pathname === "/api/report" && req.method === "POST") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 4096) req.destroy(); });
    req.on("end", () => {
      try {
        const { id, name, minutes, cash } = JSON.parse(body || "{}");
        if (!id) return json(400, { error: "id required" });
        const prev = players.get(id) || { id, name: "", minutes: 0, cash: 0, day: today() };
        if (prev.day !== today()) { prev.day = today(); prev.minutes = 0; prev.cash = 0; }
        if (name) prev.name = String(name).slice(0, 24);
        prev.minutes += Math.max(0, Number(minutes) || 0);
        prev.cash += Math.max(0, Number(cash) || 0);
        players.set(id, prev);
        broadcast();
        json(200, snapshot());
      } catch (e) { json(400, { error: "bad json" }); }
    });
    return;
  }

  // static files
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  const file = path.join(__dirname, rel);
  if (!file.startsWith(__dirname)) { res.writeHead(403).end("forbidden"); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/html" }).end(fs.existsSync("404.html") ? fs.readFileSync("404.html") : "not found"); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(3000, () => console.log("café open on http://localhost:3000"));
```

Notes if you adapt it:

- `id` is a random, client-generated string (`p_…`); names are display-only, so there is no
  authentication. Treat it as a friendly local leaderboard, not a public competitive one.
- Daily totals reset when a player's first report of a new day arrives.
- Serve the backend from the **same origin and path** as the app so the relative `api/` URLs
  resolve. On GitHub Pages you'd need a separate host (a worker or small server) and a base
  change in `index.html` where `API` is built.
- If you deploy this anywhere public, add rate limiting and validate/sanitise names — the client
  escapes them, but the server should too.

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
