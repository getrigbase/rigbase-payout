import fs from "node:fs";
import path from "node:path";
import { getAddress, parseUnits, type Address } from "viem";
import { TOKENS, type TokenSymbol } from "./chain.js";

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

export type Contractor = {
  id: string;
  label: string;
  corridor: string;
  payoutToken: TokenSymbol;
  address: Address;
};

export type StudioConfig = {
  business: string;
  chainId: number;
  fundingToken: "USDT";
  session: {
    weeklyCapUsdt: string;
    localCapsPerWeek: Partial<Record<TokenSymbol, string>>;
    expiryDays: number;
    feeTokenDailyCapUsdt: string;
  };
  contractors: Contractor[];
};

export type PayrollItem = { contractor: string; usdt: string; memo?: string };
export type Payroll = { id: string; note?: string; items: PayrollItem[] };

export function loadConfig(file = process.env.STUDIO_CONFIG ?? path.join(ROOT, "config/rigbase-studio.json")): StudioConfig {
  const c = JSON.parse(fs.readFileSync(file, "utf8")) as StudioConfig;
  for (const k of c.contractors) {
    k.address = getAddress(k.address);
    if (!TOKENS[k.payoutToken]) throw new Error(`Unknown payout token ${k.payoutToken} for ${k.id}`);
  }
  return c;
}

export function loadPayroll(file: string): Payroll {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8")) as Payroll;
}

export const usdt = (s: string) => parseUnits(s, TOKENS.USDT.decimals);
export const units = (sym: TokenSymbol, s: string) => parseUnits(s, TOKENS[sym].decimals);
