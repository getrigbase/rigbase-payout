import { verifyTx } from "@celo/attribution-tags";
import type { Hex } from "viem";
import { ATTRIBUTION_CODE, findTagsInInput } from "./attribution.js";
import { pub } from "./identity.js";
import { txUrl } from "./chain.js";

/** Check a sent tx carries our code: at the tail (direct txs) or inside a relayed intent. */
export async function verifyHash(hash: Hex) {
  const tx = await pub.getTransaction({ hash });
  const tail = await verifyTx({ client: pub as never, hash }).catch(() => null);
  const inner = findTagsInInput(tx.input);
  const tailOk = !!tail?.codes?.includes(ATTRIBUTION_CODE);
  const innerOk = inner.some((t) => t.codes.includes(ATTRIBUTION_CODE));
  return {
    hash, celoscan: txUrl(hash), from: tx.from, to: tx.to,
    tailTag: tail, innerTags: inner.length,
    verdict: tailOk ? "tagged (tail, standard ERC-8021 / verifyTx)" : innerOk ? "tagged (inside relayed intent calldata; not at tail)" : "UNTAGGED",
  };
}
