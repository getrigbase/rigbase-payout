/**
 * Textile FX RFQ v2 (https://docs.textilecredit.com/api/v2/rfq.html).
 * Keyless: the taker wallet signs a short EIP-712 TakerControl proof on the
 * firm request. No partner key, so Textile adds no tag of its own and ours is
 * the only one on the swap calldata.
 */
import { bytesToHex, type Account, type Address, type Hex } from "viem";
import { randomBytes } from "node:crypto";
import { CHAIN_ID } from "./chain.js";

const API = process.env.TEXTILE_API ?? "https://api.textilecredit.com/v2";

export type TextilePreview = {
  status: "preview" | "no_quote";
  sellAmount: string;
  buyAmount: string;
  feeAmount: string;
  takerPays: string;
  rateRay: string;
  availableSellAmount?: string;
  reason?: string;
};

export type TextileTx = { to: Address; data: Hex; value: string; chainId: number };
export type TextileFirm = {
  rfqId: string;
  claimToken: string;
  status: "quoted" | "no_quote";
  reason?: string;
  quote?: {
    sellAmount: string;
    buyAmount: string;
    feeAmount: string;
    takerPays: string;
    rateRay: string;
    expiresAt: string;
    orderDeadline: string;
    reactor: Address;
    taker: Address;
  };
  transactions?: { approval: TextileTx; swap: TextileTx };
};

async function post<T>(p: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${API}${p}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(75_000),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: T; error?: unknown };
  if (!res.ok) throw new Error(`Textile ${p} -> HTTP ${res.status}: ${JSON.stringify(json.error ?? json)} (req ${res.headers.get("x-request-id")})`);
  return json.data as T;
}

export function preview(sellToken: Address, buyToken: Address, sellAmount: bigint) {
  return post<TextilePreview>("/rfq/preview", { chainId: CHAIN_ID, sellToken, buyToken, sellAmount: sellAmount.toString() });
}

export async function takerProof(account: Account) {
  const nonce = bytesToHex(randomBytes(32));
  const issuedAt = Date.now();
  const signature = await account.signTypedData!({
    domain: { name: "Textile Taker Control", version: "1", chainId: CHAIN_ID },
    types: {
      TakerControl: [
        { name: "taker", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "nonce", type: "bytes32" },
        { name: "issuedAt", type: "uint256" },
      ],
    },
    primaryType: "TakerControl",
    message: { taker: account.address, chainId: BigInt(CHAIN_ID), nonce, issuedAt: BigInt(issuedAt) },
  });
  return { nonce, issuedAt, signature };
}

/** Firm quote. Locks maker inventory for ~60 s, so only call when about to execute. */
export async function requestFirm(account: Account, sellToken: Address, buyToken: Address, sellAmount: bigint) {
  return post<TextileFirm>("/rfq/request", {
    chainId: CHAIN_ID,
    sellToken,
    buyToken,
    sellAmount: sellAmount.toString(),
    taker: account.address,
    takerProof: await takerProof(account),
  });
}

export async function cancel(rfqId: string, claimToken: string) {
  return post(`/rfq/${rfqId}/cancel`, {}, { "X-Rfq-Claim": claimToken }).catch(() => undefined);
}

export async function submit(rfqId: string, claimToken: string, txHash: Hex) {
  return post(`/rfq/${rfqId}/submit`, { txHash }, { "X-Rfq-Claim": claimToken }).catch((e) => ({ error: String(e) }));
}
