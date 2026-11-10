# Case study: hardening the Pour Over Focus leaderboard

Portfolio evidence for **Smartsheet, Software Engineer I (Remote Eligible)**.
Author: Matthew Calabrese · Repository: `pour-over-focus` · Live app:
<https://mattpassionfortech.github.io/pour-over-focus/>

![The leaderboard updating live over SSE against the new service](leaderboard-live.png)

<sub>Headless Chrome against `npm start`: the page reported its own round with an idempotency key,
then Ada's report, sent from outside the page, arrived over the open SSE stream. Synthetic data.</sub>

---

## The problem

Pour Over Focus is an offline-first PWA (vanilla JS, service worker, installable). Its one
networked feature, a real-time leaderboard, depended on a backend that existed only as a code
snippet in the docs. Before building on it, I probed that snippet like a reviewer would:

| Finding | Category | Evidence |
| :-- | :-- | :-- |
| All-time totals reset every midnight because they reused the daily counters | Data correctness | 25 min + 25 min next day → all-time 25 |
| A retried report was counted twice | Distributed systems (delivery semantics) | Same body ×2 → 50 min |
| `minutes: 1e9` accepted | Input validation | `200` |
| `GET /.git/config` served the repo's git config | Security (information disclosure) | `200` |
| `startsWith(__dirname)` containment let `/..%2fsibling/file` read a sibling directory | Security (path traversal) | `200`, file contents returned |
| SSE streams had no heartbeat | Reliability | Idle proxies can close the stream silently |

Every row was reproduced against the old code and re-run against the new service. The
before/after table is in [deployment.md](../deployment.md#what-it-replaced).

## What I built

A TypeScript service in [`server/`](../../server) with **no runtime dependencies**. It runs
directly on Node 24 with native type stripping, so the repo keeps its no-build-step design.

| Layer | File | Responsibility |
| :-- | :-- | :-- |
| Domain | `leaderboard.ts` | Validation, idempotent apply, daily/all-time counters, deterministic ranking. Pure, with an injectable clock. |
| Transport | `http.ts` | Four `api/` routes with precise status codes, SSE fan-out, static allowlist |
| Durability | `persist.ts` | Debounced, chained, atomic (temp + rename) JSON snapshots; corrupt files fail loudly |
| Process | `main.ts` | Config by env, graceful SIGTERM drain + final flush |

### Design decisions worth discussing in review

- **At-least-once + idempotency = exactly-once effect.** The client now sends a `reportId` per
  round and retries on network errors and `5xx` only. The server keeps a bounded window (256)
  of seen IDs per player, persisted with the data, so replays survive restarts and return
  `Idempotent-Replay: true` instead of double counting. Old clients without IDs still work.
- **Correctness over cleverness on time.** Daily counters roll over lazily on the next write.
  All-time totals never reset. "Today" is the server's UTC date, and the docs say so.
- **Bounded fan-out cost.** Snapshots are capped at 50 rows. Bursts are coalesced into one
  serialization per event-loop turn, and slow consumers (>1 MB buffered) are dropped so they
  can't hold memory. `EventSource` reconnects with the server's `retry` hint.
- **Least privilege for static files.** The server publishes exactly what `pages.yml`
  deploys (5 files + `assets/`), rejects dotfile segments, and checks containment with a path
  separator. This is defense in depth rather than a single prefix check.
- **Clean shutdown.** `server.close()` never resolves while SSE streams are open, so `close()`
  ends the streams first, which avoids the classic hung-deploy problem on rolling restarts.

## Verification

| Check | Result |
| :-- | :-- |
| `npm run typecheck` (TS 7, `strict`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`) | clean; it caught an unchecked index and untyped JSON during development |
| `npm test` (`node:test`) | 23 tests: 13 domain, 10 HTTP/SSE/static/persistence integration |
| Regression tests | One per finding above, including the encoded-slash traversal |
| End-to-end | Real `index.html` in headless Chrome → report with `reportId` → live SSE update → no page errors |
| CI | `.github/workflows/ci.yml` runs type-check + tests on every PR |

## How this maps to the role

| Smartsheet asks for | Evidence here |
| :-- | :-- |
| Front-end and back-end services (TypeScript) | Typed Node service plus the client retry/idempotency change in the PWA |
| Distributed systems problems | Delivery semantics, idempotency keys, SSE fan-out, backpressure, reconnect behavior |
| Cloud-ready operations | Env config, health endpoint with stream count, graceful drain, proxy-buffering header, atomic persistence |
| Code reviews and architecture discussions | Findings framed as a review; decisions and trade-offs written down above; PR-sized change with tests |
| Quality and security | Strict types, 23 automated tests, CI gate, traversal and disclosure fixes with regressions |
| AI-assisted engineering workflows | Built with an AI coding agent, with every claim backed by a reproducible probe or test rather than taken on trust |

## Known limits and next steps

- No authentication: player IDs are client-generated. Next step: signed anonymous tokens.
- Single-process, in-memory state. Horizontal scale would need a shared store (e.g. Redis
  sorted sets) and pub/sub for SSE fan-out across instances. The `onChange` seam in the domain
  layer is where that plugs in.
- Per-IP rate limiting is delegated to the reverse proxy.
