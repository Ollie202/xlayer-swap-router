import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fromMinimalUnits, resolveSymbol } from "./types";

/**
 * A conditional swap the user wants to fire later. Stored on disk so the
 * `watch` daemon can pick it up in a separate process — the user can close
 * their terminal and the pending swap survives, ready to be executed when
 * the `watch` command runs and the condition is met.
 *
 * We deliberately do NOT store private keys — the user supplies the key via
 * `WALLET_PRIVATE_KEY` to `watch`, so a leaked pending.json reveals only
 * intent, not funds.
 */
export interface PendingSwap {
  id: string;                 // short human id
  createdAt: string;          // ISO timestamp
  nlInput: string;            // original NL command, for display
  fromToken: string;          // address
  toToken: string;            // address
  amountMinimal: string;      // pre-resolved, in minimal units
  walletAddress: string;      // wallet that will execute
  condition: {
    type: "price_below" | "price_above";
    tokenAddress: string;
    targetPrice: number;
  };
}

function storeDir(): string {
  return path.join(os.homedir(), ".xlayer-swap");
}

function storePath(): string {
  return path.join(storeDir(), "pending.json");
}

function ensureDir() {
  const d = storeDir();
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

export function loadPending(): PendingSwap[] {
  try {
    if (!fs.existsSync(storePath())) return [];
    const raw = fs.readFileSync(storePath(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePending(list: PendingSwap[]) {
  ensureDir();
  fs.writeFileSync(storePath(), JSON.stringify(list, null, 2), "utf8");
}

export function addPending(swap: PendingSwap) {
  const list = loadPending();
  list.push(swap);
  savePending(list);
}

export function removePending(id: string): boolean {
  const list = loadPending();
  const next = list.filter((s) => s.id !== id);
  if (next.length === list.length) return false;
  savePending(next);
  return true;
}

/**
 * Short random id — 6 hex chars is plenty for a single user's pending list.
 */
export function newId(): string {
  return Math.random().toString(16).slice(2, 8);
}

export function formatPending(list: PendingSwap[]): string {
  if (list.length === 0) {
    return "No pending conditional swaps. Create one with:\n  xlayer-swap \"swap 1 usd of USDT to OKB if OKB is below 50\"";
  }
  const lines: string[] = [];
  lines.push("=== Pending Conditional Swaps ===\n");
  list.forEach((s, idx) => {
    const n = idx + 1;
    const fromSym = resolveSymbol(s.fromToken);
    const toSym = resolveSymbol(s.toToken);
    const condSym = resolveSymbol(s.condition.tokenAddress);
    const dir = s.condition.type === "price_below" ? "below" : "above";
    const amt = fromMinimalUnits(s.amountMinimal, s.fromToken);
    lines.push(`  ${n}. ${amt} ${fromSym} -> ${toSym}`);
    lines.push(`       when ${condSym} ${dir} $${s.condition.targetPrice}`);
    lines.push(`       created ${s.createdAt}`);
    lines.push(`       "${s.nlInput}"`);
    lines.push("");
  });
  lines.push(`Run \`xlayer-swap watch\` to monitor prices and auto-execute when conditions are met.`);
  lines.push(`Cancel one:   xlayer-swap cancel 1       (number from the list above)`);
  lines.push(`Cancel all:   xlayer-swap cancel all`);
  return lines.join("\n");
}

/**
 * Resolve a user-supplied cancel target to a pending-swap id.
 * Accepts:
 *   - "1".."N"   — 1-based index into the list as shown by `pending`
 *   - "all"      — special sentinel, caller handles
 * Returns the id on success, null on not-found.
 */
export function resolveCancelTarget(target: string): string | null | "all" {
  const t = (target || "").trim().toLowerCase();
  if (t === "all") return "all";
  const list = loadPending();
  if (/^\d+$/.test(t)) {
    const idx = parseInt(t, 10) - 1;
    if (idx >= 0 && idx < list.length) return list[idx].id;
    return null;
  }
  return null;
}

export function removeAll(): number {
  const n = loadPending().length;
  savePending([]);
  return n;
}
