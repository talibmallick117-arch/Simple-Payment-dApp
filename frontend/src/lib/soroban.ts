import { TransactionBuilder } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import { signTransactionWithFreighter } from "./freighter";
import { config } from "./stellar";
import { Client as PaymentTrackerClient, networks } from "./contract-bindings/src";

export type PaymentStatus = "Pending" | "Sent" | "Failed" | "Refunded";

export type BatchPayment = {
  index: number;
  recipient: string;
  amount: string;
  status: PaymentStatus;
  note: string;
};

export type BatchSummary = {
  id: number;
  memo: string;
  sender: string;
  token: string;
  statsContract: string;
  totalAmount: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  refunded: boolean;
  funded: boolean;
  payments: BatchPayment[];
};

export type ContractActionResult = {
  success: boolean;
  message?: string;
  id?: number;
  refundAmount?: string;
};

const contractClient = new PaymentTrackerClient({
  contractId: config.paymentTrackerContractId,
  networkPassphrase: networks.testnet.networkPassphrase,
  rpcUrl: config.rpcUrl,
  publicKey: undefined,
  signTransaction: undefined
});

const rpcServer = new Server(config.rpcUrl, { allowHttp: false });

function parseContractError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const lower = text.toLowerCase();

  if (lower.includes("alreadyfunded")) return "This batch is already funded.";
  if (lower.includes("notfunded")) return "This batch must be funded before updating payments.";
  if (lower.includes("alreadyfinal")) return "This payment is already marked as sent or failed.";
  if (lower.includes("alreadyrefunded")) return "This batch has already been refunded.";
  if (lower.includes("invalidinput")) return "The recipient and amount lists must be valid and match.";
  if (lower.includes("missingbatch")) return "The requested batch could not be found.";
  if (lower.includes("missingrecipient")) return "The requested recipient payment could not be found.";
  if (lower.includes("unauthorized")) return "The connected wallet is not authorized to perform this action.";

  return text || "The contract returned an unexpected error.";
}

function toDisplayAmount(value: bigint | string | number | undefined): string {
  if (value === undefined || value === null) return "0";
  const normalized = typeof value === "bigint" ? value.toString() : String(value);
  return normalized;
}

function parseRpcResponseStatus(response: { status: string; errorResult?: unknown }, fallbackMessage: string): ContractActionResult {
  if (response.status === "ERROR") {
    return {
      success: false,
      message: parseContractError(response.errorResult ?? fallbackMessage)
    };
  }

  return {
    success: true,
    message: fallbackMessage
  };
}

function mapPaymentStatus(value: unknown): PaymentStatus {
  if (typeof value === "object" && value && "tag" in value) {
    const tag = String((value as { tag?: string }).tag ?? "");
    if (tag === "Sent") return "Sent";
    if (tag === "Failed") return "Failed";
    if (tag === "Refunded") return "Refunded";
  }
  return "Pending";
}

export function normalizeBatchFormValues(
  recipientsInput: string,
  amountsInput: string,
  fallbackRecipient: string,
  fallbackAmount: string
): { recipients: string[]; amounts: string[] } {
  const recipients = recipientsInput.split(",").map((item) => item.trim()).filter(Boolean);
  const amounts = amountsInput.split(",").map((item) => item.trim()).filter(Boolean);

  if (recipients.length > 0 && amounts.length > 0) {
    return {
      recipients,
      amounts
    };
  }

  return {
    recipients: recipients.length > 0 ? recipients : [fallbackRecipient],
    amounts: amounts.length > 0 ? amounts : [fallbackAmount]
  };
}

export async function loadBatchFromContract(batchId: number): Promise<BatchSummary | null> {
  if (!config.paymentTrackerContractId) return null;

  const batchTx = await contractClient.get_batch({ id: BigInt(batchId) as never }, { simulate: true });
  await batchTx.simulate();
  const batch = batchTx.result.unwrap();
  if (!batch) return null;

  const payments: BatchPayment[] = [];
  for (let index = 0; index < Number(batch.recipient_count ?? 0); index += 1) {
    const paymentTx = await contractClient.get_payment({ id: BigInt(batchId) as never, index: index as never }, { simulate: true });
    await paymentTx.simulate();
    const payment = paymentTx.result.unwrap();
    if (!payment) continue;
    payments.push({
      index,
      recipient: payment.recipient,
      amount: toDisplayAmount(payment.amount),
      status: mapPaymentStatus(payment.status),
      note: payment.note ?? ""
    });
  }

  return {
    id: Number(batch.id),
    memo: batch.memo ?? "",
    sender: batch.sender ?? "",
    token: batch.token ?? "",
    statsContract: batch.stats_contract ?? "",
    totalAmount: toDisplayAmount(batch.total_amount),
    recipientCount: Number(batch.recipient_count ?? 0),
    sentCount: Number(batch.sent_count ?? 0),
    failedCount: Number(batch.failed_count ?? 0),
    refunded: Boolean(batch.refunded),
    funded: Boolean(batch.funded),
    payments
  };
}

export async function createBatchOnContract(input: {
  sender: string;
  token: string;
  statsContract: string;
  memo: string;
  recipients: string[];
  amounts: string[];
  walletAddress: string;
  networkPassphrase: string;
}): Promise<ContractActionResult> {
  try {
    const normalizedRecipients = input.recipients.filter(Boolean);
    const normalizedAmounts = input.amounts.filter(Boolean);

    console.log("[soroban] createBatchOnContract start", {
      contractId: config.paymentTrackerContractId,
      sender: input.sender,
      recipients: normalizedRecipients,
      amounts: normalizedAmounts,
      memo: input.memo,
      walletAddress: input.walletAddress
    });

    console.log("[soroban] createBatchOnContract before building transaction", {
      normalizedRecipients,
      normalizedAmounts
    });

    const tx = await contractClient.create_batch({
      sender: input.sender,
      token: input.token,
      stats_contract: input.statsContract,
      memo: input.memo,
      recipients: normalizedRecipients,
      amounts: normalizedAmounts.map((amount) => BigInt(amount))
    }, { simulate: true });
    console.log("[soroban] createBatchOnContract transaction assembled", { hasBuilt: Boolean(tx.built) });

    console.log("[soroban] createBatchOnContract before simulation");
    const assembled = await tx.simulate();
    console.log("[soroban] createBatchOnContract simulation complete", {
      hasBuilt: Boolean(assembled.built),
      xdrLength: assembled.built?.toXDR().length ?? 0
    });

    console.log("[soroban] createBatchOnContract before signTransaction");
    const signed = await signTransactionWithFreighter(assembled.built?.toXDR() ?? "", {
      address: input.walletAddress,
      networkPassphrase: input.networkPassphrase || networks.testnet.networkPassphrase
    });
    console.log("[soroban] createBatchOnContract signTransactionWithFreighter response", signed);
    if (signed.error) return { success: false, message: parseContractError(signed.error) };
    const transaction = TransactionBuilder.fromXDR(signed.signedTxXdr, input.networkPassphrase || networks.testnet.networkPassphrase);
    const response = await rpcServer.sendTransaction(transaction as never);
    if (response.status === "ERROR") {
      return { success: false, message: parseContractError(response.errorResult ?? "The batch creation transaction failed.") };
    }
    return { success: true, message: "Batch created successfully.", id: Number(response.hash) || undefined };
  } catch (error) {
    return { success: false, message: parseContractError(error) };
  }
}

export async function fundBatchOnContract(input: { batchId: number; walletAddress: string; networkPassphrase: string }): Promise<ContractActionResult> {
  try {
    const tx = await contractClient.fund_batch({ id: BigInt(input.batchId) as never }, { simulate: true });
    const assembled = await tx.simulate();
    const signed = await signTransactionWithFreighter(assembled.built?.toXDR() ?? "", {
      address: input.walletAddress,
      networkPassphrase: input.networkPassphrase || networks.testnet.networkPassphrase
    });
    if (signed.error) return { success: false, message: parseContractError(signed.error) };
    const transaction = TransactionBuilder.fromXDR(signed.signedTxXdr, input.networkPassphrase || networks.testnet.networkPassphrase);
    const response = await rpcServer.sendTransaction(transaction as never);
    return parseRpcResponseStatus(response, "Batch funded successfully.");
  } catch (error) {
    return { success: false, message: parseContractError(error) };
  }
}

export async function markSentOnContract(input: { batchId: number; index: number; txRef: string; walletAddress: string; networkPassphrase: string }): Promise<ContractActionResult> {
  try {
    const tx = await contractClient.mark_sent({ id: BigInt(input.batchId) as never, index: input.index as never, tx_ref: input.txRef }, { simulate: true });
    const assembled = await tx.simulate();
    const signed = await signTransactionWithFreighter(assembled.built?.toXDR() ?? "", {
      address: input.walletAddress,
      networkPassphrase: input.networkPassphrase || networks.testnet.networkPassphrase
    });
    if (signed.error) return { success: false, message: parseContractError(signed.error) };
    const transaction = TransactionBuilder.fromXDR(signed.signedTxXdr, input.networkPassphrase || networks.testnet.networkPassphrase);
    const response = await rpcServer.sendTransaction(transaction as never);
    return parseRpcResponseStatus(response, "Payment marked as sent.");
  } catch (error) {
    return { success: false, message: parseContractError(error) };
  }
}

export async function markFailedOnContract(input: { batchId: number; index: number; reason: string; walletAddress: string; networkPassphrase: string }): Promise<ContractActionResult> {
  try {
    const tx = await contractClient.mark_failed({ id: BigInt(input.batchId) as never, index: input.index as never, reason: input.reason }, { simulate: true });
    const assembled = await tx.simulate();
    const signed = await signTransactionWithFreighter(assembled.built?.toXDR() ?? "", {
      address: input.walletAddress,
      networkPassphrase: input.networkPassphrase || networks.testnet.networkPassphrase
    });
    if (signed.error) return { success: false, message: parseContractError(signed.error) };
    const transaction = TransactionBuilder.fromXDR(signed.signedTxXdr, input.networkPassphrase || networks.testnet.networkPassphrase);
    const response = await rpcServer.sendTransaction(transaction as never);
    return parseRpcResponseStatus(response, "Payment marked as failed.");
  } catch (error) {
    return { success: false, message: parseContractError(error) };
  }
}

export async function refundPendingOnContract(input: { batchId: number; walletAddress: string; networkPassphrase: string }): Promise<ContractActionResult> {
  try {
    const tx = await contractClient.refund_pending({ id: BigInt(input.batchId) as never }, { simulate: true });
    const assembled = await tx.simulate();
    const signed = await signTransactionWithFreighter(assembled.built?.toXDR() ?? "", {
      address: input.walletAddress,
      networkPassphrase: input.networkPassphrase || networks.testnet.networkPassphrase
    });
    if (signed.error) return { success: false, message: parseContractError(signed.error) };
    const transaction = TransactionBuilder.fromXDR(signed.signedTxXdr, input.networkPassphrase || networks.testnet.networkPassphrase);
    const response = await rpcServer.sendTransaction(transaction as never);
    return parseRpcResponseStatus(response, "Refund processed successfully.");
  } catch (error) {
    return { success: false, message: parseContractError(error) };
  }
}
