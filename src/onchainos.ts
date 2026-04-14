import crypto from "crypto";
import {
  OkxCredentials,
  OkxApiResponse,
  OkxQuoteData,
  OkxSwapData,
  OkxApproveData,
  SwapQuote,
  OKX_API_BASE,
  XLAYER_CHAIN_ID,
} from "./types";

function createSignature(
  timestamp: string,
  method: string,
  path: string,
  body: string,
  secretKey: string
): string {
  const preHash = timestamp + method.toUpperCase() + path + body;
  return crypto
    .createHmac("sha256", secretKey)
    .update(preHash)
    .digest("base64");
}

function buildHeaders(
  creds: OkxCredentials,
  method: string,
  path: string,
  body: string = ""
): Record<string, string> {
  const timestamp = new Date().toISOString();
  // OKX signature must include the /api/v5 prefix
  const signPath = "/api/v6" + path;
  const sign = createSignature(timestamp, method, signPath, body, creds.secretKey);
  return {
    "OK-ACCESS-KEY": creds.apiKey,
    "OK-ACCESS-SIGN": sign,
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": creds.passphrase,
    "Content-Type": "application/json",
  };
}

async function okxGet<T>(
  creds: OkxCredentials,
  path: string
): Promise<OkxApiResponse<T>> {
  const url = OKX_API_BASE + path;
  const headers = buildHeaders(creds, "GET", path);
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`OnchainOS API error: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<OkxApiResponse<T>>;
}

export async function getQuote(
  creds: OkxCredentials,
  fromToken: string,
  toToken: string,
  amount: string
): Promise<SwapQuote | null> {
  const params = new URLSearchParams({
    chainIndex: XLAYER_CHAIN_ID,
    fromTokenAddress: fromToken,
    toTokenAddress: toToken,
    amount,
    swapMode: "exactIn",
  });

  const path = `/dex/aggregator/quote?${params}`;

  try {
    const res = await okxGet<OkxQuoteData>(creds, path);
    if (res.code !== "0" || !res.data?.[0]) {
      console.error(`OnchainOS quote failed: ${res.code} ${res.msg}`);
      return null;
    }

    const data: any = res.data[0];
    const routePath: string[] = [];
    try {
      if (Array.isArray(data.dexRouterList)) {
        for (const r of data.dexRouterList) {
          if (Array.isArray(r.subRouterList)) {
            for (const sr of r.subRouterList) {
              if (Array.isArray(sr.dexProtocol)) {
                for (const d of sr.dexProtocol) {
                  routePath.push(`${d.dexName} (${d.percent}%)`);
                }
              }
            }
          }
        }
      }
    } catch { /* route path is optional */ }

    return {
      source: "onchainos",
      fromToken,
      toToken,
      fromAmount: amount,
      toAmount: data.toTokenAmount || data.toAmount || "0",
      toAmountReadable: data.toTokenAmount || data.toAmount || "0",
      estimatedGas: data.estimateGasFee || data.estimatedGas || "0",
      priceImpact: data.priceImpactPercentage || data.priceImpact || "0",
      routePath: routePath.length > 0 ? routePath : ["OnchainOS aggregated"],
    };
  } catch (err) {
    console.error("OnchainOS quote error:", err);
    return null;
  }
}

export async function getApproval(
  creds: OkxCredentials,
  tokenAddress: string,
  amount: string
): Promise<OkxApproveData | null> {
  const params = new URLSearchParams({
    chainIndex: XLAYER_CHAIN_ID,
    tokenContractAddress: tokenAddress,
    approveAmount: amount,
  });

  const path = `/dex/aggregator/approve-transaction?${params}`;

  try {
    const res = await okxGet<OkxApproveData>(creds, path);
    if (res.code !== "0" || !res.data?.[0]) {
      console.error(`OnchainOS approve failed: ${res.code} ${res.msg}`);
      return null;
    }
    return res.data[0];
  } catch (err) {
    console.error("OnchainOS approve error:", err);
    return null;
  }
}

export async function getSwapTx(
  creds: OkxCredentials,
  fromToken: string,
  toToken: string,
  amount: string,
  walletAddress: string,
  slippagePercent: number = 1
): Promise<OkxSwapData | null> {
  const params = new URLSearchParams({
    chainIndex: XLAYER_CHAIN_ID,
    fromTokenAddress: fromToken,
    toTokenAddress: toToken,
    amount,
    swapMode: "exactIn",
    slippagePercent: slippagePercent.toString(),
    userWalletAddress: walletAddress,
  });

  const path = `/dex/aggregator/swap?${params}`;

  try {
    const res = await okxGet<OkxSwapData>(creds, path);
    if (res.code !== "0" || !res.data?.[0]) {
      console.error(`OnchainOS swap failed: ${res.code} ${res.msg}`);
      return null;
    }
    return res.data[0];
  } catch (err) {
    console.error("OnchainOS swap error:", err);
    return null;
  }
}
