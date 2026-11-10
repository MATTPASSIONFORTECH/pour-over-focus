/* Leaderboard domain: validation, idempotent report application, ranking.
   Pure and clock-injectable so every rule is unit-testable without HTTP. */

export interface Row {
  id: string;
  name: string;
  minutes: number;
  cash: number;
}

export interface Snapshot {
  today: Row[];
  all: Row[];
}

export interface Report {
  id: string;
  name: string;
  minutes: number;
  cash: number;
  reportId?: string;
}

export type ApplyResult =
  | { status: "applied" }
  | { status: "duplicate" }
  | { status: "rejected"; reason: string };

export type ParseResult = { ok: true; report: Report } | { ok: false; error: string };

interface Player {
  id: string;
  name: string;
  day: string;
  dayMinutes: number;
  dayCash: number;
  totalMinutes: number;
  totalCash: number;
  recentReports: string[];
}

export interface StoreData {
  version: 1;
  players: Player[];
}

/* Bounds mirror the client: focus is clamped to 1–120 min and a round pays $5. */
export const LIMITS = {
  idLength: 64,
  nameLength: 24,
  minutesPerReport: 120,
  cashPerReport: 5,
  minutesPerDay: 24 * 60,
  rows: 50,
  rememberedReports: 256,
} as const;

const ID_RE = /^[A-Za-z0-9_-]+$/;

export function sanitizeName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LIMITS.nameLength)
    .trim();
}

function boundedAmount(value: unknown, max: number, field: string): number | string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n)) return `${field} must be a number`;
  if (n < 0 || n > max) return `${field} must be between 0 and ${max}`;
  return Math.floor(n);
}

function validKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= LIMITS.idLength && ID_RE.test(value);
}

export function parseReport(input: unknown): ParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const body = input as Record<string, unknown>;
  if (!validKey(body.id)) return { ok: false, error: "id must be 1-64 characters of [A-Za-z0-9_-]" };
  if (body.reportId !== undefined && !validKey(body.reportId)) {
    return { ok: false, error: "reportId must be 1-64 characters of [A-Za-z0-9_-]" };
  }
  const minutes = boundedAmount(body.minutes, LIMITS.minutesPerReport, "minutes");
  if (typeof minutes === "string") return { ok: false, error: minutes };
  const cash = boundedAmount(body.cash, LIMITS.cashPerReport, "cash");
  if (typeof cash === "string") return { ok: false, error: cash };

  const report: Report = { id: body.id, name: sanitizeName(body.name), minutes, cash };
  if (typeof body.reportId === "string") report.reportId = body.reportId;
  return { ok: true, report };
}

/* Deterministic order so every client renders identical ranks for ties. */
function compareRows(a: Row, b: Row): number {
  return b.minutes - a.minutes || b.cash - a.cash || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface StoreOptions {
  now?: () => Date;
}

export class LeaderboardStore {
  #players = new Map<string, Player>();
  #listeners = new Set<() => void>();
  #now: () => Date;

  constructor(options: StoreOptions = {}) {
    this.#now = options.now ?? (() => new Date());
  }

  get size(): number {
    return this.#players.size;
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  apply(report: Report): ApplyResult {
    const today = utcDay(this.#now());
    const existing = this.#players.get(report.id);

    if (report.reportId && existing?.recentReports.includes(report.reportId)) {
      return { status: "duplicate" };
    }

    const player: Player = existing ?? {
      id: report.id,
      name: "",
      day: today,
      dayMinutes: 0,
      dayCash: 0,
      totalMinutes: 0,
      totalCash: 0,
      recentReports: [],
    };

    // Daily counters roll over lazily; all-time totals never reset.
    const dayMinutes = player.day === today ? player.dayMinutes : 0;
    const dayCash = player.day === today ? player.dayCash : 0;
    if (dayMinutes + report.minutes > LIMITS.minutesPerDay) {
      return { status: "rejected", reason: `daily focus cannot exceed ${LIMITS.minutesPerDay} minutes` };
    }

    player.day = today;
    player.dayMinutes = dayMinutes + report.minutes;
    player.dayCash = dayCash + report.cash;
    player.totalMinutes += report.minutes;
    player.totalCash += report.cash;
    if (report.name) player.name = report.name;
    if (report.reportId) {
      player.recentReports.push(report.reportId);
      if (player.recentReports.length > LIMITS.rememberedReports) player.recentReports.shift();
    }

    this.#players.set(player.id, player);
    for (const listener of this.#listeners) listener();
    return { status: "applied" };
  }

  snapshot(): Snapshot {
    const today = utcDay(this.#now());
    const todayRows: Row[] = [];
    const allRows: Row[] = [];
    for (const p of this.#players.values()) {
      allRows.push({ id: p.id, name: p.name, minutes: p.totalMinutes, cash: p.totalCash });
      if (p.day === today) todayRows.push({ id: p.id, name: p.name, minutes: p.dayMinutes, cash: p.dayCash });
    }
    return {
      today: todayRows.sort(compareRows).slice(0, LIMITS.rows),
      all: allRows.sort(compareRows).slice(0, LIMITS.rows),
    };
  }

  toJSON(): StoreData {
    return { version: 1, players: [...this.#players.values()].map((p) => ({ ...p, recentReports: [...p.recentReports] })) };
  }

  static fromJSON(data: unknown, options: StoreOptions = {}): LeaderboardStore {
    const store = new LeaderboardStore(options);
    const players = (data as Partial<StoreData> | null)?.players;
    if (!Array.isArray(players)) return store;
    for (const raw of players) {
      if (!raw || !validKey(raw.id)) continue;
      const num = (v: unknown) => (Number.isFinite(v) && (v as number) >= 0 ? Math.floor(v as number) : 0);
      store.#players.set(raw.id, {
        id: raw.id,
        name: sanitizeName(raw.name),
        day: typeof raw.day === "string" ? raw.day : "",
        dayMinutes: num(raw.dayMinutes),
        dayCash: num(raw.dayCash),
        totalMinutes: num(raw.totalMinutes),
        totalCash: num(raw.totalCash),
        recentReports: Array.isArray(raw.recentReports)
          ? raw.recentReports.filter(validKey).slice(-LIMITS.rememberedReports)
          : [],
      });
    }
    return store;
  }
}
