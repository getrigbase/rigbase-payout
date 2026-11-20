#!/usr/bin/env bash
# Refuse to push if any known private key (or anything key-shaped) is in the
# working tree or git history. Key files are read from env paths, never printed.
set -euo pipefail
cd "$(dirname "$0")/.."
node --input-type=module - <<'JS'
import fs from "node:fs";
import { execSync } from "node:child_process";
const keyFiles = [process.env.WALLET_FILE, process.env.SESSION_KEY_FILE, process.env.CONTRACTORS_FILE].filter(Boolean);
const keys = [];
const walk = (v) => { if (typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v)) keys.push(v.slice(2).toLowerCase()); else if (v && typeof v === "object") Object.values(v).forEach(walk); };
for (const f of keyFiles) if (fs.existsSync(f)) walk(JSON.parse(fs.readFileSync(f, "utf8")));
const tracked = execSync("git ls-files -co --exclude-standard", { encoding: "utf8" }).split("\n").filter(Boolean);
let bad = 0;
for (const f of tracked) {
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) continue;
  const s = fs.readFileSync(f, "utf8").toLowerCase();
  for (const k of keys) if (s.includes(k)) { console.error(`SECRET: known private key found in ${f}`); bad++; }
  if (/"?private_?key"?\s*[:=]\s*"?0x[0-9a-f]{64}/i.test(s)) { console.error(`SECRET: key-shaped value in ${f}`); bad++; }
}
const history = execSync("git log -p --all 2>/dev/null || true", { encoding: "utf8", maxBuffer: 1 << 28 }).toLowerCase();
for (const k of keys) if (history.includes(k)) { console.error("SECRET: known private key found in git history"); bad++; }
console.log(`secret-scan: ${keys.length} key(s) checked against ${tracked.length} files + history -> ${bad ? "FAIL" : "clean"}`);
process.exit(bad ? 1 : 0);
JS
