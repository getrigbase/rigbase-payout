/** Offline checks for the tagging path. `npm test` */
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeFunctionData, erc20Abi } from "viem";
import { fromDataSuffix } from "@celo/attribution-tags";
import { ATTRIBUTION_CODE, assertCallsTagged, findTagsInInput, tagCalls, tagData } from "./attribution.js";

const to = "0x4BA98f11F6dA3d87A3E9840EB21253815206B838" as const;
const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, 1_000_000n] });

// 1. tail tag decodes with the official decoder, and tagging is idempotent
const t = tagData(data);
assert.deepEqual(fromDataSuffix(t)?.codes, [ATTRIBUTION_CODE]);
assert.equal(tagData(t), t);
assert.ok(t.startsWith(data));

// 2. every call is tagged, and untagged calls are refused
const calls = tagCalls([{ to, data }, { to, data: "0x" }]);
assertCallsTagged(calls);
assert.throws(() => assertCallsTagged([{ to, data }]));

// 3. tag is still found when the call is ABI-wrapped (as in a relayed intent)
const wrapped = encodeAbiParameters([{ type: "tuple[]", components: [{ type: "address" }, { type: "uint256" }, { type: "bytes" }] }], [[[to, 0n, t]]]);
assert.equal(fromDataSuffix(wrapped), null, "outer calldata does not end with the tag");
assert.ok(findTagsInInput(wrapped).some((x) => x.codes.includes(ATTRIBUTION_CODE)));

console.log("selftest: ok");
