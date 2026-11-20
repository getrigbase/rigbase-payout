/**
 * Altana session wallet (Track 4).
 *
 * The RigBase admin key IS the Altana wallet (EIP-7702: same address). The
 * admin grants the payout agent a session key with:
 *   - a weekly USDT spend cap (plus weekly caps on the local stablecoins),
 *   - a contract allowlist (USDT approve/transfer, Textile reactor, cNGN/IDRX transfer),
 *   - an expiry.
 * The caps are enforced on-chain by the account, not by this code.
 */
import fs from "node:fs";
import path from "node:path";
import {
  CELO,
  createClient,
  deserializeSession,
  serializeSession,
  type CallPermission,
  type Session,
  type SessionPermissions,
  type Signer,
  type SpendPermission,
} from "@altananetwork/sdk";
import { generatePrivateKey } from "viem/accounts";
import { signerFromPrivateKey } from "@altananetwork/sdk";
import { CHAIN_ID, CONTRACTS, TOKENS, type TokenSymbol } from "./chain.js";
import { ROOT, units, usdt, type StudioConfig } from "./config.js";
import { assertCallsTagged, tagCalls, type TaggableCall } from "./attribution.js";

export const SESSION_STATE_FILE = process.env.SESSION_STATE_FILE ?? path.join(ROOT, "state/session.json");

/**
 * Explicit ERC-8004 registration is done by `pay identity` (a tagged direct tx),
 * so the SDK's automatic, untagged registration is turned off.
 */
export const altana = createClient({ chains: [CELO], agentIdentity: false });

export function buildPermissions(cfg: StudioConfig): SessionPermissions {
  const calls: CallPermission[] = [
    { to: TOKENS.USDT.address, signature: "approve(address,uint256)" },
    { to: TOKENS.USDT.address, signature: "transfer(address,uint256)" },
    { to: CONTRACTS.textileReactor },
  ];
  const spend: SpendPermission[] = [
    { token: TOKENS.USDT.address, limit: usdt(cfg.session.weeklyCapUsdt), period: "week" },
  ];
  for (const [sym, cap] of Object.entries(cfg.session.localCapsPerWeek) as [TokenSymbol, string][]) {
    calls.push({ to: TOKENS[sym].address, signature: "transfer(address,uint256)" });
    spend.push({ token: TOKENS[sym].address, limit: units(sym, cap), period: "week" });
  }
  return { calls, spend };
}

export function grantArgs(cfg: StudioConfig, admin: { address: `0x${string}`; signer: Signer }, sessionSigner: Signer) {
  return {
    wallet: { address: admin.address },
    signer: admin.signer,
    sessionSigner,
    permissions: buildPermissions(cfg),
    expiry: Math.floor(Date.now() / 1000) + cfg.session.expiryDays * 86400,
    feeToken: TOKENS.USDT.address,
    feeSpendLimit: usdt(cfg.session.feeTokenDailyCapUsdt),
    register: true,
    chainId: CHAIN_ID,
  } as const;
}

export function ephemeralSigner(): Signer {
  return signerFromPrivateKey(generatePrivateKey());
}

export function saveSession(s: Session) {
  fs.mkdirSync(path.dirname(SESSION_STATE_FILE), { recursive: true });
  fs.writeFileSync(SESSION_STATE_FILE, JSON.stringify(serializeSession(s), null, 2));
}

export function loadSession(sessionSigner: Signer): Session | undefined {
  if (!fs.existsSync(SESSION_STATE_FILE)) return undefined;
  return deserializeSession(JSON.parse(fs.readFileSync(SESSION_STATE_FILE, "utf8")), sessionSigner);
}

/** The ONLY path that hands calls to the Altana relay. Tags, asserts, then executes. */
export async function executeAsSession(session: Session, calls: TaggableCall[]) {
  const tagged = tagCalls(calls);
  assertCallsTagged(tagged);
  return altana.execute({ session, calls: tagged, feeToken: TOKENS.USDT.address, chainId: CHAIN_ID });
}

export async function quoteAsSession(session: Session, calls: TaggableCall[]) {
  const tagged = tagCalls(calls);
  assertCallsTagged(tagged);
  return altana.quoteExecute({ session, calls: tagged, feeToken: TOKENS.USDT.address, chainId: CHAIN_ID });
}
