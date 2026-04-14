import { SwapQuote, XLAYER_CHAIN_ID } from "./types";

// Uniswap Trading API base
const UNISWAP_API_BASE = "https://trade-api.gateway.uniswap.org/v1";

function authHeaders(): Record<string, string> {
  const key = process.env.UNISWAP_API_KEY;
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (key) h["x-api-key"] = key;
  return h;
}

interface UniswapQuoteResponse {
  quote: {
    output: {
      amount: string;
      token: string;
    };
    input: {
      amount: string;
      token: string;
    };
    gasFeeEstimate: string;
    priceImpact: number;
    route: Array<{
      protocol: string;
      poolAddress: string;
      fee: string;
    }>;
  };
}

interface UniswapSwapResponse {
  swap: {
    to: string;
    from: string;
    value: string;
    data: string;
    gasLimit: string;
  };
  quote: UniswapQuoteResponse["quote"];
}

export async function getQuote(
  fromToken: string,
  toToken: string,
  amount: string,
  walletAddress: string
): Promise<SwapQuote | null> {
  try {
    const body = {
      type: "EXACT_INPUT",
      tokenInChainId: parseInt(XLAYER_CHAIN_ID),
      tokenOutChainId: parseInt(XLAYER_CHAIN_ID),
      tokenIn: fromToken,
      tokenOut: toToken,
      amount,
      swapper: walletAddress,
      slippageTolerance: 0.01,
    };

    const res = await fetch(`${UNISWAP_API_BASE}/quote`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      // Uniswap may not support X Layer — this is expected
      if (res.status === 404 || res.status === 400) {
        console.log("Uniswap: X Layer route not available for this pair");
        return null;
      }
      console.error(`Uniswap quote error: ${res.status} ${errText}`);
      return null;
    }

    const data: any = await res.json();
    const q = data.quote || data;

    // Defensive route path — Uniswap response shapes vary (v2/v3/v4/Universal)
    const routePath: string[] = [];
    try {
      const routes = q.route || q.routes || [];
      if (Array.isArray(routes)) {
        for (const r of routes) {
          const hops = Array.isArray(r) ? r : [r];
          for (const h of hops) {
            const label = h.protocol || h.type || "Uniswap";
            const pool = h.poolAddress || h.address || h.pool || "";
            const fee = h.fee ? ` ${(parseInt(h.fee) / 10000).toFixed(2)}%` : "";
            routePath.push(`Uniswap ${label}${fee}${pool ? ` (${String(pool).slice(0, 10)}...)` : ""}`);
          }
        }
      }
    } catch { /* route path is optional */ }

    const output = q.output || q.outputAmount || q.amountOut || {};
    const toAmount = output.amount || q.toAmount || q.quote || "0";

    return {
      source: "uniswap",
      fromToken,
      toToken,
      fromAmount: amount,
      toAmount: String(toAmount),
      toAmountReadable: String(toAmount),
      estimatedGas: q.gasFeeEstimate || q.gasUseEstimate || "0",
      priceImpact: String(q.priceImpact ?? q.priceImpactPercentage ?? 0),
      routePath: routePath.length > 0 ? routePath : ["Uniswap aggregated"],
    };
  } catch (err) {
    console.error("Uniswap quote error:", err);
    return null;
  }
}

export async function getSwapTx(
  fromToken: string,
  toToken: string,
  amount: string,
  walletAddress: string,
  slippageTolerance: number = 0.01
): Promise<UniswapSwapResponse | null> {
  try {
    const body = {
      type: "EXACT_INPUT",
      tokenInChainId: parseInt(XLAYER_CHAIN_ID),
      tokenOutChainId: parseInt(XLAYER_CHAIN_ID),
      tokenIn: fromToken,
      tokenOut: toToken,
      amount,
      swapper: walletAddress,
      slippageTolerance,
    };

    const res = await fetch(`${UNISWAP_API_BASE}/swap`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error(`Uniswap swap error: ${res.status} ${await res.text()}`);
      return null;
    }

    return (await res.json()) as UniswapSwapResponse;
  } catch (err) {
    console.error("Uniswap swap error:", err);
    return null;
  }
}
