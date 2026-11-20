import { erc20Abi, formatUnits, type Address } from "viem";
import { TOKENS, type TokenSymbol } from "./chain.js";
import { pub } from "./identity.js";

export async function balances(addr: Address) {
  const out: Record<string, { raw: bigint; fmt: string }> = {};
  const celoRaw = await pub.getBalance({ address: addr });
  out.CELO = { raw: celoRaw, fmt: formatUnits(celoRaw, 18) };
  for (const sym of Object.keys(TOKENS) as TokenSymbol[]) {
    const raw = await pub.readContract({ address: TOKENS[sym].address, abi: erc20Abi, functionName: "balanceOf", args: [addr] });
    out[sym] = { raw, fmt: formatUnits(raw, TOKENS[sym].decimals) };
  }
  return out;
}

export async function allowance(token: Address, owner: Address, spender: Address) {
  return pub.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
}
