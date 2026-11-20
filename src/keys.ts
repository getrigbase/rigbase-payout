/**
 * Key loading. Keys live OUTSIDE the repo, at paths given by env. Nothing here
 * ever logs or returns key material to callers other than as signers/accounts.
 */
import fs from "node:fs";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { signerFromPrivateKey } from "@altananetwork/sdk";
import type { Hex } from "viem";

export const EXPECTED_WALLET = "0x22d66bD658ad8b5269998545719941479ef4478d";

function requireOutsideRepo(p: string) {
  const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const abs = path.resolve(p);
  if (abs.startsWith(repo + path.sep)) throw new Error(`Key file ${abs} is inside the repo; move it out.`);
  return abs;
}

export function loadAdmin() {
  const p = process.env.WALLET_FILE;
  if (!p) throw new Error("WALLET_FILE is not set (path to the admin wallet JSON, outside the repo).");
  const raw = JSON.parse(fs.readFileSync(requireOutsideRepo(p), "utf8")) as { address: string; privateKey: Hex };
  const account = privateKeyToAccount(raw.privateKey);
  if (account.address.toLowerCase() !== EXPECTED_WALLET.toLowerCase())
    throw new Error(`WALLET_FILE address ${account.address} is not the RigBase agent wallet.`);
  return { address: account.address, account, signer: signerFromPrivateKey(raw.privateKey) };
}

/** The agent's session key: generated once, persisted separately from the admin key. */
export function loadOrCreateSessionKey(opts: { create: boolean }) {
  const p = process.env.SESSION_KEY_FILE;
  if (!p) throw new Error("SESSION_KEY_FILE is not set.");
  const abs = requireOutsideRepo(p);
  if (!fs.existsSync(abs)) {
    if (!opts.create) return undefined;
    const privateKey = generatePrivateKey();
    fs.writeFileSync(abs, JSON.stringify({ privateKey, createdAt: new Date().toISOString() }), { mode: 0o600 });
  }
  const { privateKey } = JSON.parse(fs.readFileSync(abs, "utf8")) as { privateKey: Hex };
  return { address: privateKeyToAccount(privateKey).address, signer: signerFromPrivateKey(privateKey) };
}
