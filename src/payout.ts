/**
 * Payout runner: payroll file -> (Textile quote) -> Altana session execute.
 * Each FX payout is ONE atomic intent: approve USDT -> Textile swap -> transfer
 * the local stablecoin to the contractor. A direct USDT payout is one transfer.
 */
import { encodeFunctionData, erc20Abi, formatUnits, type Account, type Address, type Hex } from "viem";
import type { Session } from "@altananetwork/sdk";
import { CONTRACTS, TOKENS, txUrl, type TokenSymbol } from "./chain.js";
import { usdt, type Payroll, type StudioConfig } from "./config.js";
import { RunLog, usdtSpentLast7Days } from "./runlog.js";
import * as textile from "./textile.js";
import { executeAsSession, quoteAsSession } from "./altana.js";
import { allowance } from "./balances.js";
import { tagCalls, type TaggableCall } from "./attribution.js";

const transfer = (token: Address, to: Address, amount: bigint): TaggableCall => ({
  to: token,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }),
});
const approve = (token: Address, spender: Address, amount: bigint): TaggableCall => ({
  to: token,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
});

export type RunOpts = {
  live: boolean;
  /** Ask the relay to simulate an over-cap payout to show the on-chain cap refusing it. Never broadcasts it. */
  probeCap: boolean;
  session?: Session;
  wallet: Address;
  account: Account;
};

export async function runPayroll(cfg: StudioConfig, payroll: Payroll, opts: RunOpts, log: RunLog) {
  const cap = usdt(cfg.session.weeklyCapUsdt);
  let spent = usdtSpentLast7Days();
  log.add("payroll.start", { payroll: payroll.id, business: cfg.business, weeklyCapUsdt: cfg.session.weeklyCapUsdt, spentLast7dUsdt: formatUnits(spent, 6) });

  for (const item of payroll.items) {
    const c = cfg.contractors.find((x) => x.id === item.contractor);
    if (!c) { log.add("payout.skipped", { contractor: item.contractor, reason: "unknown contractor (not on allowlist)" }); continue; }
    const amount = usdt(item.usdt);
    const base = { contractor: c.id, to: c.address, corridor: c.corridor, usdt: item.usdt, memo: item.memo };

    const overCap = spent + amount > cap;
    if (overCap && !opts.probeCap) {
      log.add("payout.rejected", { ...base, by: "local-guard", reason: `would bring weekly spend to ${formatUnits(spent + amount, 6)} > cap ${cfg.session.weeklyCapUsdt} USDT` });
      continue;
    }

    // ---- build calls
    let calls: TaggableCall[];
    let rfq: textile.TextileFirm | undefined;
    if (c.payoutToken === "USDT") {
      calls = [transfer(TOKENS.USDT.address, c.address, amount)];
    } else {
      const buy = TOKENS[c.payoutToken as TokenSymbol];
      const pv = await textile.preview(TOKENS.USDT.address, buy.address, amount);
      log.add("textile.preview", { ...base, status: pv.status, buyAmount: pv.buyAmount, buy: `${formatUnits(BigInt(pv.buyAmount ?? 0), buy.decimals)} ${c.payoutToken}`, feeAmount: pv.feeAmount, takerPays: pv.takerPays, rateRay: pv.rateRay, reason: pv.reason });
      if (pv.status !== "preview") { log.add("payout.skipped", { ...base, reason: `no Textile quote: ${pv.reason}` }); continue; }

      if (!opts.live || overCap) {
        // Dry run / cap probe: no firm RFQ (it would lock maker inventory). Swap calldata is a placeholder.
        calls = [approve(TOKENS.USDT.address, CONTRACTS.textileReactor, amount), { to: CONTRACTS.textileReactor, data: "0x" }, transfer(buy.address, c.address, BigInt(pv.buyAmount))];
      } else {
        rfq = await textile.requestFirm(opts.account, TOKENS.USDT.address, buy.address, amount);
        if (rfq.status !== "quoted" || !rfq.quote || !rfq.transactions) { log.add("payout.skipped", { ...base, reason: `Textile no_quote: ${rfq.reason}`, rfqId: rfq.rfqId }); continue; }
        const q = rfq.quote;
        log.add("textile.firm", { ...base, rfqId: rfq.rfqId, takerPays: q.takerPays, buyAmount: q.buyAmount, feeAmount: q.feeAmount, expiresAt: q.expiresAt, reactor: q.reactor });
        if (q.taker.toLowerCase() !== opts.wallet.toLowerCase()) throw new Error("Textile quote bound to a different taker");
        if (BigInt(q.takerPays) > amount) throw new Error("Textile takerPays exceeds requested amount");
        const need = BigInt(q.takerPays);
        const have = await allowance(TOKENS.USDT.address, opts.wallet, q.reactor);
        calls = [];
        if (have < need) {
          if (have > 0n) calls.push(approve(TOKENS.USDT.address, q.reactor, 0n));
          calls.push({ to: rfq.transactions.approval.to, data: rfq.transactions.approval.data });
        }
        calls.push({ to: rfq.transactions.swap.to, data: rfq.transactions.swap.data });
        calls.push(transfer(buy.address, c.address, BigInt(q.buyAmount)));
      }
    }
    const tagged = tagCalls(calls);
    log.add("payout.calls", { ...base, calls: tagged.map((x) => ({ to: x.to, data: x.data })) });

    // ---- cap probe: simulate only
    if (overCap) {
      if (!opts.session) { log.add("payout.rejected", { ...base, by: "local-guard", reason: "over weekly cap (no session to probe on-chain)" }); continue; }
      try {
        const q = await quoteAsSession(opts.session, calls);
        log.add("cap-probe.UNEXPECTED_ACCEPT", { ...base, fee: q.fee, note: "relay would accept an over-cap intent; NOT broadcast" });
      } catch (e) {
        log.add("payout.rejected", { ...base, by: "altana-session-cap (relay simulation of on-chain policy)", reason: String((e as Error).message ?? e).slice(0, 600) });
      }
      continue;
    }

    // ---- dry run
    if (!opts.live) {
      if (opts.session) {
        try {
          const q = await quoteAsSession(opts.session, calls);
          log.add("payout.quote", { ...base, relayFee: q.fee, feeToken: q.feeToken });
        } catch (e) {
          log.add("payout.quote-failed", { ...base, reason: String((e as Error).message ?? e).slice(0, 400) });
        }
      }
      log.add("payout.dry-run", { ...base, note: "not broadcast" });
      spent += amount;
      continue;
    }

    // ---- live
    if (!opts.session) throw new Error("No granted session. Run `pay grant --live` first.");
    if (rfq?.quote && Date.now() >= Date.parse(rfq.quote.expiresAt) - 3000) {
      await textile.cancel(rfq.rfqId, rfq.claimToken);
      log.add("payout.skipped", { ...base, reason: "Textile quote expired before broadcast" });
      continue;
    }
    try {
      const res = await executeAsSession(opts.session, calls);
      const ok = res.status === "CONFIRMED";
      if (rfq && res.transactionHash) await textile.submit(rfq.rfqId, rfq.claimToken, res.transactionHash as Hex);
      log.add(ok ? "payout.confirmed" : "payout.not-confirmed", {
        ...base, usdtSpent: ok ? (rfq?.quote?.takerPays ?? amount.toString()) : "0",
        callsId: res.callsId, txHash: res.transactionHash, status: res.status, statusCode: res.statusCode,
        celoscan: res.transactionHash ? txUrl(res.transactionHash) : undefined, rfqId: rfq?.rfqId,
      });
      if (ok) spent += BigInt(rfq?.quote?.takerPays ?? amount);
    } catch (e) {
      if (rfq) await textile.cancel(rfq.rfqId, rfq.claimToken);
      log.add("payout.failed", { ...base, reason: String((e as Error).message ?? e).slice(0, 800) });
    }
  }
  log.add("payroll.end", { spentLast7dUsdt: formatUnits(spent, 6) });
}
