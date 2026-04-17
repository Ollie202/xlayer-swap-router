# xlayer-swap-router

**Intelligent cross-protocol swap router for X Layer.** Not just a DEX wrapper — parses natural language, fetches market data, discovers multi-hop routes, calculates smart slippage, checks portfolio risk, and executes through the optimal path.

Built for the [OKX Build X AI Hackathon](https://web3.okx.com/xlayer/build-x-hackathon) — Skill Arena track.

## The 7 Layers of Intelligence

1. **Natural Language** — `"swap half my USDT for OKB"` → structured intent
2. **Market Data** — Live price, volume, liquidity, 24h change, candlestick volatility
3. **Dual-Source Routing** — OnchainOS DEX aggregator + Uniswap Trading API in parallel, picks whichever gives the user more output. Uniswap is integrated per their [official `swap-integration` AI skill](https://github.com/uniswap/uniswap-ai) (installed via `npx skills add uniswap/uniswap-ai --skill swap-integration`).
4. **Multi-Hop Discovery** — A→B vs A→USDT→B vs A→WOKB→B, pick the winner
5. **Smart Slippage** — Dynamic based on liquidity ratio, 24h momentum, hourly volatility
6. **Portfolio Awareness** — Balance checks, concentrated-trade warnings, risk token flags
7. **AI Advice** — "Falling knife" detection, pump warnings, stablecoin fast-path

## Example: Full Analysis

```bash
$ node dist/index.js analyze USDT OKB 1000000 0xWallet

========================================
  SWAP ANALYSIS: USDT -> OKB
========================================

=== Portfolio: 0x12345678...abcdef ===
  Total Value: $1,234.56

  Token          Balance              Value (USD)
  -------------------------------------------------------
  USDT           1000.0000            $1000.00
  OKB            0.5000               $25.00
  WETH           0.0500               $150.00

=== Market Analysis: OKB ===
  Price:           $50.123456
  24h Change:      +2.34%
  24h Volume:      $12.45M
  Liquidity:       $8.90M
  Market Cap:      $1.23B
  Volatility (24h): 1.82%
  Trend:           Mild uptrend

=== Swap Route Comparison ===
[ONCHAINOS] ** BEST **
  Output amount: 19876543210000000000
  Route:         Uniswap (60%) -> SushiSwap (40%)

[UNISWAP]
  Output amount: 19750000000000000000
  Route:         Uniswap v3 (pool: 0x123...)

=== Multi-Hop Route Analysis ===
[HOP 1] USDT -> WETH -> OKB
  Output: 20100000000000000000
  ** BETTER THAN DIRECT **

=== Smart Slippage Analysis ===
  Recommended: 0.85%
  Confidence:  high
  Reasoning:   Trade is 0.01% of pool liquidity. Low volatility. Moderate 24h momentum.

=== Risk Assessment ===
  - Portfolio check passed. Trade size is reasonable relative to holdings.

=== AI Advice ===
  - Market conditions look normal for this swap. Proceed when ready.
```

## Example: Natural Language

```bash
$ node dist/index.js nl "swap half my USDT for OKB if price is below 55"

Understood: Swap 50% of USDT for OKB (if OKB price below $55)
Resolved amount: 500000000 (percentage of USDT balance)
Price condition met: current $50.1234
[proceeds with swap...]
```

### All Supported Phrasings

The `nl` parser is forgiving — it understands dozens of ways to say the same thing:

| Category | Examples |
|---|---|
| **Basic** | `swap 100 USDT for OKB`, `convert 10 USDT to USDC`, `sell 50 USDT for WETH`, `100 USDT to OKB` |
| **Slangy** | `flip 5 OKB to USDT`, `dump all my USDT into OKB`, `yeet 100 USDT into OKB`, `ape 10 USDT into OKB`, `turn 50 USDT into OKB` |
| **Portions** | `swap half my USDT to OKB`, `swap all my WETH for USDT`, `25% of my OKB to USDT`, `a quarter of my USDT to OKB`, `two thirds of my OKB for USDT`, `my entire USDT balance to OKB` |
| **Dollar value** | `swap $5 worth of OKB to USDT`, `$20 of OKB to USDT`, `swap $100 of USDT to OKB` (resolved at live price) |
| **Conditional** | `swap 100 USDT for OKB if price is below 50`, `swap 1 USDT to OKB if price above $55`, `swap 100 USDT for OKB once price drops to 40`, `swap 100 USDT to OKB when price is above 60` |
| **Buy-side** | `buy OKB with 100 USDT`, `purchase OKB using 50 USDT` |

Unknown tokens, same-token pairs, and unresolvable amounts return structured warnings. **Insufficient balance is caught up front** — the router refuses to build a transaction it can't pay for, instead of getting a cryptic on-chain revert.

## Live Prices

```bash
$ node dist/index.js price OKB

=== Live Price: OKB ===
  Price:        $50.123456
  24h Change:   +2.34%
  24h Volume:   $12.45M
  Liquidity:    $8.90M
  Market Cap:   $1.23B
  Source:       OKX OnchainOS DEX market API
```

Price data comes from the OKX OnchainOS DEX market API, the same source OKX's own UIs use on X Layer. (Jupiter is Solana-only and not applicable for X Layer routing.)

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/xlayer-swap-router.git
cd xlayer-swap-router
npm install
cp .env.example .env
# Fill in your OnchainOS API keys and wallet private key
npm run build
node dist/index.js --help
```

## Commands

| Command | Description |
|---------|-------------|
| `quote <from> <to> <amt> <wallet>` | Compare OnchainOS vs Uniswap (read-only) |
| `analyze <from> <to> <amt> <wallet>` | Full multi-layer analysis (read-only) |
| `swap <from> <to> <amt>` | Execute with smart auto-slippage |
| `nl "<command>"` | Natural-language swap |
| `portfolio <wallet>` | Show X Layer holdings |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OKX_API_KEY` | Yes | From [Dev Portal](https://web3.okx.com/onchainos/dev-portal) |
| `OKX_SECRET_KEY` | Yes | OnchainOS secret |
| `OKX_PASSPHRASE` | Yes | OnchainOS passphrase |
| `WALLET_PRIVATE_KEY` | For swaps | Agentic Wallet key |
| `XLAYER_RPC_URL` | No | Default `https://rpc.xlayer.tech` |

## Library API

```typescript
import {
  quote,             // Fast route comparison
  analyze,           // Full multi-layer analysis
  swapViaBestRoute,  // Execute with smart slippage
  swapFromNaturalLanguage,  // NL-driven execution
  parseSwapIntent,   // Parse NL without executing
} from "xlayer-swap-router";

// Full analysis
const { summary, comparison, slippage, riskWarnings } = await analyze(
  "USDT", "OKB", "1000000", wallet, okxCreds
);
```

## Architecture

```
   "swap half USDT for OKB if price below 50"
                    |
             [planner.ts]
         Parse NL -> SwapIntent
                    |
     +--------------+--------------+
     |              |              |
[market.ts]  [portfolio.ts]  [router.ts]
Price/Vol    Balances/Risk   OnchainOS
Candles      Check           + Uniswap
Trends                       + Multi-hop
     |              |              |
     +--------------+--------------+
                    |
            [smartSlippage.ts]
            Dynamic slippage calc
                    |
              [wallet.ts]
            Approve -> Swap -> Confirm
                    |
                  txHash
```

## Project Structure

```
src/
  index.ts         — Main entry + CLI
  planner.ts       — NL parsing + AI advice generation
  market.ts        — OnchainOS Market API (prices, candles, liquidity)
  router.ts        — Parallel quote comparison
  multihop.ts      — Multi-hop route discovery
  smartSlippage.ts — Dynamic slippage calculation
  portfolio.ts     — Wallet balance + risk assessment
  onchainos.ts     — OnchainOS DEX aggregator client
  uniswap.ts       — Uniswap Trading API client
  wallet.ts        — Agentic Wallet signing
  types.ts         — Shared types and X Layer constants
```

## OnchainOS Modules Used

- **DEX Aggregator** — quote, swap, approve, liquidity sources
- **Market Data** — price, price-info, candlesticks
- **Balance** — all-token-balances-by-address
- **Agentic Wallet** — for signing and broadcasting

Plus **Uniswap Trading API** (integrated via Uniswap's official AI skill `uniswap/uniswap-ai/swap-integration`) for cross-protocol best-execution routing. Neither source is treated as primary — the router quotes both in parallel and hands the user the better output on every swap.

## Skill Composition: This Skill + Uniswap's AI Skill

This repo ships as an AI skill that is **designed to compose with Uniswap's official `swap-integration` skill**. The two are meant to run side-by-side:

| Skill | Owns |
|---|---|
| `xlayer-swap-router` (this repo) | X Layer / OnchainOS side, market data, portfolio, smart slippage, NL parsing, cross-protocol decision |
| [`uniswap/uniswap-ai/swap-integration`](https://github.com/uniswap/uniswap-ai) | Uniswap wire contract (headers, endpoints, Universal Router version, permit2, error codes) |

Install both into the same agent:

```bash
npx skills add uniswap/uniswap-ai --skill swap-integration
npm install xlayer-swap-router
```

The Uniswap skill is pinned in `skills-lock.json`. When an agent (Claude Code, OpenClaw, etc.) loads this repo's `.agents/skills/` directory it picks up the Uniswap skill automatically. The runtime code in `src/uniswap.ts` implements the exact wire contract from Uniswap's skill, so CLI/library users get the same behavior agents do — but the canonical spec lives in Uniswap's skill, not here.

## License

MIT
