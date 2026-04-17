---
name: xlayer-swap-router
version: 2.0.0
description: "Type what you want and it swaps on X Layer. Parses natural language (dozens of phrasings — 'swap half my USDT for OKB if price is below 55', 'yeet $20 of OKB to USDT', 'a quarter of my OKB to USDC'), quotes OKX OnchainOS and Uniswap in parallel, derives live USD prices from real quotes, picks slippage from volatility and pool depth, checks the wallet before execution, and signs the transaction. The Uniswap side is wired through Uniswap's official swap-integration AI skill — the two skills compose. Use when an agent needs to swap tokens on X Layer without the user writing minimal-unit amounts or parsing aggregator APIs by hand."
---

# X Layer Swap Router

An AI skill for X Layer where the interface is plain english.

```
swap half my USDT for OKB if price is below 55
```

That sentence is parsed, the OKB price is derived from a live aggregator quote, the wallet is checked for sufficient USDT, OKX OnchainOS and Uniswap are quoted in parallel, slippage is computed from volatility and pool depth, the approval is ensured, the transaction is signed and broadcast. The user never touches a decimal calculator or a DEX URL.

## What it does differently

- **Forgiving NL parser.** Dozens of phrasings work. `swap`, `convert`, `sell`, `trade`, `flip`, `dump`, `yeet`, `ape`, `move`, `turn`, `switch`. Amounts as numbers, percentages, fractions (`half`, `a quarter`, `two thirds`), or USD values (`$5 worth of`). Conditions with `if/when/once/after` and `below/above/drops to/hits/at $X`.
- **Live prices from real quotes.** No published feed. The price of OKB is "what would 1 OKB swap for in USDC right now, after routing across OKX + Uniswap." That number is what the chain will actually pay you, so it can't be stale.
- **Best-execution routing.** OKX OnchainOS and Uniswap are quoted in parallel; whichever returns more output wins. Neither is hard-coded as primary.
- **Smart slippage.** Derived per-swap from the pool-liquidity ratio, 24h momentum, and hourly candle volatility. Not a fixed 1%.
- **Portfolio-aware.** Insufficient-balance is caught up front, before any transaction is built. Large-trade, concentrated-trade, and risk-token warnings come from the wallet state.
- **Multi-hop discovery.** A→B direct is compared against A→USDT→B, A→WOKB→B, A→USDC→B, A→WETH→B — the winner is the route that pays out more.

## Skill composition: this skill + Uniswap's

This skill runs alongside Uniswap's official `swap-integration` skill. They split the work:

| Skill | Owns |
|---|---|
| `xlayer-swap-router` (this one) | X Layer side, OKX OnchainOS, market data, portfolio, smart slippage, NL parsing, cross-protocol decision |
| [`uniswap/uniswap-ai/swap-integration`](https://github.com/uniswap/uniswap-ai) | Uniswap wire contract (headers, endpoints, Universal Router version, permit2, error codes) |

The Uniswap skill is pinned in `skills-lock.json`. An agent loading this repo's `.agents/skills/` directory gets both. Install them together:

```bash
npx skills add uniswap/uniswap-ai --skill swap-integration
npm install xlayer-swap-router
```

The runtime code in `src/uniswap.ts` implements the exact wire contract Uniswap's skill documents, so CLI and library users get the same behavior agents do — but the canonical spec for talking to Uniswap lives in Uniswap's skill, not here.

## Commands

```bash
# Natural language (the main interface)
xlayer-swap-router nl "swap 10 USDT for OKB"
xlayer-swap-router nl "swap half my USDT to OKB"
xlayer-swap-router nl "swap $5 worth of OKB to USDT"
xlayer-swap-router nl "swap 100 USDT for OKB if price is below 45"

# Read-only: compare OKX vs Uniswap side-by-side
xlayer-swap-router quote USDT OKB 1000000 0xYourWallet

# Read-only: full analysis (market + portfolio + slippage + advice)
xlayer-swap-router analyze USDT OKB 1000000 0xYourWallet

# Execute with smart auto-slippage
xlayer-swap-router swap USDT OKB 1000000

# Live USD price — derived from real aggregator quotes
xlayer-swap-router price OKB

# Wallet holdings on X Layer
xlayer-swap-router portfolio 0xYourWallet
```

## Natural language phrasings it accepts

| Style | Examples |
|---|---|
| Basic | `swap 100 USDT for OKB` · `convert 10 USDT to USDC` · `sell 50 USDT for WETH` · `100 USDT to OKB` |
| Slangy | `flip 5 OKB to USDT` · `dump all my USDT into OKB` · `yeet 100 USDT into OKB` · `ape 10 USDT into OKB` · `turn 50 USDT into OKB` |
| Portions | `swap half my USDT to OKB` · `swap all my WETH for USDT` · `25% of my OKB to USDT` · `a quarter of my USDT to OKB` · `two thirds of my OKB for USDT` · `my entire USDT balance to OKB` |
| Dollar amounts | `swap $5 worth of OKB to USDT` · `$20 of OKB to USDT` · `swap $100 of USDT to OKB` |
| Conditional | `swap 100 USDT for OKB if price is below 50` · `swap 1 USDT to OKB if price above $55` · `swap 100 USDT for OKB once price drops to 40` · `swap 100 USDT to OKB when price is above 60` |
| Buy-side | `buy OKB with 100 USDT` · `purchase OKB using 50 USDT` |

Same-token pairs, unknown tokens, and unresolvable amounts are rejected with a clear message — the skill won't fabricate an intent and execute it.

## Library use

```typescript
import { analyze, swapViaBestRoute, swapFromNaturalLanguage } from "xlayer-swap-router";

// Full analysis (read-only)
const { summary, comparison, slippage, riskWarnings } = await analyze(
  "USDT", "OKB", "1000000", walletAddress, okxCreds
);

// Execute at best route with smart auto-slippage
const result = await swapViaBestRoute("USDT", "OKB", "1000000", privateKey, okxCreds);

// Or pass the parser whatever english you've got
await swapFromNaturalLanguage(
  "swap half my USDT for OKB if price is below 50",
  privateKey, okxCreds
);
```

## Environment

```bash
OKX_API_KEY=...
OKX_SECRET_KEY=...
OKX_PASSPHRASE=...
UNISWAP_API_KEY=...          # optional; free key from hub.uniswap.org
WALLET_PRIVATE_KEY=0x...     # only needed for commands that sign
```

## OKX OnchainOS endpoints used

| Module | Endpoint | Purpose |
|---|---|---|
| DEX Aggregator | `/dex/aggregator/quote` | Best aggregated quote |
| DEX Aggregator | `/dex/aggregator/swap` | Build swap transaction |
| DEX Aggregator | `/dex/aggregator/approve-transaction` | ERC-20 approval calldata |
| DEX Aggregator | `/dex/aggregator/get-liquidity` | DEX source discovery |
| Market | `/dex/market/price-info` | Volume, liquidity, 24h change, market cap |
| Market | `/dex/market/candles` | Hourly candles for volatility |
| Balance | `/dex/balance/all-token-balances-by-address` | Wallet portfolio |

Live USD pricing doesn't call a price feed — it's derived from a live aggregator quote to USDC, quoted in parallel across OnchainOS and Uniswap.

## Supported tokens

Built-in symbols: `OKB`, `WOKB`, `USDT`, `USDC`, `WETH`. Any ERC-20 on X Layer can be used via its contract address.

## Security

- Private keys stay local. Only ethers.js sees them, only for signing.
- OKX credentials only go to OKX endpoints.
- Transactions are signed locally and broadcast through the X Layer RPC.
- Risk-token flags are surfaced as warnings from the OKX balance API.
