import { ethers } from "ethers";
import { XLAYER_RPC_URL, XLAYER_CHAIN_ID, OkxCredentials } from "./types";
import * as onchainos from "./onchainos";

const ERC20_APPROVE_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

export function createWallet(privateKey: string, rpcUrl?: string): ethers.Wallet {
  const provider = new ethers.JsonRpcProvider(rpcUrl || XLAYER_RPC_URL, {
    chainId: parseInt(XLAYER_CHAIN_ID),
    name: "xlayer",
  });
  return new ethers.Wallet(privateKey, provider);
}

/**
 * Checks if the DEX contract has sufficient allowance for the token,
 * and sends an approval transaction if needed.
 */
export async function ensureApproval(
  wallet: ethers.Wallet,
  tokenAddress: string,
  amount: string,
  okxCreds: OkxCredentials
): Promise<string | null> {
  // Native token (OKB) doesn't need approval
  if (tokenAddress.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") {
    return null;
  }

  const approvalData = await onchainos.getApproval(okxCreds, tokenAddress, amount);
  if (!approvalData) {
    throw new Error("Failed to get approval transaction data from OnchainOS");
  }

  // Check current allowance
  const tokenContract = new ethers.Contract(tokenAddress, ERC20_APPROVE_ABI, wallet);
  const currentAllowance: bigint = await tokenContract.allowance(
    wallet.address,
    approvalData.dexContractAddress
  );

  if (currentAllowance >= BigInt(amount)) {
    console.log("Sufficient allowance already exists, skipping approval");
    return null;
  }

  // Send approval transaction
  console.log(`Approving ${amount} of ${tokenAddress} for DEX contract...`);
  const tx = await wallet.sendTransaction({
    to: tokenAddress,
    data: approvalData.data,
    gasLimit: BigInt(approvalData.gasLimit),
  });

  console.log(`Approval tx sent: ${tx.hash}`);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Approval transaction failed: ${tx.hash}`);
  }

  console.log(`Approval confirmed in block ${receipt.blockNumber}`);
  return tx.hash;
}

/**
 * Signs and broadcasts a swap transaction.
 */
export async function executeSwap(
  wallet: ethers.Wallet,
  txData: { to: string; data: string; value: string; gasLimit?: string }
): Promise<{ txHash: string; blockNumber: number }> {
  console.log(`Executing swap via ${txData.to}...`);

  const tx = await wallet.sendTransaction({
    to: txData.to,
    data: txData.data,
    value: BigInt(txData.value || "0"),
    gasLimit: txData.gasLimit ? BigInt(txData.gasLimit) : undefined,
  });

  console.log(`Swap tx sent: ${tx.hash}`);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Swap transaction failed: ${tx.hash}`);
  }

  console.log(`Swap confirmed in block ${receipt.blockNumber}`);
  return { txHash: tx.hash, blockNumber: receipt.blockNumber };
}

/**
 * Returns the wallet's native OKB balance and address.
 */
export async function getWalletInfo(wallet: ethers.Wallet): Promise<{
  address: string;
  balanceOKB: string;
}> {
  const balance = await wallet.provider!.getBalance(wallet.address);
  return {
    address: wallet.address,
    balanceOKB: ethers.formatEther(balance),
  };
}
