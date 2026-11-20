/**
 * ERC-8021 attribution, wired in ONE place.
 *
 * Every transaction RigBase Payout sends goes through one of two paths:
 *  1. Direct EOA transactions -> `taggedWalletClient()` (viem client extended
 *     with `withAttribution`, per celo-org/attribution-tags BUILDERS.md).
 *  2. Altana relayed intents -> `tagCalls()` appends the same suffix to every
 *     inner call's calldata, and `assertCallsTagged()` refuses to hand an
 *     untagged call to the relay.
 *
 * Nothing else in the codebase is allowed to build a wallet client or call
 * `client.execute` directly.
 */
import { toDataSuffix, withAttribution, fromDataSuffix, ERC_8021_MARKER } from "@celo/attribution-tags";
import { concat, createWalletClient, http, type Account, type Hex } from "viem";
import { celo } from "viem/chains";
import { RPC_URL } from "./chain.js";

/** Issued by Loops at enrollment ("Agents Open for Business"). */
export const LOOPS_ATTRIBUTION_CODE = "celo_f41eab517821";

export const ATTRIBUTION_CODE = process.env.ATTRIBUTION_CODE ?? LOOPS_ATTRIBUTION_CODE;
if (ATTRIBUTION_CODE !== LOOPS_ATTRIBUTION_CODE) {
  throw new Error(`ATTRIBUTION_CODE (${ATTRIBUTION_CODE}) does not match the Loops-issued code; refusing to run.`);
}

export const SUFFIX: Hex = toDataSuffix(ATTRIBUTION_CODE) as Hex;

export function isTagged(data: Hex | undefined): boolean {
  if (!data) return false;
  const r = fromDataSuffix(data);
  return !!r && r.codes.includes(ATTRIBUTION_CODE);
}

/** Append our suffix (idempotent). */
export function tagData(data: Hex | undefined): Hex {
  const d = (data ?? "0x") as Hex;
  return isTagged(d) ? d : (concat([d, SUFFIX]) as Hex);
}

export type TaggableCall = { to: `0x${string}`; data?: Hex; value?: bigint };

export function tagCalls<T extends TaggableCall>(calls: readonly T[]): T[] {
  return calls.map((c) => ({ ...c, data: tagData(c.data) }));
}

export function assertCallsTagged(calls: readonly TaggableCall[]): void {
  for (const c of calls) {
    if (!isTagged(c.data)) throw new Error(`Refusing to send untagged call to ${c.to}`);
  }
}

/** The only way to get a wallet client for direct (non-relayed) transactions. */
export function taggedWalletClient(account: Account) {
  return createWalletClient({ account, chain: celo, transport: http(RPC_URL) }).extend(
    withAttribution(ATTRIBUTION_CODE),
  );
}

/**
 * Find every ERC-8021 Schema-0 tag anywhere in a tx input. Relayed (Altana /
 * Porto Orchestrator) transactions carry our tag inside the ABI-encoded intent,
 * not at the very end, so we scan for the marker instead of only reading the tail.
 */
export function findTagsInInput(input: Hex): { offset: number; codes: string[] }[] {
  const hex = input.slice(2).toLowerCase();
  const marker = (ERC_8021_MARKER as string).replace(/^0x/, "").toLowerCase();
  const out: { offset: number; codes: string[] }[] = [];
  let i = hex.indexOf(marker);
  while (i !== -1) {
    if (i % 2 === 0 && i >= 4) {
      const schema = parseInt(hex.slice(i - 2, i), 16);
      const len = parseInt(hex.slice(i - 4, i - 2), 16);
      const start = i - 4 - len * 2;
      if (schema === 0 && start >= 0) {
        const ascii = Buffer.from(hex.slice(start, i - 4), "hex").toString("latin1");
        out.push({ offset: start / 2, codes: ascii.split(",") });
      }
    }
    i = hex.indexOf(marker, i + 2);
  }
  return out;
}
