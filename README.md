# xlayer-swap-router

**Type what you want. It swaps on X Layer.**

```
swap 5 usd of OKB to USDT
swap 10 usd of USDT to OKB if OKB is below 50
swap half my USDT for OKB
```

That's the whole interface. The router parses your sentence, pulls live quotes from **OKX OnchainOS** and **Uniswap** in parallel, picks whichever pays more, works out a sensible slippage, checks your wallet, and sends the transaction.

Built for the OKX Build X hackathon, Skill Arena track.

---

## Table of contents

1. [What it does](#what-it-does)
2. [Quick start (Windows)](#quick-start-windows) — 3 steps, you're trading in 5 minutes
3. [Where to get your API keys](#where-to-get-your-api-keys)
4. [All commands](#all-commands)
5. [Natural-language cheat sheet](#natural-language-cheat-sheet)
6. [Conditional swaps (auto-execute later)](#conditional-swaps-auto-execute-later)
7. [Safety features](#safety-features)
8. [Mac / Linux users — read this](#mac--linux-users-read-this)
9. [What's new](#whats-new)
10. [Using it from code](#using-it-from-code)
11. [Project layout](#project-layout)

---

## What it does

| Feature | What you get |
|---|---|
| **Natural-language parser** | Dozens of phrasings — slang, portions of balance, dollar values, conditionals |
| **Best-execution routing** | OKX OnchainOS + Uniswap quoted in parallel; the one that pays more wins |
| **Live prices from real quotes** | No stale feeds. Price = what the chain would actually pay you right now |
| **Smart per-swap slippage** | Calculated from live volatility and pool depth, not a fixed 1% |
| **Portfolio-aware** | Insufficient-balance check runs BEFORE the tx is built; no cryptic reverts |
| **Multi-hop search** | Checks A→X→B routes when direct A→B is worse |
| **Persistent conditional swaps** | "swap when OKB drops below $50" survives terminal restarts — see [Conditional swaps](#conditional-swaps-auto-execute-later) |
| **Cross-platform CLI** | One command, same syntax on Windows, macOS, and Linux |

---

## Quick start — first-time setup

Follow the steps in order. You'll be swapping tokens in about 5 minutes. If you've never used a command line before, **start with Step 0**.

Works on Windows, macOS, and Linux. Most steps are identical across platforms; the only difference is where your `.env` file lives (Step 4) — that's clearly split below.

---

### Step 0. Open a terminal (skip if you already have one open)

Everything in this guide is typed into a "terminal" (sometimes called a "command prompt" or "shell"). Here's how to open one:

- **Windows:** press the `Windows` key, type `cmd`, press Enter. A black window opens — that's Command Prompt.
- **macOS:** press `Cmd+Space`, type `terminal`, press Enter.
- **Linux:** press `Ctrl+Alt+T`, or search "Terminal" in your application launcher.

You'll type commands here for the rest of this guide. Copy each code block below, paste it in the terminal (right-click → paste on Windows; `Cmd+V` on macOS; `Ctrl+Shift+V` on Linux), then press Enter.

---

### Step 1. Check you have Node.js

First, check whether Node is already installed.

```
node --version
```

What this does: prints your Node version if it's installed.

- If it prints something like `v20.10.0`, skip to Step 2.
- If it says "not recognized" or "command not found," install Node from [nodejs.org](https://nodejs.org) (pick the **LTS** version), then close and reopen your terminal and run the command again to confirm.

---

### Step 2. Install xlayer-swap-router

Install the tool globally so you can use it from any folder.

```
npm install -g xlayer-swap-router
```

What this does: downloads and installs the package from npm. Puts three commands on your PATH — `swap`, `xswap`, and `xlayer-swap` — all usable from any folder. **Just use `swap`** — it's the shortest and reads like plain English (`swap 1 usd of OKB to USDT`). The other two exist for teams that already have a `swap` on their PATH.

Then verify the install worked:

```
swap --help
```

What you should see: the full help text. If you see "command not found," close and reopen your terminal so it picks up the new PATH.

---

### Step 3. Get your API keys

Before you can swap, you need four things. Open each link in a browser and keep the page handy — you'll paste these into a file in Step 4.

| What | Where |
|---|---|
| OKX OnchainOS — **API Key, Secret Key, Passphrase** | [web3.okx.com/onchainos/dev-portal](https://web3.okx.com/onchainos/dev-portal) — sign in, create a project, copy all three values |
| Uniswap Trading API key | [hub.uniswap.org](https://hub.uniswap.org) — create a free developer account, generate a Trading API key |
| A wallet private key | Export from MetaMask, Rabby, or OKX Wallet. **Use a dedicated hot wallet with a small balance, NOT your main one.** |
| Some OKB on X Layer | Bridge from Ethereum/OKX exchange via [okx.com/xlayer/bridge](https://www.okx.com/xlayer/bridge) |

Don't close these tabs — you'll need the values in the next step.

---

### Step 4. Create your `.env` file

This is where your keys go. The CLI loads it automatically every time you run a command.

Pick your operating system:

#### On Windows

Open Command Prompt and run:

```
mkdir %USERPROFILE%\.xlayer-swap
notepad %USERPROFILE%\.xlayer-swap\.env
```

What this does: creates a hidden `.xlayer-swap` folder inside `C:\Users\YourName\` and opens an empty `.env` file in Notepad. Windows may ask "create new file?" — click Yes.

#### On macOS

Open Terminal and run:

```
mkdir -p ~/.xlayer-swap
nano ~/.xlayer-swap/.env
```

What this does: creates a hidden `.xlayer-swap` folder in your home directory and opens an empty `.env` file in the `nano` text editor.

#### On Linux

Open your terminal and run:

```
mkdir -p ~/.xlayer-swap
nano ~/.xlayer-swap/.env
```

What this does: same as macOS — creates `~/.xlayer-swap/` and opens an empty `.env` file in `nano`.

#### Then — on all three OSes — paste this into the editor

Replace each `your_...` with the real value from Step 3:

```
OKX_API_KEY=your_okx_api_key
OKX_SECRET_KEY=your_okx_secret_key
OKX_PASSPHRASE=your_okx_passphrase
UNISWAP_API_KEY=your_uniswap_api_key
WALLET_PRIVATE_KEY=0xyour_wallet_private_key
```

What each line is:
- `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE` — the three values from your OKX OnchainOS project
- `UNISWAP_API_KEY` — your Uniswap Trading API key
- `WALLET_PRIVATE_KEY` — your wallet's private key (keep the `0x` prefix)

**Save and close:**
- Notepad (Windows): press `Ctrl+S`, then close the window.
- nano (macOS/Linux): press `Ctrl+O` then `Enter` to save, then `Ctrl+X` to exit.

That's it — the tool will auto-load this file from now on, from any folder.

---

### Step 5. Run your first swap

From any folder, in your terminal:

```
swap 1 usd of OKB to USDT
```

What this does: parses your sentence into a swap intent, looks up the live OKB price, converts `$1` into the equivalent OKB amount, quotes OKX OnchainOS and Uniswap in parallel, picks whichever gives more USDT, calculates a safe slippage, and sends the transaction.

What you'll see, in order:
1. `Understood: Swap $1 worth of OKB for USDT` — confirms the parse
2. `Resolved $1.00 at live price $84.03 -> 0.011898 OKB (Uniswap)` — price + amount
3. A side-by-side table comparing **OKX OnchainOS** vs **Uniswap** with a `** WINNER **` marker
4. `=== Smart Slippage Analysis ===` with a recommendation
5. `Swap tx sent: 0x...` — transaction hash
6. `Swap confirmed in block 57897854` — it's on-chain
7. `Successfully swapped 0.011898 OKB for 1.00 USDT via OKX OnchainOS!`

You just did a real swap on X Layer.

---

### Step 6. Try a few more

```
swap 1 usd of USDT to OKB
```

What this does: the reverse swap — `$1` of USDT → OKB.

```
swap 10% of my USDT to OKB
```

What this does: reads your on-chain USDT balance and swaps exactly 10% of it to OKB.

```
swap 1 usd of USDT to OKB if OKB is below 10
```

What this does: creates a conditional swap. Since OKB isn't below `$10` right now, the tool will ask whether to save it to your pending list. Answer `y` to save it.

```
swap pending
```

What this does: shows your numbered list of saved conditional swaps.

```
swap cancel 1
```

What this does: cancels the first swap on that list.

---

## Coming back later (after a restart)

The setup above is one-time. After you restart your PC, reopen your terminal, or come back the next day, you **do not** need to reinstall anything or reopen the `.env` file. Just open a terminal and go.

### Everyday usage — the only commands you'll actually type

```
swap 1 usd of OKB to USDT
swap 0.5 USDT to OKB
swap half my USDT to OKB
swap $5 of OKB to USDT if OKB above 100
swap pending
swap cancel 1
swap price OKB
swap portfolio 0xYourWalletAddress
```

### If something goes wrong after a restart

| Problem | Fix |
|---|---|
| `'swap' is not recognized` / `command not found` | Close and reopen your terminal. If that fails, rerun `npm install -g xlayer-swap-router`. |
| `Error: Set OKX_API_KEY, ...` | Your `.env` file isn't being found. Confirm it exists at the right path (Step 4) — on Windows: `%USERPROFILE%\.xlayer-swap\.env`. On mac/linux: `~/.xlayer-swap/.env`. |
| Want to change a key or add a new one | Just re-run the editor command from Step 4 (`notepad ...` or `nano ...`), make the edit, save, close. No reinstall needed. |
| Want to update to the latest version | `npm install -g xlayer-swap-router@latest` |

### Running `watch` in the background

If you saved a conditional swap and want it to actually execute when the condition hits, you need `watch` running somewhere. Pick the option that suits you:

**Windows** — open a second Command Prompt window, run `swap watch`, minimize it.

**macOS/Linux** — use `tmux` so it survives closing your terminal:

```
tmux new -s xswap -d 'swap watch'
```

To see what it's doing later: `tmux attach -t xswap`. Detach again with `Ctrl+B` then `D`.

---

## Alternative: install from source (for contributors)

If you want to modify the code or install from your own fork:

```
git clone https://github.com/Ollie202/xlayer-swap-router.git
cd xlayer-swap-router
npm install
npm run build
npm install -g .
```

What this does: clones the repo, installs dev dependencies, builds the TypeScript into `dist/`, then links the built package globally. Same end result as `npm install -g xlayer-swap-router`, but you have a local working copy you can edit.

---

## Where to get your API keys

| Key | Where to get it | Required? |
|---|---|---|
| `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE` | [web3.okx.com/onchainos/dev-portal](https://web3.okx.com/onchainos/dev-portal) — sign in, create a project, copy all three | **Yes** |
| `UNISWAP_API_KEY` | [hub.uniswap.org](https://hub.uniswap.org) — create a free developer account, generate a Trading API key | Recommended (needed if OKX is unreachable from your network) |
| `WALLET_PRIVATE_KEY` | Your wallet's private key — export from MetaMask / Rabby / OKX Wallet. **Use a dedicated hot wallet with small balances, not your main one.** | Only for the `swap`, `nl`, and `watch` commands (not for read-only `quote`/`analyze`/`price`/`portfolio`) |
| X Layer RPC | Built in. Uses [rpc.xlayer.tech](https://rpc.xlayer.tech). No config. | — |
| Need OKB? | Bridge to X Layer via [okx.com/xlayer/bridge](https://www.okx.com/xlayer/bridge) | — |

---

## All commands

Every command below works identically whether you type `swap`, `xswap`, or `xlayer-swap` — they're all aliases for the same binary. Examples here use the short `swap` form.

| Command | What it does |
|---|---|
| `swap <nl sentence>` | Parse and execute a natural-language swap. The headline feature. |
| `swap quote <from> <to> <amount> <wallet>` | Read-only. Compare OKX vs Uniswap quotes side-by-side. |
| `swap analyze <from> <to> <amount> <wallet>` | Read-only. Full analysis: market data, portfolio, smart slippage, multi-hop, AI advice. |
| `swap price <token>` | Live USD price for OKB / USDT / USDC / WETH (or any `0x...` address). |
| `swap portfolio <wallet>` | Wallet's X Layer token balances with USD values. |
| `swap pending` | List all saved conditional swaps, numbered 1, 2, 3... |
| `swap cancel <number\|all>` | Cancel the Nth saved swap, or wipe them all at once. |
| `swap watch` | Run a persistent monitor that auto-executes pending conditionals when their price condition is met. |
| `swap --help` | Full help text. |

**Read-only commands** (don't need `WALLET_PRIVATE_KEY`): `quote`, `analyze`, `price`, `portfolio`, `pending`, `cancel`.

**Execution commands** (need `WALLET_PRIVATE_KEY`): `swap`, `nl`, `watch`.

---

## Natural-language cheat sheet

The parser is case-insensitive and accepts many phrasings. Every example below works on **Windows, macOS, and Linux** with no quoting.

| Style | Examples |
|---|---|
| **Basic** | `swap 100 USDT for OKB` · `convert 10 USDT to USDC` · `sell 50 USDT for WETH` · `100 USDT to OKB` |
| **Slangy** | `flip 5 OKB to USDT` · `dump all my USDT into OKB` · `yeet 100 USDT into OKB` · `ape 10 USDT into OKB` · `turn 50 USDT into OKB` |
| **Portions of balance** | `swap half my USDT to OKB` · `swap all my WETH for USDT` · `25% of my OKB to USDT` · `a quarter of my USDT to OKB` · `two thirds of my OKB for USDT` · `my entire USDT balance to OKB` |
| **Dollar amounts (universal)** | `swap 5 usd of OKB to USDT` · `swap 10 dollars of USDT to OKB` · `swap 20 bucks of OKB to USDT` |
| **Dollar amounts (Windows only, unquoted)** | `swap $5 of OKB to USDT` · `swap $100 of USDT to OKB` |
| **Conditional** | `swap 100 USDT for OKB if price is below 50` · `swap 1 USDT to OKB if price above 55` · `swap 100 USDT for OKB once price drops to 40` · `swap 100 USDT to OKB when price is above 60` |
| **Buy-side** | `buy OKB with 100 USDT` · `purchase OKB using 50 USDT` |

Case doesn't matter: `Swap $1 Of Okb TO usdt` parses identically to `swap $1 of OKB to usdt`.

If it can't figure out what you meant, it tells you — it won't guess and send a transaction.

---

## Conditional swaps (auto-execute later)

When you write something like `swap 5 usd of USDT to OKB if OKB below 50`:

1. If the condition is **already met**, the swap fires immediately.
2. If **not met**, the tool shows the current price and asks:
   ```
   Condition not yet met.
     Current OKB price:  $84.0321 (OKX OnchainOS)
     Target:             < $50
     Swap waiting:       0.0595 USDT -> OKB

   Save to pending so it auto-executes when the condition is met? [Y/n]
   ```
   - **Yes** → saved to `~/.xlayer-swap/pending.json` **and a background watcher auto-starts** to monitor prices. Nothing else for you to do.
   - **No**  → cancelled on the spot. Nothing saved. No transaction sent.
3. The background watcher survives closing your terminal (it's fully detached). It polls prices every 30 seconds and fires the swap the moment your condition becomes true — whether that's in 5 minutes or 5 days.
4. You can list or cancel saved swaps any time using simple numbers.
5. Watcher logs go to `~/.xlayer-swap/watch.log` — peek at it any time to confirm it's alive.

### The commands

| Command | Purpose |
|---|---|
| `swap 5 usd of USDT to OKB if OKB below 50` | Creates a conditional swap. Prompts to save-or-cancel if the condition isn't met. |
| `swap pending` | Lists every saved swap, **numbered 1, 2, 3...** with full details. |
| `swap cancel 1` | Cancels the first swap. Just the number from the list — nothing to memorize. |
| `swap cancel all` | Wipes every pending swap at once. |
| `swap watch` | Persistent price monitor. Executes any saved swap the moment its condition becomes true. Requires `WALLET_PRIVATE_KEY`. |

### Example flow

```
> swap pending

=== Pending Conditional Swaps ===

  1. 0.0595 USDT -> OKB
       when OKB below $50
       created 2026-04-20T12:34:56.789Z
       "swap 5 usd of USDT to OKB if OKB below 50"

  2. 0.01 OKB -> USDT
       when OKB above $100
       created 2026-04-20T12:40:02.123Z
       "swap 0.01 OKB to USDT when price above 100"

Cancel one:   swap cancel 1       (number from the list above)
Cancel all:   swap cancel all

> swap cancel 2
Cancelled pending swap #2.
```

### Security note

`pending.json` never contains your private key. It only stores intent (from, to, amount, condition, wallet address). The `watch` command reads `WALLET_PRIVATE_KEY` from env at execution time — so a leaked pending file reveals *intent*, not funds.

### Legacy one-shot mode

Pass `--no-watch` to get the old behavior (abort immediately if the condition isn't met now, no prompt, no save):

```
swap "swap 5 usd of USDT to OKB if OKB below 50" --no-watch
```

---

## Safety features

| Guard | What happens |
|---|---|
| **Insufficient balance** | Checked from on-chain RPC *before* the aggregator call. Clean error, no cryptic revert. |
| **Same-token swap** | Rejected with a message. |
| **Unsupported tokens** (e.g. USDD, not on X Layer) | Rejected with a suggestion. |
| **Trade too large for wallet** | Warning shown before execution. |
| **Risk-token flags** | Pulled from OKX's balance API; surfaced as a warning. |
| **Falling knife / pump detection** | From 24h change + volatility; surfaced as advice. |
| **Approval routing** | Approval goes to the *winning* aggregator's router — not blindly one or the other. |
| **OKX unreachable?** | 4-second timeout + automatic Uniswap fallback. On-chain balance reads use RPC, so geoblocking doesn't break the tool. |

---

## Mac / Linux users — read this

Everything above works identically on macOS and Linux **except** for one shell-level gotcha: bash and zsh (the default shells on macOS and Linux) expand `$1`, `$5` etc. to empty positional parameters before your command sees them. PowerShell does the same thing — `$1` is a variable reference there too.

### Compatibility table

| Form | Windows cmd | PowerShell | macOS (zsh) | Linux (bash) |
|---|---|---|---|---|
| `swap $1 of OKB to USDT` | Works | Breaks | Breaks | Breaks |
| `swap "$1 of OKB to USDT"` (double quotes) | Works | Breaks | Breaks | Breaks |
| `swap '$1 of OKB to USDT'` (single quotes) | Works | Works | Works | Works |
| `swap 1 usd of OKB to USDT` | Works | Works | Works | Works |
| `swap 1 dollar of OKB to USDT` | Works | Works | Works | Works |
| `swap 1 bucks of OKB to USDT` | Works | Works | Works | Works |

### The two universal forms

If you want one syntax that works everywhere, pick either of these:

```
swap 1 usd of OKB to USDT                  # no quotes, no shell issues
swap '$1 of OKB to USDT'                   # single quotes, $-preserved
```

Double quotes do **not** fix the problem — bash, zsh, and PowerShell all still expand `$` inside double quotes. Only single quotes suppress it.

**Recommendation:** use the `1 usd` / `5 dollars` / `10 bucks` form as your default. It needs zero quoting and reads like plain English on every platform.

### Running `watch` in the background on Linux/macOS

```bash
# Quick: use nohup
nohup swap watch > ~/.xlayer-swap/watch.log 2>&1 &

# Nicer: use tmux or screen
tmux new -s xswap -d 'swap watch'
# reattach with: tmux attach -t xswap
```

### Running `watch` in the background on Windows

```
start /B swap watch > %USERPROFILE%\.xlayer-swap\watch.log 2>&1
```

Or open a second terminal window and let it run there.

---

## What's new

Recent changes that make the tool nicer to use:

| Change | Why it matters |
|---|---|
| **Cross-platform CLI bins** (`swap`, `xswap`, `xlayer-swap`) | One command, same syntax on Windows / macOS / Linux. Install once with `npm install -g .`. |
| **Auto-load `.env`** | No more `node -r dotenv/config` prefix. CLI reads `.env` from cwd automatically. |
| **Case-insensitive parser** | `Swap`, `SWAP`, and `swap` all work. Same for token symbols — `okb`, `Okb`, `OKB`. |
| **Bare-verb shorthand** | Type `swap 5 usd of OKB to USDT` directly — no need to wrap in `nl "..."`. |
| **Persistent conditional swaps** | `if OKB below $50` now saves to disk and executes when a `watch` process catches the condition. Private keys are never stored. |
| **`pending` / `cancel` / `watch` commands** | List, cancel, and monitor saved conditional swaps. |
| **Human-readable amounts everywhere** | `1.004234 USDT`, not `1004234`. Route comparison, multi-hop analysis, savings line, success message — all use proper decimals. |
| **Proper-cased source labels** | `OKX OnchainOS` and `Uniswap`, not the internal lowercase identifiers. |
| **Side-by-side route comparison table** | Both aggregators shown every time with a `** WINNER **` marker, even when one returned no route. |
| **"Successfully swapped X for Y" message** | After every swap: `Successfully swapped 0.011867 OKB for 1.00 USDT via OKX OnchainOS!` |
| **OKX geoblock resilience** | 4-second timeout + Uniswap fallback + RPC-based balance reads. Tool works even when OKX's endpoint is blocked by your ISP. |
| **Approval routing fix** | Approval now goes to the winning aggregator's router, not blindly OKX. |
| **Dollar-value without `$`** | `1 usd`, `5 dollars`, `10 bucks` all parse as dollar values. Universal across all shells. |
| **Auto-start background watcher** | Saving a pending swap auto-spawns a detached watcher. No separate `swap watch` command to remember. Duplicates are blocked via a PID file at `~/.xlayer-swap/watch.pid`. |
| **Gas reserve for native OKB** | `swap all my OKB to USDT` now reserves `0.002 OKB` for gas automatically — no more "insufficient funds for intrinsic transaction cost" failures. |
| **Watcher-status hint in `swap pending`** | The pending-list output now tells you whether the background watcher is currently running. |

---

## Using it from code

```typescript
import {
  quote,
  analyze,
  swapViaBestRoute,
  swapFromNaturalLanguage,
  watchPending,
  parseSwapIntent,
  pending,
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

// Let the parser handle everything
await swapFromNaturalLanguage(
  "swap half my USDT for OKB if price is below 50",
  privateKey, okxCreds
);

// Programmatic access to the pending store
const saved = pending.loadPending();
pending.removePending(saved[0].id);

// Run the persistent watcher
await watchPending(privateKey, okxCreds);
```

---

## Project layout

```
src/
  index.ts          CLI + public library API
  planner.ts        Natural-language parser
  market.ts         Live-price derivation, trading info, candlesticks
  router.ts         Parallel quote comparison (OKX vs Uniswap)
  multihop.ts       Multi-hop route discovery
  smartSlippage.ts  Per-swap slippage from volatility + pool depth
  portfolio.ts      Balances, risk assessment
  pending.ts        Persistent conditional-swap store
  onchainos.ts      OKX OnchainOS client (HMAC-SHA256 signed)
  uniswap.ts        Uniswap Trading API client
  wallet.ts         ethers signer, approval + broadcast
  types.ts          X Layer constants, decimals, helpers
```

The Uniswap side follows Uniswap's official [`swap-integration` AI skill](https://github.com/uniswap/uniswap-ai) — headers, endpoints, Universal Router version, and the `/check_approval` → `/quote` → `/swap` flow. The skill is pinned in [`skills-lock.json`](./skills-lock.json) so agents loading this repo get both skills together.

---

## License

MIT. Do whatever you want with it. If you build something cool on top, ping me.
