# Architecture

How the app is put together, and how to add to it without breaking anything.
Feature-level detail lives in [features.md](features.md); hosting in [deployment.md](deployment.md).

- [Design constraints](#design-constraints)
- [File map](#file-map)
- [Inside index.html](#inside-indexhtml)
- [State and persistence](#state-and-persistence)
- [The timer engine](#the-timer-engine)
- [The service worker](#the-service-worker)
- [Extending](#extending)
- [Verification recipes](#verification-recipes)

---

## Design constraints

1. **No build step.** The repo is the artifact. Clone it, serve it, done.
2. **No dependencies.** No framework, no bundler, no CDN fonts, no icon packs, no audio files.
   Icons are emoji, sounds are synthesized, scenes are CSS.
3. **Offline is a feature, not a fallback.** Everything the app needs is precached; the network
   is only used for the optional leaderboard.
4. **One file per concern.** `index.html` holds the app (markup + CSS + JS); `sw.js` holds the
   caching policy; `manifest.webmanifest` holds identity. Anything else is an asset.

---

## File map

```
index.html               ~3,000 lines: <style> (sections 1–N), markup, <script> (sections A–K2)
pomodoro.html            the standalone Glass Timer, fully self-contained
sw.js                    precache list, VERSION, fetch routing, update lifecycle
manifest.webmanifest     PWA identity: name, start_url/scope "./", icons, theme
404.html                 branded not-found page (relative link home, so sub-paths work)
assets/icons/            192/512 icons, maskable variants, apple-touch-icon (180)
assets/splash/           14 iOS launch images, one per device size/orientation
assets/img/              three drink photos used on the brew cards
docs/                    this documentation
.github/workflows/       Pages deployment
```

---

## Inside index.html

The CSS is numbered by concern (theme variables → layout → scenes → header → screens → order
interface → timer → shop → achievements → celebrations → responsive). The JavaScript is lettered:

| Section | Responsibility |
| :-- | :-- |
| **A. Storage & state** | `LS_KEY`s, `loadState`/`saveState`, schema merge + clamping, legacy migration |
| **B. Catalog** | `SHOP` (skins, fonts, bgs, anims), `ORDER_OPTIONS`, `ACHIEVEMENTS`, `QUOTES` |
| **C. Theme application** | `applyTheme` — writes `data-skin` / `data-font` / `data-bg` on `<body>` |
| **D. Header** | Balance, streak, the little "bump" animation |
| **E. Order interface** | Step state, selection, summary line, step navigation |
| **F. Sound** | Web Audio: ambience (brown noise + LFO), SFX (oscillator cues) |
| **PWA** | Service-worker registration, install prompt (incl. the iOS path), notifications |
| **G / G2** | Timer engine, brew countdown, cinematic brew sequence |
| **H. Reward / FX** | `+$5`, balance bump, floating particles |
| **I. Shop modal** | Tabs, previews, purchase validation, equip |
| **J. Achievements & toasts** | Unlock checks, toast stack |
| **K1. Leaderboard** | API resolution, SSE stream, polling fallback, rendering |
| **K2. Celebrations** | Particle spawners for the purchasable end-of-round effects |
| **K. Boot** | Wiring, event listeners, keyboard shortcuts, splash teardown, `init()` |

Theming is entirely attribute-driven: every visual variant is a CSS selector on
`body[data-skin=…]`, so a new skin needs one data entry and one CSS block — never a JS branch.

---

## State and persistence

One state object, one key:

```js
{
  balance, totalEarned, totalRounds, sessionsCompleted, brews,
  owned: [],                         // purchased item ids (free defaults are implicit)
  selected: { skin, font, bg },      // equipped cosmetics
  settings: { focus, short, long, rounds, category, brewTime },
  achievements: [],                  // unlocked ids
  streak: { count, last: "YYYY-MM-DD" },
  ambOn, soundOn, notifOn,
  player: { id, name },              // leaderboard identity (id is random, not personal)
  equippedAnim: ""                   // completion animation ("" = free default)
}
```

| Key | Contents |
| :-- | :-- |
| `pourFocus.save.v1` | the object above |
| `pourFocus.session.v1` | live timer snapshot: phase, round, `endTime`, order, running flag |
| `cozycup.save.v1` / `cozycup.session.v1` | pre-rename keys, migrated and deleted on first load |

`loadState()` is deliberately defensive: it deep-merges saved data over the defaults, clamps
numeric settings to their valid ranges, and repairs malformed fields. That is why old, partial
or hand-edited saves still load instead of bricking the app. `lsGet`/`lsSet` are wrapped in
`try/catch` so private mode or a full quota degrades to "works, doesn't persist".

Everything is local. There is no account, no sync, no server-side state.

---

## The timer engine

The clock never counts down. It stores **when the phase ends**:

```js
session.endTime = Date.now() + remainingMs;   // set on start/resume
session.remaining = Math.max(0, session.endTime - Date.now());
```

A 1-second `setInterval` re-derives the display from `endTime`, and `visibilitychange` forces a
re-sync when you come back. Consequences:

- Background-tab throttling, laptop sleep and clock-adjacent pauses cannot accumulate drift.
- Pausing stores `remaining`; resuming rebases `endTime` — no cumulative error across pauses.
- `session.done` guards the reward path so a phase pays out exactly once even if `tick` fires
  again before the transition.

The snapshot in `SESSION_KEY` is written alongside, so a reload restores the round in progress
rather than restarting the session.

---

## The service worker

`sw.js` is intentionally readable, ~150 lines:

1. **`PRECACHE`** — both pages, manifest, five icons, fourteen splash images, three photos.
2. **`install`** — `precacheAll()` adds each URL *independently* through `Promise.allSettled`, so
   a single failing asset is logged and skipped instead of aborting the whole install.
3. **`activate`** — deletes caches whose name isn't `VERSION`, refills the shell if cache storage
   was evicted while the worker stayed installed, then `clients.claim()`.
4. **`fetch`** — navigations are network-first and cached **per request URL** (so page A can
   never overwrite page B's offline copy); everything else is cache-first; only `2xx` responses
   are stored; `sw.js` and cross-origin requests are left alone.

`skipWaiting()` plus `clients.claim()` means a new version takes effect on the next navigation
rather than waiting for every tab to close.

When you change anything the worker serves, **bump `VERSION`** — that name is the entire cache
invalidation strategy.

---

## Extending

### Add a shop item

1. Add an entry to the right list in `SHOP` ([index.html](../index.html) section B):

   ```js
   { id: "moonlight", name: "Moonlight Café", desc: "Cool blues and a silver glow.", price: 30, rarity: "Epic" }
   ```

2. Add the styles the theme needs, keyed off the new attribute value:

   ```css
   body[data-skin="moonlight"] { --bg: #101827; --ink: #e8eefc; /* … */ }
   ```

3. Nothing else. The shop, purchase flow, persistence and previews are data-driven.

Backgrounds additionally need a `body[data-bg="…"] .scene-…` rule (and a scene element if it
isn't pure CSS); celebrations need a branch in the celebration renderer.

### Add an achievement

```js
{ id: "night-owl", name: "Night Owl", icon: "🌙", desc: "Finish a round after midnight",
  check: () => S.lastRoundHour >= 0 && S.lastRoundHour < 5 }
```

Append it to `ACHIEVEMENTS`. `check` runs after relevant events; unlocked ids persist in
`S.achievements`, so the condition is only evaluated until it first passes. Anything you need
to test must live in `S` (or be derivable from it).

### Add an order option

Append to `ORDER_OPTIONS.drink | milk | creamer | toppings` with a unique `id`, a `label` and an
`icon`. Toppings are multi-select automatically; the others are single-select. If the option
should change the cup visual, add a matching CSS variable/class.

### Add a keyboard shortcut

The `keydown` handler lives in section K. Guard on screen and focus state — the space bar only
toggles the timer when no button is focused, so keyboard users don't lose their place.

### Change the offline payload

If you add or move files, update **both** the `PRECACHE` list and `VERSION` in `sw.js`.
`docs/deployment.md#offline-and-caching` explains the routing rules; the [post-deploy
checklist](deployment.md#post-deploy-checklist) is the quickest way to confirm you didn't
break offline.

---

## Verification recipes

There is no test runner: the checks that matter are observable in a browser.

**Everything referenced exists**

```bash
python3 - <<'PY'
import re, json, os
refs = set(re.findall(r'(?:href|src)="(\.{0,2}/?[^"#]+\.(?:png|jpg|jpeg|webmanifest|html|js))"', open("index.html").read()))
refs |= {i["src"] for i in json.load(open("manifest.webmanifest"))["icons"]}
refs |= set(re.findall(r'"(\./[^"]+)"', open("sw.js").read()))
bad = [r for r in refs if not os.path.isfile(os.path.normpath(r[2:] if r.startswith("./") else r))]
print("missing:", bad or "none")
PY
```

**Install + precache**

1. Serve over `http://localhost`.
2. Load the app, wait ~1s.
3. DevTools → Application → Cache Storage → `pour-over-focus-vN` should hold ~26 entries
   including `/index.html`, `/pomodoro.html`, the maskable icons and `assets/img/*.jpg`.

**Offline**

1. Stop the server (or toggle Network → Offline).
2. Reload `/` → the café renders.
3. Navigate to `/pomodoro.html` → the Glass Timer renders, not the café and not a browser error.

**Sub-path hosting** (what GitHub Pages project sites actually do)

```bash
mkdir -p /tmp/site/pour-over-focus
cp -R index.html pomodoro.html sw.js manifest.webmanifest 404.html assets /tmp/site/pour-over-focus/
(cd /tmp/site && python3 -m http.server 8100)
# open http://localhost:8100/pour-over-focus/
```

The worker should register with scope `…/pour-over-focus/`, fill its cache, and keep working
offline at that sub-path.

**No console errors** — the app logs nothing on a healthy boot; a `[sw] precache skipped:` warning
means an asset is missing from disk or the host returned an error for it.
