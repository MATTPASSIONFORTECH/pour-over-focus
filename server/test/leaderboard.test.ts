import { test } from "node:test";
import assert from "node:assert/strict";
import { LeaderboardStore, LIMITS, parseReport, sanitizeName, type Report } from "../src/leaderboard.ts";

function clock(iso: string) {
  let now = new Date(iso);
  return { now: () => now, set: (next: string) => (now = new Date(next)) };
}

const report = (r: Partial<Report> & { id: string }): Report => ({ name: "", minutes: 0, cash: 0, ...r });

test("ranks by minutes, then cash, then name for stable ties", () => {
  const store = new LeaderboardStore();
  store.apply(report({ id: "a", name: "Zoe", minutes: 25, cash: 5 }));
  store.apply(report({ id: "b", name: "Ada", minutes: 25, cash: 5 }));
  store.apply(report({ id: "c", name: "Cy", minutes: 25, cash: 0 }));
  store.apply(report({ id: "d", name: "Dee", minutes: 50, cash: 0 }));
  assert.deepEqual(store.snapshot().all.map((r) => r.id), ["d", "b", "a", "c"]);
});

test("all-time totals survive the daily rollover (regression)", () => {
  const time = clock("2026-11-09T23:30:00Z");
  const store = new LeaderboardStore({ now: time.now });
  store.apply(report({ id: "p1", name: "Matt", minutes: 25, cash: 5 }));
  time.set("2026-11-10T00:10:00Z");
  store.apply(report({ id: "p1", minutes: 50, cash: 5 }));

  const snap = store.snapshot();
  assert.deepEqual(snap.today, [{ id: "p1", name: "Matt", minutes: 50, cash: 5 }]);
  assert.deepEqual(snap.all, [{ id: "p1", name: "Matt", minutes: 75, cash: 10 }]);
});

test("today excludes players who have not reported since yesterday", () => {
  const time = clock("2026-11-09T12:00:00Z");
  const store = new LeaderboardStore({ now: time.now });
  store.apply(report({ id: "old", minutes: 25 }));
  time.set("2026-11-10T12:00:00Z");
  assert.deepEqual(store.snapshot().today, []);
  assert.equal(store.snapshot().all.length, 1);
});

test("a replayed reportId is acknowledged but not double counted", () => {
  const store = new LeaderboardStore();
  assert.deepEqual(store.apply(report({ id: "p1", minutes: 25, cash: 5, reportId: "r1" })), { status: "applied" });
  assert.deepEqual(store.apply(report({ id: "p1", minutes: 25, cash: 5, reportId: "r1" })), { status: "duplicate" });
  assert.deepEqual(store.apply(report({ id: "p1", minutes: 25, cash: 5, reportId: "r2" })), { status: "applied" });
  assert.equal(store.snapshot().all[0]?.minutes, 50);
});

test("reports without a reportId stay accepted for older clients", () => {
  const store = new LeaderboardStore();
  store.apply(report({ id: "p1", minutes: 25 }));
  store.apply(report({ id: "p1", minutes: 25 }));
  assert.equal(store.snapshot().all[0]?.minutes, 50);
});

test("idempotency memory is bounded per player", () => {
  const store = new LeaderboardStore();
  for (let i = 0; i <= LIMITS.rememberedReports; i++) store.apply(report({ id: "p1", minutes: 1, reportId: `r${i}` }));
  const saved = store.toJSON().players[0];
  assert.equal(saved?.recentReports.length, LIMITS.rememberedReports);
  assert.equal(saved?.recentReports[0], "r1");
});

test("rejects reports that would exceed a day of focus", () => {
  const store = new LeaderboardStore();
  for (let i = 0; i < LIMITS.minutesPerDay / 120; i++) store.apply(report({ id: "p1", minutes: 120 }));
  const result = store.apply(report({ id: "p1", minutes: 1 }));
  assert.equal(result.status, "rejected");
  assert.equal(store.snapshot().today[0]?.minutes, LIMITS.minutesPerDay);
});

test("snapshots are capped so broadcast size stays bounded", () => {
  const store = new LeaderboardStore();
  for (let i = 0; i < LIMITS.rows + 10; i++) store.apply(report({ id: `p${i}`, minutes: i }));
  const snap = store.snapshot();
  assert.equal(snap.all.length, LIMITS.rows);
  assert.equal(snap.all[0]?.id, `p${LIMITS.rows + 9}`);
});

test("change listeners fire on applied reports only", () => {
  const store = new LeaderboardStore();
  let calls = 0;
  const off = store.onChange(() => calls++);
  store.apply(report({ id: "p1", minutes: 1, reportId: "x" }));
  store.apply(report({ id: "p1", minutes: 1, reportId: "x" }));
  off();
  store.apply(report({ id: "p1", minutes: 1 }));
  assert.equal(calls, 1);
});

test("parseReport validates shape and bounds", () => {
  const bad: [unknown, RegExp][] = [
    [null, /JSON object/],
    [[], /JSON object/],
    [{ minutes: 1 }, /id/],
    [{ id: "has space" }, /id/],
    [{ id: "x".repeat(65) }, /id/],
    [{ id: "p", reportId: "../etc" }, /reportId/],
    [{ id: "p", minutes: -1 }, /minutes/],
    [{ id: "p", minutes: 121 }, /minutes/],
    [{ id: "p", minutes: "lots" }, /minutes/],
    [{ id: "p", cash: 6 }, /cash/],
    [{ id: "p", cash: Infinity }, /cash/],
  ];
  for (const [input, error] of bad) {
    const result = parseReport(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    if (!result.ok) assert.match(result.error, error);
  }
  assert.deepEqual(parseReport({ id: "p_1", name: " Ada ", minutes: 25.9, cash: "5", reportId: "r_1" }), {
    ok: true,
    report: { id: "p_1", name: "Ada", minutes: 25, cash: 5, reportId: "r_1" },
  });
});

test("sanitizeName strips control and bidi characters and enforces length", () => {
  assert.equal(sanitizeName("Ma\u0000tt\u202e  C\n"), "Matt C");
  assert.equal(sanitizeName("x".repeat(40)).length, LIMITS.nameLength);
  assert.equal(sanitizeName(42), "");
});

test("toJSON/fromJSON round-trips totals and idempotency keys", () => {
  const time = clock("2026-11-10T09:00:00Z");
  const store = new LeaderboardStore({ now: time.now });
  store.apply(report({ id: "p1", name: "Matt", minutes: 25, cash: 5, reportId: "r1" }));
  const restored = LeaderboardStore.fromJSON(JSON.parse(JSON.stringify(store.toJSON())), { now: time.now });
  assert.deepEqual(restored.snapshot(), store.snapshot());
  assert.equal(restored.apply(report({ id: "p1", minutes: 25, reportId: "r1" })).status, "duplicate");
});

test("fromJSON drops malformed records instead of crashing", () => {
  const restored = LeaderboardStore.fromJSON({
    players: [null, { id: "bad id" }, { id: "ok", name: 5, totalMinutes: -3, totalCash: "x", recentReports: ["r1", 7] }],
  });
  assert.deepEqual(restored.snapshot().all, [{ id: "ok", name: "", minutes: 0, cash: 0 }]);
  assert.equal(LeaderboardStore.fromJSON("garbage").size, 0);
});
