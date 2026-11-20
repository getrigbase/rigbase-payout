import type { Address } from "viem";

/** Celo mainnet. Verified against https://forno.celo.org on 2026-11-20. */
export const CHAIN_ID = 42220;
export const RPC_URL = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
export const EXPLORER = "https://celoscan.io";

export type TokenSymbol = "USDT" | "USDC" | "cNGN" | "IDRX";

/** CELO's ERC-20 interface (GoldToken). */
export const CELO_TOKEN = "0x471EcE3750Da237f93B8E339c536989b8978a438" as const;

export const TOKENS: Record<TokenSymbol, { address: Address; decimals: number }> = {
  USDT: { address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", decimals: 6 },
  USDC: { address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", decimals: 6 },
  cNGN: { address: "0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f", decimals: 6 },
  IDRX: { address: "0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22", decimals: 2 },
};

export const CONTRACTS = {
  /** Textile FX LimitOrderReactor (swap settlement). */
  textileReactor: "0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3" as Address,
  /** Canonical Permit2. */
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address,
  /** ERC-8004 Identity Registry on Celo. */
  erc8004Identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as Address,
  /** Altana KeystoreController on Celo. */
  altanaKeystoreController: "0x47bA5fc2A5b0CcB24BA3fAC9D4B59400eE9fd1D6" as Address,
};

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (a: string) => `${EXPLORER}/address/${a}`;
