import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp, resolveStaticPath, type App } from "../src/http.ts";
import { LeaderboardStore, type Snapshot } from "../src/leaderboard.ts";
import { autoSave, loadStore, saveStore } from "../src/persist.ts";

const repoRoot = path.resolve(import.meta.dirname, "../..");
let app: App;
let store: LeaderboardStore;
let base: string;

before(async () => {
  store = new LeaderboardStore();
  app = createApp({ store, staticRoot: repoRoot, heartbeatMs: 30 });
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
after(() => app.close());

const post = (body: unknown) =>
  fetch(`${base}/api/report`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/* Minimal SSE reader: collects frames until `until` returns true. */
async function readStream(until: (frames: string[]) => boolean, onOpen?: () => unknown): Promise<string[]> {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/stream`, { signal: controller.signal });
  assert.equal(res.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const frames: string[] = [];
  let buffer = "";
  let opened = false;
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    while (!until(frames)) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      frames.push(...parts);
      if (!opened && frames.length) {
        opened = true;
        await onOpen?.();
      }
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
  return frames;
}

const snapshotsIn = (frames: string[]): Snapshot[] =>
  frames
    .filter((f) => f.includes("event: leaderboard"))
    .map((f) => JSON.parse(f.slice(f.indexOf("data: ") + 6)) as Snapshot);

test("health and leaderboard respond with the documented shapes", async () => {
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal(((await health.json()) as { ok: boolean }).ok, true);
  const board = await fetch(`${base}/api/leaderboard`);
  assert.equal(board.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys((await board.json()) as Snapshot), ["today", "all"]);
});

test("report returns the snapshot and replays are flagged, not recounted", async () => {
  const first = await post({ id: "p_http", name: "Matt", minutes: 25, cash: 5, reportId: "r_http" });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("idempotent-replay"), null);
  const snap = (await first.json()) as Snapshot;
  assert.equal(snap.all.find((r) => r.id === "p_http")?.minutes, 25);

  const replay = await post({ id: "p_http", minutes: 25, cash: 5, reportId: "r_http" });
  assert.equal(replay.headers.get("idempotent-replay"), "true");
  const after = (await replay.json()) as Snapshot;
  assert.equal(after.all.find((r) => r.id === "p_http")?.minutes, 25);
});

test("bad input maps to precise status codes", async () => {
  const badJson = await fetch(`${base}/api/report`, { method: "POST", body: "{nope" });
  assert.equal(badJson.status, 400);
  assert.equal((await post({ id: "p", minutes: 999 })).status, 400);
  assert.equal((await post({ id: "p", note: "x".repeat(5000) })).status, 413);
  const wrongMethod = await fetch(`${base}/api/report`);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "POST");
  assert.equal((await fetch(`${base}/api/nope`)).status, 404);

  for (let i = 0; i < 12; i++) await post({ id: "p_cap", minutes: 120 });
  assert.equal((await post({ id: "p_cap", minutes: 1 })).status, 422);
});

test("stream sends an initial snapshot, then live updates", async () => {
  const frames = await readStream(
    (f) => snapshotsIn(f).some((s) => s.all.some((r) => r.id === "p_live")),
    () => post({ id: "p_live", name: "Live", minutes: 5 }),
  );
  assert.match(frames[0] ?? "", /^retry: 5000\nevent: leaderboard\n/);
  assert.ok(snapshotsIn(frames).length >= 2);
});

test("a burst of changes is coalesced into one broadcast", async () => {
  const frames = await readStream(
    (f) => snapshotsIn(f).some((s) => s.all.some((r) => r.id === "burst")) && f.some((x) => x.startsWith(": ping")),
    () => {
      for (let i = 0; i < 10; i++) store.apply({ id: "burst", name: "", minutes: 1, cash: 0 });
    },
  );
  const updates = snapshotsIn(frames).slice(1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.all.find((r) => r.id === "burst")?.minutes, 10);
});

test("heartbeat comments keep idle streams alive", async () => {
  const frames = await readStream((f) => f.some((x) => x === ": ping"));
  assert.ok(frames.includes(": ping"));
});

test("static server serves the published app shell", async () => {
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.equal(index.headers.get("content-type"), "text/html; charset=utf-8");
  assert.match(await index.text(), /Pour Over Focus/);

  const sw = await fetch(`${base}/sw.js`);
  assert.equal(sw.headers.get("cache-control"), "no-cache");
  const manifest = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(manifest.headers.get("content-type"), "application/manifest+json");
  assert.equal((await fetch(`${base}/assets/icons/icon-192.png`)).status, 200);
});

test("static server refuses anything outside the published shell", async () => {
  for (const p of ["/.git/config", "/package.json", "/server/src/main.ts", "/docs/features.md", "/assets/", "/%2e%2e/etc/passwd", "/..%2f..%2fetc/passwd", "/%E0%A4%A"]) {
    const res = await fetch(`${base}${p}`);
    assert.equal(res.status, 404, p);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  }
});

test("resolveStaticPath is separator-aware and rejects traversal", () => {
  const root = "/srv/app";
  assert.equal(resolveStaticPath(root, "/"), path.resolve(root, "index.html"));
  assert.equal(resolveStaticPath(root, "/assets/img/coffee.jpg"), path.resolve(root, "assets/img/coffee.jpg"));
  for (const p of ["/../app-secrets/x", "/..%2fapp-secrets/x", "/assets/../../etc/passwd", "/assets/.hidden", "/a%00b", "/README.md"]) {
    assert.equal(resolveStaticPath(root, p), null, p);
  }
});

test("persistence round-trips through an atomic file write", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lb-"));
  try {
    const file = path.join(dir, "nested", "board.json");
    assert.equal((await loadStore(file)).size, 0);

    const source = new LeaderboardStore();
    const saver = autoSave(file, source, 5);
    source.apply({ id: "p1", name: "Saved", minutes: 25, cash: 5, reportId: "r1" });
    await saver.flush();
    saver.stop();

    const restored = await loadStore(file);
    assert.deepEqual(restored.snapshot(), source.snapshot());
    assert.equal(restored.apply({ id: "p1", name: "", minutes: 25, cash: 5, reportId: "r1" }).status, "duplicate");

    await saveStore(file, restored);
    assert.equal(JSON.parse(await readFile(file, "utf8")).version, 1);

    // Corrupt data must fail loudly instead of booting empty and overwriting the file.
    await writeFile(file, "{torn");
    await assert.rejects(loadStore(file), SyntaxError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
