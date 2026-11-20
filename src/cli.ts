#!/usr/bin/env node
/**
 * RigBase Payout CLI.
 *   pay status
 *   pay identity        [--live]   ERC-8004 register (direct, tagged)
 *   pay grant           [--live]   Altana grantSession (quoteGrantSession in dry run)
 *   pay run <payroll>   [--live] [--probe-cap]
 *   pay revoke          [--live]
 *   pay verify <txhash...>
 * Broadcasting requires BOTH `--live` and LIVE=1. Everything else is a dry run.
 */
import { formatUnits, type Hex } from "viem";
import { CELO, formatQuoteLine } from "@altananetwork/sdk";
import { addressUrl, CHAIN_ID, txUrl } from "./chain.js";
import { loadConfig, loadPayroll } from "./config.js";
import { loadAdmin, loadOrCreateSessionKey } from "./keys.js";
import { ATTRIBUTION_CODE, SUFFIX, taggedWalletClient, isTagged } from "./attribution.js";
import { altana, buildPermissions, ephemeralSigner, grantArgs, loadSession, saveSession } from "./altana.js";
import { agentIdFromReceipt, AGENT_URI, existingAgents, pub, registerCall, writeAgentId } from "./identity.js";
import { balances } from "./balances.js";
import { RunLog, usdtSpentLast7Days } from "./runlog.js";
import { runPayroll } from "./payout.js";
import { verifyHash } from "./verify.js";

const args = process.argv.slice(2);
const cmd = args[0] ?? "status";
const flag = (f: string) => args.includes(f);
const live = flag("--live") && process.env.LIVE === "1";
if (flag("--live") && !live) console.warn("--live given but LIVE!=1: staying in dry-run.");
const mode = live ? "live" : "dry-run";

/** Abort before any unexpected cost. Values in CELO / USDT. */
const MAX_CELO_PER_STEP = Number(process.env.MAX_CELO_PER_STEP ?? 30);

async function main() {
  const cfg = loadConfig();
  const admin = loadAdmin();
  const log = new RunLog(cmd, mode, { wallet: admin.address, chainId: CHAIN_ID, attributionCode: ATTRIBUTION_CODE, suffix: SUFFIX });

  try {
    if (cmd === "status") {
      const b = await balances(admin.address);
      const sk = loadOrCreateSessionKey({ create: false });
      const s = sk && loadSession(sk.signer);
      log.add("status", {
        wallet: admin.address, explorer: addressUrl(admin.address),
        nonce: await pub.getTransactionCount({ address: admin.address }),
        balances: Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.fmt])),
        erc8004Agents: (await existingAgents(admin.address)).toString(),
        session: s ? { publicKey: s.publicKey, expiry: new Date(s.expiry * 1000).toISOString() } : null,
        usdtSpentLast7d: formatUnits(usdtSpentLast7Days(), 6),
        attribution: { code: ATTRIBUTION_CODE, suffix: SUFFIX },
      });
    } else if (cmd === "identity") {
      const count = await existingAgents(admin.address);
      const call = registerCall();
      log.add("erc8004.plan", { agentURI: AGENT_URI, existingAgents: count.toString(), to: call.to, taggedDataEndsWithSuffix: isTagged((call.data + SUFFIX.slice(2)) as Hex) });
      if (count > 0n) { log.add("erc8004.skip", { reason: "wallet already owns an ERC-8004 agent" }); return; }
      const wc = taggedWalletClient(admin.account);
      const gas = await pub.estimateGas({ account: admin.address, to: call.to, data: (call.data + SUFFIX.slice(2)) as Hex }).catch((e) => { log.add("erc8004.estimate-failed", { reason: String(e.shortMessage ?? e) }); return undefined; });
      const gasPrice = await pub.getGasPrice();
      if (gas) log.add("erc8004.cost", { gas, estCELO: formatUnits(gas * gasPrice, 18) });
      if (!live) return;
      if (gas && Number(formatUnits(gas * gasPrice, 18)) > MAX_CELO_PER_STEP) throw new Error("ERC-8004 register costs more than expected; aborting");
      const hash = await wc.sendTransaction({ to: call.to, data: call.data });
      log.add("erc8004.sent", { txHash: hash, celoscan: txUrl(hash) });
      const { agentId, receipt } = await agentIdFromReceipt(hash);
      log.add("erc8004.confirmed", { txHash: hash, status: receipt.status, agentId: agentId?.toString() });
      if (agentId !== undefined) writeAgentId(agentId);
    } else if (cmd === "grant") {
      const sk = live ? loadOrCreateSessionKey({ create: true })! : (loadOrCreateSessionKey({ create: false }) ?? { address: "(ephemeral, dry run)", signer: ephemeralSigner() });
      const a = grantArgs(cfg, admin, sk.signer);
      log.add("grant.permissions", { sessionKey: sk.address, permissions: buildPermissions(cfg), expiry: new Date(a.expiry * 1000).toISOString() });
      const wallet = await altana.createWallet({ signer: admin.signer });
      const quote = await altana.quoteGrantSession(a);
      log.add("grant.quote", { lines: quote.lines?.map((l) => formatQuoteLine(l, CELO)), raw: quote });
      if (!live) return;
      // First grant pays the Keystore fee twice (admin + session key); budget for that.
      const nativeNeeded = (quote.lines ?? []).reduce((s, l) => s + (l.needed > 2n * l.value ? l.needed : 2n * l.value), 0n);
      if (Number(formatUnits(nativeNeeded, 18)) > MAX_CELO_PER_STEP) throw new Error(`grantSession needs ${formatUnits(nativeNeeded, 18)} CELO > MAX_CELO_PER_STEP; aborting`);
      const s = await altana.grantSession({ ...a, wallet });
      saveSession(s);
      log.add("grant.done", { status: s.status, txHash: s.transactionHash, celoscan: s.transactionHash ? txUrl(s.transactionHash) : undefined, keyId: s.keyId, legs: s.legs });
    } else if (cmd === "run") {
      const file = args[1];
      if (!file || file.startsWith("--")) throw new Error("usage: pay run <payroll.json> [--live] [--probe-cap]");
      const sk = loadOrCreateSessionKey({ create: false });
      const session = sk ? loadSession(sk.signer) : undefined;
      await runPayroll(cfg, loadPayroll(file), { live, probeCap: flag("--probe-cap"), session, wallet: admin.address, account: admin.account }, log);
    } else if (cmd === "revoke") {
      const sk = loadOrCreateSessionKey({ create: false });
      const session = sk && loadSession(sk.signer);
      if (!session) throw new Error("no session to revoke");
      const wallet = await altana.createWallet({ signer: admin.signer });
      const q = await altana.quoteRevokeSession({ wallet, signer: admin.signer, session });
      log.add("revoke.quote", { raw: q });
      if (!live) return;
      const r = await altana.revokeSession({ wallet, signer: admin.signer, session });
      log.add("revoke.done", { raw: r });
    } else if (cmd === "verify") {
      for (const h of args.slice(1).filter((x) => x.startsWith("0x"))) log.add("verify", await verifyHash(h as Hex));
    } else {
      throw new Error(`unknown command ${cmd}`);
    }
  } finally {
    log.save();
  }
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
