import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.js";

const json = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);

export class RunLog {
  readonly startedAt = new Date().toISOString();
  readonly events: Record<string, unknown>[] = [];
  constructor(readonly command: string, readonly mode: "dry-run" | "live", readonly meta: Record<string, unknown> = {}) {}

  add(event: string, data: Record<string, unknown> = {}) {
    const e = { at: new Date().toISOString(), event, ...data };
    this.events.push(e);
    console.log(`[${this.mode}] ${event}`, Object.keys(data).length ? json(data) : "");
  }

  save() {
    const dir = path.join(ROOT, "runs", this.mode === "live" ? "live" : "dry");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${this.startedAt.replace(/[:.]/g, "-")}-${this.command}.json`);
    fs.writeFileSync(file, json({ command: this.command, mode: this.mode, startedAt: this.startedAt, ...this.meta, events: this.events }) + "\n");
    console.log(`run log -> ${path.relative(ROOT, file)}`);
    return file;
  }
}

/** USDT (6dp, base units) sent by live payroll runs in the last 7 days. Local mirror of the on-chain cap. */
export function usdtSpentLast7Days(): bigint {
  const dir = path.join(ROOT, "runs/live");
  if (!fs.existsSync(dir)) return 0n;
  const since = Date.now() - 7 * 86400_000;
  let total = 0n;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const r = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    for (const e of r.events ?? []) {
      if (e.event === "payout.confirmed" && Date.parse(e.at) >= since) total += BigInt(e.usdtSpent ?? 0);
    }
  }
  return total;
}
