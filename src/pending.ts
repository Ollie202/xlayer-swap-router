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
  const n = list.length;
  const range = n === 1 ? "1" : `1-${n}`;
  const exampleMid = n >= 2 ? Math.ceil(n / 2) : 1;
  const watcherRunning = getRunningWatchPid() !== null;
  if (watcherRunning) {
    lines.push(`Background watcher: running — swaps will auto-execute when conditions are met.`);
  } else {
    lines.push(`Background watcher: not running. Run \`swap watch\` to start monitoring.`);
  }
  lines.push(`Cancel one:   swap cancel <number>     (any number from ${range}, e.g. \`swap cancel ${exampleMid}\`)`);
  lines.push(`Cancel all:   swap cancel all`);
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

function pidPath(): string {
  return path.join(storeDir(), "watch.pid");
}

/**
 * Returns the PID of a running watcher, or null if none is alive.
 * Uses process.kill(pid, 0) which doesn't actually signal — it just
 * probes whether the pid exists and we have permission to signal it.
 */
export function getRunningWatchPid(): number | null {
  try {
    if (!fs.existsSync(pidPath())) return null;
    const raw = fs.readFileSync(pidPath(), "utf8").trim();
    const pid = parseInt(raw, 10);
    if (!pid || Number.isNaN(pid)) return null;
    try {
      process.kill(pid, 0); // probe only
      return pid;
    } catch {
      // Stale pid file — clean it up.
      try { fs.unlinkSync(pidPath()); } catch {}
      return null;
    }
  } catch {
    return null;
  }
}

export function writeWatchPid(pid: number): void {
  ensureDir();
  fs.writeFileSync(pidPath(), String(pid), "utf8");
}

export function clearWatchPid(): void {
  try { fs.unlinkSync(pidPath()); } catch {}
}
