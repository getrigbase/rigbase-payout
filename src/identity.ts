/**
 * ERC-8004 identity (required in every track).
 * We register explicitly from the RigBase wallet with a DIRECT, tagged tx,
 * pointing at agent/rigbase-payout.agent.json in this repo.
 */
import fs from "node:fs";
import path from "node:path";
import { buildErc8004RegisterCall, erc8004AgentCount, ALTANA_AGENT_TAG, CELO } from "@altananetwork/sdk";
import { createPublicClient, http, parseEventLogs, type Address, type Hex } from "viem";
import { celo } from "viem/chains";
import { CHAIN_ID, CONTRACTS, RPC_URL } from "./chain.js";
import { ROOT } from "./config.js";

export const AGENT_FILE = path.join(ROOT, "agent/rigbase-payout.agent.json");
export const AGENT_URI =
  process.env.AGENT_URI ?? "https://raw.githubusercontent.com/getrigbase/rigbase-payout/main/agent/rigbase-payout.agent.json";

export const pub = createPublicClient({ chain: celo, transport: http(RPC_URL) });

export function registerCall() {
  // Keep Altana's createdWith=altana metadata so Altana can count the agent.
  return buildErc8004RegisterCall(CHAIN_ID, AGENT_URI, [ALTANA_AGENT_TAG]) as { to: Address; data: Hex };
}

export async function existingAgents(owner: Address) {
  return erc8004AgentCount(CELO, owner);
}

const registeredEvent = [
  {
    type: "event",
    name: "Registered",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentURI", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: true },
    ],
  },
] as const;

export async function agentIdFromReceipt(hash: Hex) {
  const r = await pub.waitForTransactionReceipt({ hash });
  const logs = parseEventLogs({ abi: registeredEvent, logs: r.logs.filter((l) => l.address.toLowerCase() === CONTRACTS.erc8004Identity.toLowerCase()) });
  return { receipt: r, agentId: logs[0]?.args.agentId };
}

export function writeAgentId(agentId: bigint) {
  const f = JSON.parse(fs.readFileSync(AGENT_FILE, "utf8"));
  f.registrations = [{ agentId: Number(agentId), agentRegistry: `eip155:${CHAIN_ID}:${CONTRACTS.erc8004Identity}` }];
  fs.writeFileSync(AGENT_FILE, JSON.stringify(f, null, 2) + "\n");
}
