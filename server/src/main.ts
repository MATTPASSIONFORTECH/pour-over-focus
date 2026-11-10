import path from "node:path";
import { createApp } from "./http.ts";
import { LeaderboardStore } from "./leaderboard.ts";
import { autoSave, loadStore } from "./persist.ts";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const dataFile = process.env.DATA_FILE;
const staticRoot = path.resolve(import.meta.dirname, "../..");
const log = (message: string) => console.log(`[leaderboard] ${message}`);

const store = dataFile ? await loadStore(dataFile) : new LeaderboardStore();
const saver = dataFile ? autoSave(dataFile, store, 1000, (err) => log(`save failed: ${String(err)}`)) : null;
const app = createApp({ store, staticRoot, log });

app.server.listen(port, host, () => {
  log(`café open on http://${host}:${port}/ (${dataFile ? `persisting to ${dataFile}` : "in-memory"})`);
});

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log(`${signal} received, draining`);
  saver?.stop();
  await Promise.all([app.close(), saver?.flush()]);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
