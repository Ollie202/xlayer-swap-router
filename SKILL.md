---
name: xlayer-swap-router
version: 2.0.0
description: "Intelligent cross-protocol swap router for X Layer. Parses natural language commands, fetches real-time market data, routes in parallel through OnchainOS DEX aggregator and Uniswap's Trading API (via Uniswap's official swap-integration AI skill) to give the user best execution on every swap, discovers multi-hop routes through intermediate tokens, calculates dynamic slippage from liquidity and volatility, and checks wallet portfolio before executing. Use when an agent needs to swap tokens intelligently on X Layer."
---

# X Layer Swap Router (v2)

An intelligent reusable skill that turns natural-language swap commands into optimal on-chain executions on X Layer. Not just an API wrapper — it analyzes markets, portfolio, routes, and risk before every swap.

## What Makes This Smart

1. **Natural Language Parsing** — `"swap half my USDT for OKB if price is below 50"` → structured intent with conditions
2. **Best-Execution Routing Across OnchainOS + Uniswap** — Parallel quotes from OnchainOS DEX aggregator and Uniswap's Trading API; the user gets whichever returns more output on every swap. Uniswap is integrated via their official [swap-integration AI skill](https://github.com/uniswap/uniswap-ai) (installed with `npx skills add uniswap/uniswap-ai --skill swap-integration`) — all Trading API requests follow that skill's spec: `x-api-key` + `x-universal-router-version: 2.0` headers, 3-step `/check_approval` → `/quote` → `/swap` flow. Neither source is hard-coded as primary; which one wins depends on the pair and current liquidity.
3. **Multi-Hop Discovery** — Tries A→B direct vs A→X→B through WOKB/USDT/USDC/WETH intermediaries
4. **Smart Slippage** — Dynamically calculated from liquidity ratio, 24h momentum, and hourly volatility (not a static 1%)
5. **Portfolio Awareness** — Checks wallet balances, warns on concentrated trades, flags risk tokens
6. **Market Intelligence** — Live price, 24h volume, liquidity, market cap, candlestick volatility, trend detection
7. **AI Advice** — Context-aware warnings: falling knife detection, overextended pumps, large-trade alerts

## Skill Composition (Uniswap AI Skill Required)

This skill is designed to run **alongside** Uniswap's official `swap-integration` skill, not as a replacement for it. When an agent loads `xlayer-swap-router`, it should also load `uniswap/uniswap-ai/swap-integration` — the two compose:

- **This skill (`xlayer-swap-router`)** owns the X Layer side: OnchainOS aggregator calls, market data, portfolio checks, smart slippage, NL parsing, multi-hop routing, and the decision of which source wins on each swap.
- **Uniswap's `swap-integration` skill** owns the Uniswap side: authoritative contract for `/check_approval` → `/quote` → `/swap`, Universal Router version handling, chain-ID conventions, and permit2 semantics.

When an agent gets a "swap on X Layer" task, both skills activate: this skill drives the flow and asks the Uniswap skill for the Uniswap quote/tx; the Uniswap skill returns data shaped per its spec; this skill reconciles it against the OnchainOS quote and picks the winner.

Install both together:

```bash
npx skills add uniswap/uniswap-ai --skill swap-integration
npm install xlayer-swap-router
```

The dependency is pinned in this repo's `skills-lock.json` so agents that load this repo's `.agents/skills/` directory get the Uniswap skill automatically.

The runtime client in `src/uniswap.ts` implements the exact wire contract documented by the Uniswap skill (headers, endpoints, error codes), so a CLI/library user gets identical behavior — but the canonical source of truth for how to talk to Uniswap remains the Uniswap skill.

## Commands

```bash
# Compare routes between OnchainOS and Uniswap (read-only)
node dist/index.js quote USDT OKB 1000000 0xWallet

# Full analysis: market + portfolio + multi-hop + slippage + AI advice
node dist/index.js analyze USDT OKB 1000000 0xWallet

# Execute via best route with auto-calculated smart slippage
node dist/index.js swap USDT OKB 1000000

# Natural language execution
node dist/index.js nl "swap half my USDT for OKB"
node dist/index.js nl "swap 100 USDT to OKB if price is below 50"

# Live price (24h change, volume, liquidity, market cap)
node dist/index.js price OKB

# Show wallet holdings on X Layer
node dist/index.js portfolio 0xWallet
```

## Supported Natural Language Phrasings

The `nl` command accepts a forgiving range of English. Examples (all parse to the same intent):

**Basic:**
- `swap 100 USDT for OKB` / `swap 0.5 OKB to USDT`
- `convert 10 USDT to USDC` / `sell 50 USDT for WETH`
- `trade 5 OKB for USDT` / `exchange 20 USDC to USDT`
- `100 USDT to OKB` (verb optional)

**Slangy / crypto-native:**
- `flip 5 OKB to USDT` / `dump all my USDT into OKB`
- `yeet 100 USDT into OKB` / `ape 10 USDT into OKB`
- `move 20 USDT to OKB` / `turn 50 USDT into OKB`
- `change 100 USDT to USDC` / `switch 10 USDT for OKB`

**Portions of balance:**
- `swap half my USDT to OKB`
- `swap all my WETH for USDT` / `swap my entire USDT balance to OKB`
- `convert 25% of my OKB to USDT` / `swap 10% of my USDT for OKB`
- `a quarter of my USDT to OKB` / `a tenth of my OKB for USDT`
- `two thirds of my OKB for USDT`

**Dollar-value (resolved at live price):**
- `swap $5 worth of OKB to USDT`
- `swap $100 of USDT to OKB`
- `$20 of OKB to USDT`

**Conditional (only fires when condition holds):**
- `swap 100 USDT for OKB if price is below 50`
- `swap 100 USDT to OKB when price is above 60`
- `swap 50 USDT to OKB if OKB is below $45`
- `swap 1 USDT to OKB if price above $55`
- `swap 100 USDT for OKB once price drops to 40`

**Buy-side:**
- `buy OKB with 100 USDT` / `purchase OKB using 50 USDT`

Unknown tokens, same-token pairs, or unresolvable amounts return a structured warning instead of a crash. Insufficient balance is detected up front before any transaction is built.

## Library Usage

```typescript
import { analyze, swapViaBestRoute, swapFromNaturalLanguage } from "xlayer-swap-router";

// Full market + route analysis
const { summary, comparison, slippage, riskWarnings } = await analyze(
  "USDT", "OKB", "1000000", walletAddress, okxCreds
);
console.log(summary);

// Execute via best route with smart auto-slippage
const result = await swapViaBestRoute("USDT", "OKB", "1000000", privateKey, okxCreds);

// Natural language
await swapFromNaturalLanguage(
  "swap half my USDT for OKB if price is below 50",
  privateKey, okxCreds
);
```

## Prerequisites

```bash
export OKX_API_KEY="your-key"
export OKX_SECRET_KEY="your-secret"
export OKX_PASSPHRASE="your-passphrase"
export WALLET_PRIVATE_KEY="0x..."  # For swap commands
```

## OnchainOS Integration (Deep)

Uses **5 OnchainOS API modules** for intelligent routing:

| Module | Endpoint | Purpose |
|---|---|---|
| DEX Aggregator | `/dex/aggregator/quote` | Get best aggregated quote |
| DEX Aggregator | `/dex/aggregator/swap` | Build swap transaction |
| DEX Aggregator | `/dex/aggregator/approve-transaction` | Generate ERC-20 approval |
| DEX Aggregator | `/dex/aggregator/get-liquidity` | Discover DEX sources |
| Market | `/dex/market/price-info` | Live price, volume, liquidity, market cap |
| Market | `/dex/market/candles` | Hourly candlesticks for volatility analysis |
| Market | `/dex/market/price` | Current price for condition checks |
| Balance | `/dex/balance/all-token-balances-by-address` | Wallet portfolio |

## Uniswap Integration

- **Trading API** `/v1/quote` and `/v1/swap` — Uniswap-native routing on X Layer
- Graceful fallback when Uniswap doesn't support a pair

## Supported Tokens

Built-in symbols: `OKB`, `WOKB`, `USDT`, `USDC`, `WETH` (any ERC-20 contract address also works).

## Security

- Private keys stay local — only used by ethers.js for transaction signing
- API credentials only sent to OKX endpoints
- All transactions signed locally before broadcast
- Risk token flagging from OnchainOS balance API
