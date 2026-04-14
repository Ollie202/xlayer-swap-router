---
name: xlayer-swap-router
version: 2.0.0
description: "Intelligent cross-protocol swap router for X Layer. Parses natural language commands, fetches real-time market data, compares quotes from OnchainOS DEX aggregator and Uniswap Trading API, discovers multi-hop routes through intermediate tokens, calculates dynamic slippage from liquidity and volatility, and checks wallet portfolio before executing. Use when an agent needs to swap tokens intelligently on X Layer."
---

# X Layer Swap Router (v2)

An intelligent reusable skill that turns natural-language swap commands into optimal on-chain executions on X Layer. Not just an API wrapper — it analyzes markets, portfolio, routes, and risk before every swap.

## What Makes This Smart

1. **Natural Language Parsing** — `"swap half my USDT for OKB if price is below 50"` → structured intent with conditions
2. **Dual-Source Routing** — Parallel quotes from OnchainOS DEX aggregator and Uniswap Trading API
3. **Multi-Hop Discovery** — Tries A→B direct vs A→X→B through WOKB/USDT/USDC/WETH intermediaries
4. **Smart Slippage** — Dynamically calculated from liquidity ratio, 24h momentum, and hourly volatility (not a static 1%)
5. **Portfolio Awareness** — Checks wallet balances, warns on concentrated trades, flags risk tokens
6. **Market Intelligence** — Live price, 24h volume, liquidity, market cap, candlestick volatility, trend detection
7. **AI Advice** — Context-aware warnings: falling knife detection, overextended pumps, large-trade alerts

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

# Show wallet holdings on X Layer
node dist/index.js portfolio 0xWallet
```

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
