# RigBase Payout: submission draft (Celo "Agents Open for Business")

## Project name
RigBase Payout

## Tagline (65 chars, limit 250)
Cross-border contractor payroll by an agent that can't overspend.

## Short description (~500 chars)
RigBase Payout is an AI payroll agent on Celo mainnet. It pays freelance contractors in their own local stablecoin (cNGN, IDRX or USD₮). Each payout is quoted and swapped through Textile FX, then paid from an Altana agent wallet whose session key the chain holds to a 15 USD₮ weekly cap, a contract allowlist and a 14-day expiry. Even a buggy or hijacked agent can't overspend: our 16 USD₮ over-cap test was refused on-chain. Every tx carries the celo_f41eab517821 tag.

## Long description

**Problem.** Small studios with contractors in Lagos or Jakarta pay them in one of two ways. They use bank wires, which are slow, cost $25+ in fees and give bad FX. Or they send USD stablecoins the contractor must off-ramp themselves. Automating this with an AI agent normally means handing the agent the treasury key, and one bug or prompt injection can then drain the wallet.

**How it works.**
1. The studio admin wallet is an EOA delegated to Altana's account via EIP-7702. Once, the admin grants the agent a **session key** limited to 15 USD₮ per week, an allowlist of contracts (USD₮ and the Textile reactor) and a 14-day expiry. The key is registered in Altana's Keystore.
2. The agent reads a payroll file (contractor, amount in USD₮, corridor). For each local-currency line it gets a **firm quote from Textile FX RFQ v2** (keyless, with a TakerControl EIP-712 proof). It then builds a single intent: approve, swap USD₮→cNGN/IDRX, transfer to the contractor.
3. The intent is signed with the session key and sent through the **Altana relay**. The wallet enforces the spend limit on-chain. If the agent tries to spend more, the relay's simulation of the on-chain policy rejects it, and nothing is broadcast.
4. Every transaction we build carries the **ERC-8021 attribution tag** `celo_f41eab517821`. Direct txs carry it at the tail; relayed calls carry it inside the intent. The agent has an **ERC-8004 identity** (agentId 10076), and `verifyTx` checks the tags.
5. A read-only **live dashboard** (GitHub Pages) reads Celo mainnet from your browser. It shows balances, the session's on-chain cap and spend (`spendInfos`), payout history with tag checks, contractors and the agent's identity.

**Results on mainnet.**
- 1.50 USD₮ → 2,161.60 cNGN to a Lagos contractor in one relayed intent.
- 1.00 USD₮ and 0.10 USD₮ USD₮-corridor payouts.
- A 16 USD₮ payout refused by the on-chain cap.
- Treasury top-up of 300 CELO → 17.12 USD₮ via Textile.

**Track 4: Altana Agent Wallets.**
- Uses `@altananetwork/sdk` 1.1.0 end to end: EIP-7702 delegation to `accountProxy`, `grantSession` with a per-token weekly spend limit, an allowlist and an expiry, session-signed intents through `relay.altana.network`, and live readout of `spendInfos(keyHash)` from the wallet.
- The core claim is that the agent never holds the treasury key. Its authority is bounded on-chain, and an over-cap payout is refused. This is demonstrated on mainnet.
- Lesson documented: the wallet's first tx must go through the relay, otherwise the 7702 auth nonce goes stale. We added a tagged self-delegation fix command.

**Track 1: Stablecoin Corridors (Textile FX).**
- Real USD₮→cNGN corridor payout on mainnet using Textile RFQ v2 firm quotes. The swap and the transfer to the contractor happen atomically in one intent.
- The USD₮→IDRX (Jakarta) corridor uses the same code path. It is not yet run on mainnet.
- Textile also funded the treasury: 300 CELO → USD₮.
- Before signing, the firm quote is checked: it must be bound to our wallet as taker and must not expire before broadcast. Otherwise the payout is skipped.

**Stack.** TypeScript/Node 20, viem, `@altananetwork/sdk`, `@celo/attribution-tags` (ERC-8021), Textile FX RFQ v2, ERC-8004 Identity Registry, and a static HTML/JS dashboard on GitHub Pages using JSON-RPC via forno.celo.org. Keys are loaded at runtime from files outside the repo, and a secret scan runs before every push.

## Links
- Repo: https://github.com/getrigbase/rigbase-payout
- Live app (read-only dashboard): https://getrigbase.github.io/rigbase-payout/
- Demo video (3:18): https://github.com/getrigbase/rigbase-payout/releases/download/v0.1.0/rigbase-payout-demo.mp4
- 1-minute cut: https://github.com/getrigbase/rigbase-payout/releases/download/v0.1.0/rigbase-payout-demo-1min.mp4
- Release: https://github.com/getrigbase/rigbase-payout/releases/tag/v0.1.0
- Logo: submission/logo/ (logo.svg, logo-512.png, logo-1024.png)
- Screenshots: submission/screenshots/ (01-dashboard, 02-architecture, 03-overcap-refused, 04-mainnet-txs)

## On-chain identifiers
- Agent wallet: 0x22d66bD658ad8b5269998545719941479ef4478d
- ERC-8004 agentId: 10076 (registry 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432)
- Attribution tag: celo_f41eab517821
- Network: Celo mainnet (42220)

## Mainnet transactions
| # | Step | Route | Tag | Tx |
|---|---|---|---|---|
| 1 | ERC-8004 register (agentId 10076) | direct | tail | https://celoscan.io/tx/0x16617527c18632ae4cb5f3d113d341f361338e4c5832cde29c9788c10670c7d1 |
| 2 | Approve CELO to Textile reactor | direct | tail | https://celoscan.io/tx/0xf970babb365423f9225503de7f491cd1accb94d4bf86de290f8ece8206871dc5 |
| 3 | Swap 300 CELO → 17.121009 USD₮ (Textile) | direct | tail | https://celoscan.io/tx/0x791a936fb2f06dfaba0e1a1f8fb58cccf62eea3ce5f1347a25b2d54aff47de64 |
| 4 | EIP-7702 delegation to Altana accountProxy | direct | tail | https://celoscan.io/tx/0x8ac312d5d46fa5b8ae4a6705488106e79f42a4c49719a39a7f6edeb1d310cd85 |
| 5 | Altana grantSession (15 USD₮/week, allowlist, 14 days) | relayed | untagged (SDK-built intent, no hook) | https://celoscan.io/tx/0x7116b2dd57ea77544fbdb691ae6c2f6e94ec169ea893ad592969928c4c9c92d2 |
| 6 | 0.10 USD₮ payout (relay tag test) | relayed | inside intent | https://celoscan.io/tx/0x51172c5868e446284a324d51633a79c92f3b0342d3bdea64ac39a442a1fca0be |
| 7 | 1.50 USD₮ → 2,161.60 cNGN to contractor-lagos | relayed | inside intent | https://celoscan.io/tx/0xdce0d203d8a7587170fa9ebb11a38bc261f64be18492c53629341a02a06cb86e |
| 8 | 1.00 USD₮ to contractor-remote-usd | relayed | inside intent | https://celoscan.io/tx/0xa159d88dfad7b2e1a977fd08a76b0e1fe5c91d70ebc70ac1f0e0436274387452 |
| – | 16 USD₮ over-cap payout | refused by on-chain limit, never broadcast | – | log: runs/live/ in repo |

## Form answers (drafts)

**Named user / customer.**
RigBase Studio is the first user. It uses RigBase Payout to pay its own demo/test contractors in Lagos (cNGN) and remote (USD₮), with Jakarta (IDRX) configured. This is a pilot: the contractor wallets are demo recipients controlled by RigBase. We don't claim external users or transaction volume. The next step is onboarding real contractors.

**Altana track details.**
The agent wallet is an Altana account (EIP-7702 delegation of the RigBase admin EOA to Altana's accountProxy, done on mainnet). The admin granted the agent a session key once, with a 15 USD₮ weekly spend limit, an allowlist (USD₮ and the Textile reactor) and a 14-day expiry. All payouts are session-signed intents through relay.altana.network, and the limits are enforced by the account on-chain. We demonstrate both sides on mainnet. Payouts within the cap succeed: txs 6–8, together 2.6 USD₮. A 16 USD₮ payout was refused ("This session key's spending limit does not cover this in USD₮"). The live dashboard reads the cap and spend directly from the wallet's spendInfos(keyHash).

**Stablecoin Corridors (Textile FX) track details.**
Payouts in local currency use Textile FX RFQ v2 firm quotes. The agent requests a USD₮→cNGN (or IDRX) quote, checks that the quote is bound to our wallet and still valid, and executes approve, swap and transfer to the contractor in one atomic relayed intent. Mainnet example: 1.50 USD₮ → 2,161.603422 cNGN delivered to contractor-lagos (tx 7). Textile was also used for the treasury top-up (300 CELO → 17.121009 USD₮, tx 3).

**Self Agent ID.**
Not registered. On mainnet, Self Agent ID needs a real human passport/ID NFC proof; mock documents only work on Celo Sepolia. RigBase is a company persona and we chose not to tie a personal identity document to it. The agent instead has an on-chain ERC-8004 identity (agentId 10076). Self Agent ID is listed as recommended, not required, for Tracks 4 and 1.

**Team / contact.**
RigBase, hello@getrigbase.com

**Tracks.** Track 4 (Altana Agent Wallets) and Track 1 (Stablecoin Corridors / Textile FX).
