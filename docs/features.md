# Feature reference

Every screen, option, price and mechanic in Pour Over Focus. For a guided tour, start with the
[README](../README.md); for the code behind it, see [architecture](architecture.md).

**Contents**

- [Screens](#screens)
- [The order ritual](#the-order-ritual)
- [The brew step](#the-brew-step)
- [The focus timer](#the-focus-timer)
- [Cash, streaks and sessions](#cash-streaks-and-sessions)
- [The shop](#the-shop)
- [Achievements](#achievements)
- [Leaderboard](#leaderboard)
- [Settings and backup](#settings-and-backup)
- [Glass Timer](#glass-timer)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Install and offline behaviour](#install-and-offline-behaviour)

---

## Screens

The app is one page with four stacked screens, only one active at a time:

| Screen | Purpose |
| :-- | :-- |
| **Order** (`scr-order`) | Four-step drink builder with a progress stepper |
| **Brew** (`scr-brew`) | The grind/pour ritual and a progress bar |
| **Timer** (`scr-timer`) | The live countdown, current phase and session controls |
| **Complete** (`scr-complete`) | Session recap: rounds, minutes, cash earned, a quote |

Header controls, always available: 🔥 streak · 🪙 balance · 🏅 leaderboard · 🏆 achievements ·
🎵 ambience · 🔊 sound · 🔔 notifications · ⬇ install (when installable) · 🛍️ shop.

---

## The order ritual

Four steps, each pre-selected so the flow can be completed without making decisions.

| Step | Options |
| :-- | :-- |
| **1 · Drink** | Coffee ☕ · Matcha 🍵 · Espresso Shot ⚡ |
| **2 · Milk** | Whole 🥛 · Coconut 🥥 · Almond 🌰 · Oat 🌾 · No Milk 🚫 |
| **3 · Creamer** | Vanilla 🍦 · Hazelnut 🌰 · Caramel 🍮 · Mocha 🍫 · No Creamer 🚫 |
| **4 · Toppings** | Cinnamon 🟤 · Rose Petals 🌹 · Sugar 🍬 · Cookie Sprinkles 🍪 · Gingerbread Crumbles 🧑‍🍳 · Cocoa Dust 🍫 |

- **Toppings are multi-select** — toggle any subset, including none. The other three steps are
  single-select.
- Default order is Coffee + Oat Milk + Vanilla + no toppings.
- **`3 × 5 × 5 × 64` = 4,800 possible drinks.**
- The stepper at the top doubles as navigation: completed steps are ticked and clickable.
- A summary line re-reads your order in plain language before you brew.
- Your order drives the brew visual: liquid colour, creamer swirl and a garnish for the chosen
  toppings.

---

## The brew step

- A **20 second** ritual by default (`Settings → Brew time`, 5–120s).
- The cup fills while the guest check total counts up; **☕ Brew** skips straight to the timer.
- Sound is synthesized with the Web Audio API (oscillators + filtered noise) — the project
  contains **no audio files**.
- The brew is part of the session: an achievement (🎬 Brewed With Intention) rewards sitting
  through it rather than skipping.

---

## The focus timer

### Phases

1. Focus round (default 25 min)
2. Short break (default 5 min), between rounds
3. Long break (default 15 min), after the final round

The session ends after the configured number of rounds (default 4), then opens the recap.

### Behaviour

| Aspect | Detail |
| :-- | :-- |
| Clock source | An absolute end timestamp; the display is derived from it, so background throttling, sleep or tab switches cannot accumulate drift |
| Tick | A 1-second interval that re-reads the timestamp; the timer also re-syncs on `visibilitychange` |
| Pause / resume | Freezes the remaining time and rebases the end timestamp on resume |
| Skip | Jumps to the next phase without paying for the skipped one |
| End | Ends the session early; unfinished rounds earn nothing |
| Reload recovery | `pourFocus.session.v1` keeps a snapshot (phase, round, end time, order, running state); a reload resumes mid-round instead of restarting |
| Rewards | Awarded exactly once per round, guarded by a `done` flag |

### Extras

- **Picture-in-Picture (⧉)** — Chromium's Document PiP puts the countdown in a floating,
  always-on-top window. The feature is detected at runtime; unsupported browsers simply see no
  effect.
- **Notifications (🔔)** — permission is requested on tap. Notifications fire only while the
  tab is hidden, so an on-screen user never gets a duplicate alert.
- **Café ambience (🎵)** — filtered brown noise with a slow LFO "breathing" pattern, faded in
  and out over ~1.6s. No files, no streaming.
- **Sounds (🔊)** — pour, clap and ding cues synthesized on demand.

---

## Cash, streaks and sessions

| Event | Effect |
| :-- | :-- |
| Focus round completed | **+$5**, lifetime earnings +5, total rounds +1 |
| Rounds / cash skipped or ended early | Nothing |
| Full session completed | Session counter +1; recap sums `5 × rounds` earned |
| First completed round of the day | Daily streak increments; a new day without a round resets it |

The streak is a *daily* counter (keyed by `YYYY-MM-DD`): complete at least one round today and
the streak continues tomorrow; skip a day and it starts again at 1.

The recap screen shows rounds, minutes and cash, plus a random quote from a small built-in
list — and unlocks any achievements you just earned.

---

## The shop

Nineteen cosmetics in four categories. The free default in each category is owned from the
start; everything else is bought with earned cash and persists across reloads.

### Skins (5)

| Item | Rarity | Price | Effect |
| :-- | :-- | --: | :-- |
| Cozy Brown Café | default | free | Creams, roasted browns and sage |
| Espresso Black Minimal | Rare | 15 | Stripped-back, sharp, no sugar |
| Pastel Matcha Mode | Common | 20 | Soft sage greens and cream light |
| Dark Roast Mode | Rare | 20 | Midnight browns with glowing amber |
| Sunset Café Glow | Epic | 25 | Golden-hour peach, coral and warm haze |

### Fonts (4)

| Item | Rarity | Price |
| :-- | :-- | --: |
| Modern Minimalist Sans | default | free |
| Cute Handwritten | Common | 12 |
| Elegant Serif | Common | 12 |
| Pixel Retro | Rare | 15 |

### Backgrounds (5)

| Item | Rarity | Price | Scene |
| :-- | :-- | --: | :-- |
| Animated Coffee Steam | default | free | Lazy steam wisps |
| Bookshelf Café | Common | 25 | Stuffed shelves |
| City Café Patio | Rare | 35 | Sunlit sidewalk with drifting motes |
| Rainy Café Window | Epic | 40 | Rain streaking a foggy pane |
| Fireplace Café | Legendary | 45 | Flickering hearth glow |

### Celebration animations (5)

| Item | Rarity | Price | Effect |
| :-- | :-- | --: | :-- |
| Basic Steam Celebration | Common | 10 | Rising steam, soft glow, a few sparkles |
| Confetti Sprinkle | Common | 25 | Coffee-coloured confetti + earnings pop |
| Golden Brew Glow | Rare | 50 | Golden glow, floating +$ particles |
| Fireworks Roast | Epic | 75 | Brown-and-gold bursts with a subtle shake |
| Legendary Café Festival | Legendary | 120 | Confetti, sparkles, fireworks, money rain, badge |

Purchases require enough balance (a toast explains the shortfall), preview on hover, and apply
immediately. Particle counts scale down below 480px wide so phones stay smooth.

---

## Achievements

| Badge | Condition |
| :-- | :-- |
| ☕ First Brew | 1 focus round completed |
| 🍵 Round Regular | 10 focus rounds |
| 🏆 Barista Legend | 50 focus rounds |
| 💰 $100 Earned | $100 lifetime earnings |
| 🛍️ Big Spender | 3 shop items owned |
| 🥐 Half Dozen | 5 full sessions completed |
| 🔥 On a Roll | 3-day streak |
| ⚡ Weekly Warrior | 7-day streak |
| 🎬 Brewed With Intention | Complete a session through the full brew ritual |
| 🎆 Premium Patron | Own the Legendary Café Festival |

Checks run after rounds, purchases and sessions; the 🏆 modal lists unlocked badges first and
locked ones dimmed.

---

## Leaderboard

Opened with 🏅. Ranks brewers by **focus minutes**, with a **Today / All time** switch and your
own row highlighted ("You").

| Endpoint | Method | Response |
| :-- | :-- | :-- |
| `api/health` | GET | Any JSON — used to probe availability |
| `api/leaderboard` | GET | `{ today: Row[], all: Row[] }` |
| `api/stream` | GET | Server-Sent Events named `leaderboard`, each `data:` a full snapshot |
| `api/report` | POST | `{ id, name, minutes, cash }` → snapshot JSON |

`Row` is `{ id, name, minutes, cash }`. The client sends focus minutes and cash after each
round, plus a name registration when you set a nickname.

**Live updates** come from the SSE stream; a **15-second poll** takes over if SSE is blocked, and
after repeated stream errors it stops reconnecting and shows "○ Polling only". With no backend
at all, the panel shows "○ Offline — start the server" and the rest of the app is unaffected.

The API root is resolved relative to the page (`api/` beside `index.html`), so it works under a
sub-path deployment — you just have to serve the backend from that same path.

---

## Settings and backup

| Setting | Range | Default |
| :-- | :-- | --: |
| Focus length | 1–120 min | 25 |
| Short break | 1–60 min | 5 |
| Long break | 5–90 min | 15 |
| Rounds per session | 1–12 | 4 |
| Brew time | 5–120 s | 20 |
| Focus category | Study, Work, Creative, Reading, Custom | Study |

Out-of-range or non-numeric input is clamped on read, so a bad value can never break the timer.

- **💾 Export save** — downloads the whole state as JSON.
- **📥 Import save** — restores from such a file (schema-safe: defaults are re-merged, so older
  or partial saves still load).

---

## Glass Timer

`pomodoro.html` — a separate, deliberately minimal page (about 2% JavaScript):

- 25 / 5 / 15 minute phases with a circular dial and progress ring.
- **Start / pause, reset, skip**, and four session dots.
- The **⬇ Download Web App** button serialises the live page to `my-app.html`, a single
  self-contained file that works offline from disk forever.
- No manifest and no service worker of its own — it is a page, not a second installable app —
  but it *is* in the app's offline precache, so `/pomodoro.html` works with the network off.

---

## Keyboard shortcuts

| Key | Where | Action |
| :-- | :-- | :-- |
| `Space` | Timer screen, no button focused | Pause / resume |
| `Esc` | Anywhere | Close shop / achievements / leaderboard, or skip a celebration |
| `Enter` | Leaderboard name field | Save your nickname |

---

## Install and offline behaviour

- **Installable** on Chrome, Edge, Android and iOS (manual on iOS). Requirements met: manifest
  with name, icons and `standalone` display; a service worker with a fetch handler; served over
  HTTPS (or localhost).
- **Maskable icons** are separate files with the artwork pulled inside the safe circle, so
  Android's circular/squircle masks crop background rather than the cup.
- **Offline** covers both pages, all icons, the 14 iOS launch images and the three drink photos —
  roughly 590 KB, precached on first visit.
- **Updates** are versioned (`VERSION` in `sw.js`): a bump replaces the cache, and the app checks
  for a new worker at most once an hour when you return to it.
- **Storage** is requested as persistent so the browser is less likely to evict progress.

Deep dive on caching, hosting and troubleshooting: [deployment.md](deployment.md#offline-and-caching).
