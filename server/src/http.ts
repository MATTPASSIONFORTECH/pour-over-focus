/* HTTP surface: the four api/ endpoints the client already calls, plus a
   static server limited to the same files the Pages workflow publishes. */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { LeaderboardStore, parseReport } from "./leaderboard.ts";

export interface AppOptions {
  store: LeaderboardStore;
  staticRoot?: string;
  heartbeatMs?: number;
  maxBodyBytes?: number;
  log?: (message: string) => void;
}

const PUBLIC_FILES = new Set(["index.html", "pomodoro.html", "sw.js", "manifest.webmanifest", "404.html"]);
const PUBLIC_DIRS = new Set(["assets"]);
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".wav": "audio/wav",
};
// A stream that has buffered this much is not keeping up; drop it and let EventSource reconnect.
const MAX_STREAM_BUFFER = 1 << 20;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (declared > limit) return reject(new HttpError(413, `body exceeds ${limit} bytes`));
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        req.removeAllListeners("data");
        req.resume();
        reject(new HttpError(413, `body exceeds ${limit} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/* Maps a URL path to a file under root, or null if it is not publishable. */
export function resolveStaticPath(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const rel = path.posix.normalize("/" + decoded).slice(1) || "index.html";
  const [top = ""] = rel.split("/");
  const isPublic = rel === top ? PUBLIC_FILES.has(top) : PUBLIC_DIRS.has(top);
  if (!isPublic || rel.split("/").some((seg) => seg.startsWith("."))) return null;

  const base = path.resolve(root);
  const file = path.resolve(base, rel);
  // Separator-aware containment: a plain startsWith(base) also matches sibling dirs like base + "-old".
  return file.startsWith(base + path.sep) ? file : null;
}

export interface App {
  server: Server;
  close: () => Promise<void>;
}

export function createApp(options: AppOptions): App {
  const { store, staticRoot, heartbeatMs = 25_000, maxBodyBytes = 4096, log = () => {} } = options;
  const streams = new Set<ServerResponse>();
  let broadcastQueued = false;

  const writeEvent = (res: ServerResponse, chunk: string) => {
    if (res.writableLength > MAX_STREAM_BUFFER) {
      streams.delete(res);
      res.destroy();
      return;
    }
    res.write(chunk);
  };

  // Coalesce bursts of reports into one serialized snapshot per event-loop turn.
  const scheduleBroadcast = () => {
    if (broadcastQueued) return;
    broadcastQueued = true;
    setImmediate(() => {
      broadcastQueued = false;
      if (streams.size === 0) return;
      const payload = `event: leaderboard\ndata: ${JSON.stringify(store.snapshot())}\n\n`;
      for (const res of streams) writeEvent(res, payload);
    });
  };
  const unsubscribe = store.onChange(scheduleBroadcast);

  // Comment frames keep idle proxies and load balancers from closing quiet streams.
  const heartbeat = setInterval(() => {
    for (const res of streams) writeEvent(res, ": ping\n\n");
  }, heartbeatMs);
  heartbeat.unref();

  async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    const route = pathname.slice("/api/".length);
    const allow = (methods: string[]) => {
      if (methods.includes(req.method ?? "")) return true;
      sendJson(res, 405, { error: "method not allowed" }, { Allow: methods.join(", ") });
      return false;
    };

    switch (route) {
      case "health":
        if (allow(["GET", "HEAD"])) sendJson(res, 200, { ok: true, players: store.size, streams: streams.size });
        return;
      case "leaderboard":
        if (allow(["GET", "HEAD"])) sendJson(res, 200, store.snapshot());
        return;
      case "stream":
        if (!allow(["GET"])) return;
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write(`retry: 5000\nevent: leaderboard\ndata: ${JSON.stringify(store.snapshot())}\n\n`);
        streams.add(res);
        req.on("close", () => streams.delete(res));
        return;
      case "report": {
        if (!allow(["POST"])) return;
        const raw = await readBody(req, maxBodyBytes);
        let body: unknown;
        try {
          body = JSON.parse(raw || "{}");
        } catch {
          throw new HttpError(400, "body must be valid JSON");
        }
        const parsed = parseReport(body);
        if (!parsed.ok) throw new HttpError(400, parsed.error);
        const result = store.apply(parsed.report);
        if (result.status === "rejected") throw new HttpError(422, result.reason);
        // Replays return the current snapshot so at-least-once clients see the same success shape.
        const headers: Record<string, string> = result.status === "duplicate" ? { "Idempotent-Replay": "true" } : {};
        sendJson(res, 200, store.snapshot(), headers);
        return;
      }
      default:
        throw new HttpError(404, "not found");
    }
  }

  async function handleStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    let file = staticRoot ? resolveStaticPath(staticRoot, pathname) : null;
    if (file && (await stat(file).catch(() => null))?.isDirectory()) file = null;
    const data = file ? await readFile(file).catch(() => null) : null;
    if (!file || !data) {
      const notFound = staticRoot ? await readFile(path.join(staticRoot, "404.html")).catch(() => null) : null;
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(req.method === "HEAD" ? undefined : (notFound ?? "not found"));
      return;
    }
    const headers: Record<string, string> = { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" };
    // The worker script must be revalidated or update checks never see a new VERSION.
    if (path.basename(file) === "sw.js") headers["Cache-Control"] = "no-cache";
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : data);
  }

  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    const handler = pathname.startsWith("/api/") ? handleApi : handleStatic;
    handler(req, res, pathname).catch((err: unknown) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) log(`unhandled error on ${req.method} ${pathname}: ${String(err)}`);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendJson(res, status, { error: status === 500 ? "internal error" : (err as Error).message });
    });
  });

  // server.close() alone never resolves while SSE streams are open, so end them first.
  const close = () =>
    new Promise<void>((resolve, reject) => {
      clearInterval(heartbeat);
      unsubscribe();
      for (const res of streams) res.end();
      streams.clear();
      server.close((err) => (err ? reject(err) : resolve()));
      server.closeIdleConnections();
    });

  return { server, close };
}
