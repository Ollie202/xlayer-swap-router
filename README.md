# xlayer-swap-router

A swap tool for X Layer where you just type what you want.

```
$ xlayer-swap-router nl "swap half my USDT for OKB if price is below 55"
```

That's the whole interface. It figures out what you meant, checks the price, works out a sensible slippage, looks at your wallet, picks the better of OKX's aggregator vs Uniswap, and sends the transaction.

Built for the OKX Build X hackathon, Skill Arena track.

## What's in the box

- A natural-language parser that accepts dozens of phrasings (not just one rigid format)
- Quotes pulled in parallel from **OKX OnchainOS** and **Uniswap**; whichever pays more, wins
- Live prices derived from actual aggregator quotes — not a stale feed
- Slippage picked per-swap from live volatility and pool depth, not a fixed 1%
- Portfolio-aware: up-front "insufficient balance" check, warnings on trades that are a big chunk of your wallet, risk-token flags
- Multi-hop search when direct A→B is worse than A→USDT→B
- Uniswap side wired through Uniswap's official [`swap-integration` AI skill](https://github.com/uniswap/uniswap-ai) — the two skills are designed to compose

## Install

```bash
npm install xlayer-swap-router
```

Or clone + build:

```bash
git clone https://github.com/Ollie202/xlayer-swap-router.git
cd xlayer-swap-router
npm install
npm run build
```

You need an OKX OnchainOS API key, secret, and passphrase from the [OKX DEX Dev Portal](https://web3.okx.com/onchainos/dev-portal). Drop them in `.env`:

```env
OKX_API_KEY=...
OKX_SECRET_KEY=...
OKX_PASSPHRASE=...
UNISWAP_API_KEY=...          # optional; get one at hub.uniswap.org
WALLET_PRIVATE_KEY=0x...     # only needed if you want to actually swap
```

## Commands

```bash
# Talk to it in english
xlayer-swap-router nl "swap 10 USDT for OKB"

# Read-only: compare OKX vs Uniswap quotes side-by-side
xlayer-swap-router quote USDT OKB 1000000 0xYourWallet

# Read-only: full thinking (market + portfolio + slippage + advice)
xlayer-swap-router analyze USDT OKB 1000000 0xYourWallet

# Execute a swap with smart auto-slippage
xlayer-swap-router swap USDT OKB 1000000

# Live USD price for any token (derived from real quotes, not a feed)
xlayer-swap-router price OKB

# Wallet holdings on X Layer
xlayer-swap-router portfolio 0xYourWallet
```

All amounts are in the token's minimal units when using direct commands (`1000000` USDT = 1 USDT, since USDT has 6 decimals). The `nl` command handles decimals for you — `"swap 0.5 OKB for USDT"` just works.

## Natural language: what you can actually type

| Style | Examples |
|---|---|
| **Basic** | `swap 100 USDT for OKB` · `convert 10 USDT to USDC` · `sell 50 USDT for WETH` · `100 USDT to OKB` |
| **Slangy** | `flip 5 OKB to USDT` · `dump all my USDT into OKB` · `yeet 100 USDT into OKB` · `ape 10 USDT into OKB` · `turn 50 USDT into OKB` |
| **Portions of balance** | `swap half my USDT to OKB` · `swap all my WETH for USDT` · `25% of my OKB to USDT` · `a quarter of my USDT to OKB` · `two thirds of my OKB for USDT` · `my entire USDT balance to OKB` |
| **Dollar amounts** | `swap $5 worth of OKB to USDT` · `$20 of OKB to USDT` · `swap $100 of USDT to OKB` (resolved at live price) |
| **Conditional** | `swap 100 USDT for OKB if price is below 50` · `swap 1 USDT to OKB if price above $55` · `swap 100 USDT for OKB once price drops to 40` · `swap 100 USDT to OKB when price is above 60` |
| **Buy-side** | `buy OKB with 100 USDT` · `purchase OKB using 50 USDT` |

If it can't figure out what you meant, it says so — it won't make something up and send a transaction.

## Why the prices are accurate

Instead of trusting a published price feed, every price is derived from a real swap quote: "if I sent 1 OKB into the aggregator right now, how much USDC would I get back?" That number is what the chain will actually pay you, so there's nothing to go stale.

Both OKX OnchainOS and Uniswap are quoted in parallel; whichever returns more USDC wins, and that's the price you see.

## How routing works

Every swap gets two quotes in parallel — OKX OnchainOS aggregator and Uniswap's Trading API. The router hands you whichever returns more output. Neither is hard-coded as primary. On any given pair, either one can win; the router picks per-swap.

The Uniswap side isn't wired by hand. It follows the contract documented in Uniswap's official [`swap-integration` skill](https://github.com/uniswap/uniswap-ai) — headers, endpoints, Universal Router version, the `/check_approval` → `/quote` → `/swap` flow. The skill is pinned in [`skills-lock.json`](./skills-lock.json) so agents that load this repo get both skills together.

To install both into the same agent:

```bash
npx skills add uniswap/uniswap-ai --skill swap-integration
npm install xlayer-swap-router
```

## Safety rails

- **Insufficient balance**: checked before the swap is built. No cryptic on-chain reverts.
- **Same-token pairs**: refused with a message.
- **Unsupported tokens** (e.g. USDD, which isn't on X Layer): refused with a suggestion to use USDT/USDC.
- **Trade too large for your wallet**: you get a warning before execution.
- **Risk-token flags**: pulled from OKX's balance API; surfaced as a warning.
- **Falling knife / overextended pump**: detected from 24h change, surfaced as advice.

## Using it from code

```typescript
import {
  quote,
  analyze,
  swapViaBestRoute,
  swapFromNaturalLanguage,
  parseSwapIntent,
} from "xlayer-swap-router";

// Just the routing comparison
const { summary, comparison } = await quote(
  "USDT", "OKB", "1000000", walletAddr, okxCreds
);

// The full analysis (market + portfolio + slippage + advice)
const analysis = await analyze(
  "USDT", "OKB", "1000000", walletAddr, okxCreds
);

// Execute at best route with smart slippage
const result = await swapViaBestRoute(
  "USDT", "OKB", "1000000", privateKey, okxCreds
);

// Or let the parser handle everything
await swapFromNaturalLanguage(
  "swap half my USDT for OKB if price is below 50",
  privateKey, okxCreds
);
```

## Layout

```
src/
  index.ts          — CLI + public library API
  planner.ts        — Natural-language parser
  market.ts         — Live-price derivation, trading info, candlesticks
  router.ts         — Parallel quote comparison
  multihop.ts       — Multi-hop route discovery
  smartSlippage.ts  — Per-swap slippage from volatility + pool depth
  portfolio.ts      — Balances, risk assessment
  onchainos.ts      — OKX OnchainOS client
  uniswap.ts        — Uniswap Trading API client (per their swap-integration skill)
  wallet.ts         — ethers signer + broadcast
  types.ts          — X Layer constants, decimals, SwapIntent
```

## License

MIT. Do whatever you want with it. If you build something cool on top, ping me.
