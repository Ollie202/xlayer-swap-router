import { OkxCredentials, OKX_API_BASE, XLAYER_CHAIN_ID } from "./types";
import crypto from "crypto";

function createSignature(
  timestamp: string,
  method: string,
  path: string,
  body: string,
  secretKey: string
): string {
  const preHash = timestamp + method.toUpperCase() + path + body;
  return crypto.createHmac("sha256", secretKey).update(preHash).digest("base64");
}

function buildHeaders(
  creds: OkxCredentials,
  method: string,
  path: string
): Record<string, string> {
  const timestamp = new Date().toISOString();
  const signPath = "/api/v6" + path;
  const sign = createSignature(timestamp, method, signPath, "", creds.secretKey);
  return {
    "OK-ACCESS-KEY": creds.apiKey,
    "OK-ACCESS-SIGN": sign,
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": creds.passphrase,
    "Content-Type": "application/json",
  };
}

export interface TokenBalance {
  symbol: string;
  tokenAddress: string;
  balance: string;
  tokenPrice: string;
  valueUsd: number;
  isRiskToken: boolean;
}

export interface PortfolioSummary {
  address: string;
  totalValueUsd: number;
  tokens: TokenBalance[];
}

/**
 * Fetch all token balances for a wallet on X Layer.
 */
export async function getPortfolio(
  creds: OkxCredentials,
  walletAddress: string
): Promise<PortfolioSummary> {
  const params = new URLSearchParams({
    address: walletAddress,
    chains: XLAYER_CHAIN_ID,
    excludeRiskToken: "false",
  });
  const path = `/dex/balance/all-token-balances-by-address?${params}`;
  const url = OKX_API_BASE + path;
  const headers = buildHeaders(creds, "GET", path);

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.error(`Portfolio fetch error: ${res.status}`);
      return { address: walletAddress, totalValueUsd: 0, tokens: [] };
    }

    const data: any = await res.json();
    if (data.code !== "0" || !data.data?.[0]) {
      return { address: walletAddress, totalValueUsd: 0, tokens: [] };
    }

    const tokenAssets = data.data[0].tokenAssets || [];
    const tokens: TokenBalance[] = tokenAssets.map((t: any) => {
      const balance = parseFloat(t.balance || "0");
      const price = parseFloat(t.tokenPrice || "0");
      return {
        symbol: t.symbol || "UNKNOWN",
        tokenAddress: t.tokenContractAddress || "",
        balance: t.balance || "0",
        tokenPrice: t.tokenPrice || "0",
        valueUsd: balance * price,
        isRiskToken: t.isRiskToken === true,
      };
    });

    // Sort by USD value descending
    tokens.sort((a, b) => b.valueUsd - a.valueUsd);

    const totalValueUsd = tokens.reduce((sum, t) => sum + t.valueUsd, 0);

    return { address: walletAddress, totalValueUsd, tokens };
  } catch (err) {
    console.error("Portfolio fetch error:", err);
    return { address: walletAddress, totalValueUsd: 0, tokens: [] };
  }
}

/**
 * Check if a swap is safe relative to the wallet's portfolio.
 * Returns warnings if the swap is risky.
 */
export function assessSwapRisk(
  portfolio: PortfolioSummary,
  fromTokenAddress: string,
  tradeAmountUsd: number
): string[] {
  const warnings: string[] = [];

  // Find the source token in portfolio
  const sourceToken = portfolio.tokens.find(
    (t) => t.tokenAddress.toLowerCase() === fromTokenAddress.toLowerCase()
  );

  if (!sourceToken) {
    warnings.push(
      `WARNING: Token ${fromTokenAddress.slice(0, 10)}... not found in wallet. ` +
      `You may not have sufficient balance.`
    );
    return warnings;
  }

  // Check if trade exhausts most of a token holding
  if (sourceToken.valueUsd > 0 && tradeAmountUsd / sourceToken.valueUsd > 0.9) {
    warnings.push(
      `WARNING: This swap would use ${((tradeAmountUsd / sourceToken.valueUsd) * 100).toFixed(0)}% of your ${sourceToken.symbol} balance. ` +
      `You'll have very little ${sourceToken.symbol} remaining.`
    );
  }

  // Check if trade is a large portion of total portfolio
  if (portfolio.totalValueUsd > 0 && tradeAmountUsd / portfolio.totalValueUsd > 0.5) {
    warnings.push(
      `CAUTION: This swap represents ${((tradeAmountUsd / portfolio.totalValueUsd) * 100).toFixed(0)}% of your total portfolio value ($${portfolio.totalValueUsd.toFixed(2)}). ` +
      `This is a highly concentrated trade.`
    );
  }

  // Risk token warning
  if (sourceToken.isRiskToken) {
    warnings.push(
      `WARNING: ${sourceToken.symbol} is flagged as a risk token. Proceed with caution.`
    );
  }

  if (warnings.length === 0) {
    warnings.push(`Portfolio check passed. Trade size is reasonable relative to holdings.`);
  }

  return warnings;
}

/**
 * Format portfolio for display.
 */
export function formatPortfolio(portfolio: PortfolioSummary): string {
  const lines: string[] = [];
  lines.push(`=== Portfolio: ${portfolio.address.slice(0, 8)}...${portfolio.address.slice(-6)} ===\n`);
  lines.push(`  Total Value: $${portfolio.totalValueUsd.toFixed(2)}\n`);

  if (portfolio.tokens.length === 0) {
    lines.push("  No tokens found on X Layer.");
    return lines.join("\n");
  }

  lines.push("  Token          Balance              Value (USD)");
  lines.push("  " + "-".repeat(55));

  for (const t of portfolio.tokens.slice(0, 10)) {
    const symbol = t.symbol.padEnd(14);
    const balance = parseFloat(t.balance).toFixed(4).padStart(18);
    const value = `$${t.valueUsd.toFixed(2)}`.padStart(14);
    const risk = t.isRiskToken ? " [RISK]" : "";
    lines.push(`  ${symbol} ${balance} ${value}${risk}`);
  }

  if (portfolio.tokens.length > 10) {
    lines.push(`  ... and ${portfolio.tokens.length - 10} more tokens`);
  }

  return lines.join("\n");
}
