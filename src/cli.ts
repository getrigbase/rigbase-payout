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
import { formatUnits, parseUnits, type Hex } from "viem";
import * as textile from "./textile.js";
import { allowance } from "./balances.js";
import { CELO, formatQuoteLine } from "@altananetwork/sdk";
import { addressUrl, CELO_TOKEN, CHAIN_ID, TOKENS, txUrl } from "./chain.js";
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
      // An incomplete quote (unfunded wallet) under-states it, so double the value in that case.
      const nativeNeeded = (quote.lines ?? []).reduce((s, l) => { const v = quote.complete ? l.value : 2n * l.value; return s + (l.needed > v ? l.needed : v); }, 0n);
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
    } else if (cmd === "fund-usdt") {
      // Treasury top-up: CELO -> USDT via Textile RFQ, DIRECT from the RigBase wallet (tag at tail).
      const celoAmt = args[1];
      if (!celoAmt || celoAmt.startsWith("--")) throw new Error("usage: pay fund-usdt <CELO amount> [--live]");
      const sell = parseUnits(celoAmt, 18);
      const bal = await pub.getBalance({ address: admin.address });
      if (bal - sell < parseUnits(process.env.MIN_CELO_RESERVE ?? "45", 18)) throw new Error("would leave less than the CELO reserve for the Altana grant");
      const pv = await textile.preview(CELO_TOKEN, TOKENS.USDT.address, sell);
      const mkt = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=celo&vs_currencies=usd").then((r) => r.json()).then((j: any) => Number(j.celo.usd)).catch(() => undefined);
      const fair = mkt ? Number(celoAmt) * mkt : undefined;
      log.add("fund.preview", { sellCELO: celoAmt, buyUSDT: formatUnits(BigInt(pv.buyAmount ?? 0), 6), marketUsd: fair, status: pv.status });
      if (!live) return;
      const firm = await textile.requestFirm(admin.account, CELO_TOKEN, TOKENS.USDT.address, sell);
      if (firm.status !== "quoted" || !firm.quote || !firm.transactions) throw new Error(`no firm quote: ${firm.reason}`);
      const out = Number(formatUnits(BigInt(firm.quote.buyAmount), 6));
      log.add("fund.firm", { rfqId: firm.rfqId, takerPays: firm.quote.takerPays, buyUSDT: out, expiresAt: firm.quote.expiresAt });
      if (fair && out < fair * 0.98) { await textile.cancel(firm.rfqId, firm.claimToken); throw new Error(`quote ${out} USDT is >2% below market ${fair.toFixed(4)}; aborting`); }
      const wc = taggedWalletClient(admin.account);
      const have = await allowance(CELO_TOKEN, admin.address, firm.quote.reactor);
      if (have < BigInt(firm.quote.takerPays)) {
        const ah = await wc.sendTransaction({ to: firm.transactions.approval.to, data: firm.transactions.approval.data });
        log.add("fund.approve.sent", { txHash: ah, celoscan: txUrl(ah) });
        await pub.waitForTransactionReceipt({ hash: ah });
      }
      if (Date.now() >= Date.parse(firm.quote.expiresAt) - 3000) { await textile.cancel(firm.rfqId, firm.claimToken); throw new Error("quote expired during approval"); }
      const sh = await wc.sendTransaction({ to: firm.transactions.swap.to, data: firm.transactions.swap.data, value: BigInt(firm.transactions.swap.value) });
      log.add("fund.swap.sent", { txHash: sh, celoscan: txUrl(sh) });
      await textile.submit(firm.rfqId, firm.claimToken, sh);
      const r = await pub.waitForTransactionReceipt({ hash: sh });
      log.add("fund.swap.confirmed", { txHash: sh, status: r.status });
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

main().catch((e) => {
  console.error(e?.message ?? e);
  // Altana errors keep the relay's long form on `detail`; hex blobs are elided.
  const d = e?.detail ?? e?.cause?.message;
  if (d && process.env.DEBUG) console.error("detail:", String(typeof d === "string" ? d : JSON.stringify(d)).replace(/0x[0-9a-fA-F]{64,}/g, "<hex>").slice(0, 3000));
  process.exit(1);
});
