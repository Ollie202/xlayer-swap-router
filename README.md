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

Understood: Swap 50% of USDT for OKB (if price below $55)
Resolved amount: 500000000 (percentage of USDT balance)
Price condition met: current $50.1234
[proceeds with swap...]
```

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

## License

MIT
