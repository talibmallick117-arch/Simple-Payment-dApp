import { Account, StrKey } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import type { AssembledTransaction, SignTransaction } from "@stellar/stellar-sdk/contract";
import { signTransactionWithFreighter } from "./freighter";
import { config, isValidContractId, normalizeContractId } from "./stellar";
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

export type CreateBatchStage = "building" | "simulating" | "waiting_signature" | "submitting" | "polling";

export type CreateBatchValidationInput = {
  sender: string;
  token: string;
  statsContract: string;
  recipients: string[];
  amounts: string[];
};

export type CreateBatchValidationResult =
  | {
      success: true;
      sender: string;
      token: string;
      statsContract: string;
      recipients: string[];
      amounts: bigint[];
    }
  | {
      success: false;
      message: string;
    };

const rpcServer = new Server(config.rpcUrl, { allowHttp: false });
const isDev = import.meta.env.DEV;

type SignAndSendableTransaction<T> = Pick<AssembledTransaction<T>, "result" | "simulation" | "signAndSend"> & {
  sendTransactionResponse?: { hash?: string };
  getTransactionResponse?: { txHash?: string };
};

function devLog(message: string, details?: Record<string, unknown>) {
  if (!isDev) return;
  if (details) {
    console.debug(message, details);
    return;
  }
  console.debug(message);
}

function createTrackerClient(publicKey: string) {
  return new PaymentTrackerClient({
    contractId: config.paymentTrackerContractId,
    networkPassphrase: networks.testnet.networkPassphrase,
    rpcUrl: config.rpcUrl,
    publicKey,
    signTransaction: undefined
  });
}

export async function loadFreshSourceAccount(publicKey: string): Promise<Account> {
  const account = await rpcServer.getAccount(publicKey);
  devLog("[soroban] loaded source account", {
    publicKey,
    sequence: (account as { sequence?: string }).sequence ?? "unknown"
  });
  return account;
}

export function parseContractError(error: unknown): string {
  const txResult = extractTransactionResult(error);
  if (txResult === "txMalformed") {
    return "The transaction is malformed. Please rebuild and try again.";
  }
  if (txResult === "txBadSeq") {
    return "Transaction sequence conflict. Please retry with a fresh transaction.";
  }

  if (error && typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim()) {
      return maybeMessage;
    }

    const maybeError = (error as { error?: unknown }).error;
    if (typeof maybeError === "string" && maybeError.trim()) {
      return maybeError;
    }

    const maybeDetails = (error as { details?: unknown }).details;
    if (typeof maybeDetails === "string" && maybeDetails.trim()) {
      return maybeDetails;
    }

    if (isDev) {
      devLog("[soroban] raw transaction error", {
        error
      });
    }
  }

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
  if (lower.includes("txmalformed")) return "The transaction is malformed. Please rebuild and try again.";
  if (lower.includes("txbadseq") || lower.includes("badseq") || lower.includes("\"value\":-5")) {
    return "Transaction sequence conflict. Please retry with a fresh transaction.";
  }

  return text || "The contract returned an unexpected error.";
}

function extractTransactionResult(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;

  const visited = new Set<unknown>();
  const queue: unknown[] = [value];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || visited.has(current)) {
      continue;
    }
    visited.add(current);

    const record = current as Record<string, unknown>;
    const switchCandidate = record._switch;
    if (switchCandidate && typeof switchCandidate === "object") {
      const candidate = switchCandidate as { name?: unknown; value?: unknown };
      if (typeof candidate.name === "string" && candidate.name) {
        return candidate.name;
      }
      if (candidate.value === 16) {
        return "txMalformed";
      }
      if (candidate.value === -5) {
        return "txBadSeq";
      }
    }

    const attributes = record._attributes;
    if (attributes && typeof attributes === "object") {
      queue.push(attributes);
    }

    for (const entry of Object.values(record)) {
      if (entry && typeof entry === "object") {
        queue.push(entry);
      }
    }
  }

  return null;
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

function isPositiveIntegerString(value: string): boolean {
  return /^\d+$/.test(value) && BigInt(value) > 0n;
}

function describeArgTypes(args: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [
      key,
      Array.isArray(value) ? "array" : value === null ? "null" : typeof value
    ])
  );
}

function getFinalTransactionHash<T>(transaction: SignAndSendableTransaction<T>): string {
  return transaction.sendTransactionResponse?.hash ?? transaction.getTransactionResponse?.txHash ?? "";
}

async function signAndSubmitAssembledTransaction<T>(
  actionName: string,
  contractMethod: string,
  assembled: SignAndSendableTransaction<T>,
  input: { walletAddress: string; networkPassphrase: string },
  stage?: (value: CreateBatchStage) => void
): Promise<{ result: T; hash: string }> {
  const effectiveNetworkPassphrase = input.networkPassphrase || networks.testnet.networkPassphrase;

  devLog("[soroban] transaction assembly ready", {
    actionName,
    contractMethod,
    sourceAccount: input.walletAddress,
    network: effectiveNetworkPassphrase,
    transactionPhase: "simulating",
    hasSimulation: Boolean(assembled.simulation)
  });

  stage?.("waiting_signature");
  devLog("[soroban] waiting for signature", {
    actionName,
    contractMethod,
    sourceAccount: input.walletAddress,
    network: effectiveNetworkPassphrase,
    transactionPhase: "waiting_signature"
  });

  const sent = await assembled.signAndSend({
    signTransaction: (xdr, options) =>
      signTransactionWithFreighter(xdr, {
        address: options?.address ?? input.walletAddress,
        networkPassphrase: options?.networkPassphrase ?? effectiveNetworkPassphrase,
        connected: Boolean(input.walletAddress)
      })
  });

  const hash = getFinalTransactionHash(sent as unknown as SignAndSendableTransaction<T>);
  devLog("[soroban] transaction submitted", {
    actionName,
    contractMethod,
    sourceAccount: input.walletAddress,
    network: effectiveNetworkPassphrase,
    transactionPhase: "submitting",
    finalTransactionHash: hash
  });

  return {
    result: sent.result,
    hash
  };
}

export function validateCreateBatchInput(input: CreateBatchValidationInput): CreateBatchValidationResult {
  const sender = input.sender.trim();
  const token = normalizeContractId(input.token);
  const statsContract = normalizeContractId(input.statsContract);
  const recipients = input.recipients.map((item) => item.trim()).filter(Boolean);
  const amounts = input.amounts.map((item) => item.trim()).filter(Boolean);

  if (!isValidContractId(config.paymentTrackerContractId)) {
    return {
      success: false,
      message: "The Payment Tracker contract ID is missing or invalid."
    };
  }

  if (!sender) {
    return { success: false, message: "A sender wallet is required." };
  }
  if (!StrKey.isValidEd25519PublicKey(sender)) {
    return { success: false, message: "The sender address is not a valid Stellar account." };
  }

  if (!token) {
    return { success: false, message: "A token contract address is required." };
  }
  if (!isValidContractId(token)) {
    return { success: false, message: "The token contract ID is not valid." };
  }

  if (!statsContract) {
    return { success: false, message: "A stats contract address is required." };
  }
  if (!isValidContractId(statsContract)) {
    return { success: false, message: "The stats contract ID is not valid." };
  }

  if (recipients.length === 0) {
    return { success: false, message: "Enter at least one recipient before creating a batch." };
  }

  if (amounts.length === 0) {
    return { success: false, message: "Enter at least one amount before creating a batch." };
  }

  if (recipients.length !== amounts.length) {
    return { success: false, message: "The number of recipients must match the number of amounts." };
  }

  for (const recipient of recipients) {
    if (!StrKey.isValidEd25519PublicKey(recipient)) {
      return { success: false, message: `Invalid recipient address: ${recipient}` };
    }
  }

  const parsedAmounts: bigint[] = [];
  for (const amount of amounts) {
    if (!isPositiveIntegerString(amount)) {
      return { success: false, message: `Invalid amount value: ${amount}. Use a positive whole number.` };
    }
    parsedAmounts.push(BigInt(amount));
  }

  return {
    success: true,
    sender,
    token,
    statsContract,
    recipients,
    amounts: parsedAmounts
  };
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

  const client = new PaymentTrackerClient({
    contractId: config.paymentTrackerContractId,
    networkPassphrase: networks.testnet.networkPassphrase,
    rpcUrl: config.rpcUrl,
    publicKey: undefined,
    signTransaction: undefined
  });
  const batchTx = await client.get_batch({ id: BigInt(batchId) as never }, { simulate: true });
  await batchTx.simulate();
  const batch = batchTx.result.unwrap();
  if (!batch) return null;

  const payments: BatchPayment[] = [];
  const paymentClient = new PaymentTrackerClient({
    contractId: config.paymentTrackerContractId,
    networkPassphrase: networks.testnet.networkPassphrase,
    rpcUrl: config.rpcUrl,
    publicKey: undefined,
    signTransaction: undefined
  });
  for (let index = 0; index < Number(batch.recipient_count ?? 0); index += 1) {
    const paymentTx = await paymentClient.get_payment({ id: BigInt(batchId) as never, index: index as never }, { simulate: true });
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
}, hooks?: {
  onStage?: (stage: CreateBatchStage) => void;
}): Promise<ContractActionResult> {
  try {
    const actionName = "Create Batch";
    const contractMethod = "create_batch";
    const validation = validateCreateBatchInput({
      sender: input.sender,
      token: input.token,
      statsContract: input.statsContract,
      recipients: input.recipients,
      amounts: input.amounts
    });
    if (!validation.success) {
      return validation;
    }
    const { sender, token, statsContract, recipients: normalizedRecipients, amounts: normalizedAmounts } = validation;
    const memo = input.memo.trim();
    const sequenceConflictMessage = "Transaction sequence conflict. Please retry with a fresh transaction.";
    const argTypes = describeArgTypes({
      sender,
      token,
      stats_contract: statsContract,
      memo,
      recipients: normalizedRecipients,
      amounts: normalizedAmounts
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      hooks?.onStage?.("building");
      devLog("[soroban] action start", {
        actionName,
        contractMethod,
        sourcePublicKey: sender,
        network: input.networkPassphrase || networks.testnet.networkPassphrase,
        transactionPhase: "building",
        argTypes,
        attempt
      });

      await loadFreshSourceAccount(sender);

      const client = createTrackerClient(sender);
      devLog("[soroban] before simulation", {
        actionName,
        contractMethod,
        contractId: config.paymentTrackerContractId,
        sender,
        recipients: normalizedRecipients,
        amounts: normalizedAmounts,
        memo,
        walletAddress: input.walletAddress,
        network: input.networkPassphrase || networks.testnet.networkPassphrase,
        transactionPhase: "simulating",
        attempt
      });

      const tx = await client.create_batch({
        sender,
        token,
        stats_contract: statsContract,
        memo,
        recipients: normalizedRecipients,
        amounts: normalizedAmounts
      });

      hooks?.onStage?.("simulating");
      const assembled = tx as unknown as SignAndSendableTransaction<{ unwrap?: () => bigint | number | string } | undefined>;
      const createdBatchId = (() => {
        try {
          const value = assembled.result?.unwrap?.();
          return value === undefined ? undefined : Number(value);
        } catch {
          return undefined;
        }
      })();

      devLog("[soroban] built transaction", {
        actionName,
        contractMethod,
        sourcePublicKey: sender,
        network: input.networkPassphrase || networks.testnet.networkPassphrase,
        transactionPhase: "simulating",
        simulationResult: assembled.result ?? null,
        attempt
      });

      hooks?.onStage?.("submitting");
      const submitted = await signAndSubmitAssembledTransaction(
        actionName,
        contractMethod,
        assembled,
        {
          walletAddress: input.walletAddress,
          networkPassphrase: input.networkPassphrase
        },
        hooks?.onStage
      );
      if (!submitted.hash) {
        return { success: false, message: "The transaction could not be submitted." };
      }

      devLog("[soroban] transaction confirmed", {
        actionName,
        contractMethod,
        sourcePublicKey: sender,
        network: input.networkPassphrase || networks.testnet.networkPassphrase,
        transactionPhase: "polling",
        hash: submitted.hash,
        attempt
      });
      return { success: true, message: "Batch created successfully.", id: createdBatchId };
    }

    return { success: false, message: sequenceConflictMessage };
  } catch (error) {
    return { success: false, message: parseContractError(error) };
  }
}

export async function fundBatchOnContract(input: { batchId: number; walletAddress: string; networkPassphrase: string }): Promise<ContractActionResult> {
  try {
    const actionName = "Fund Batch";
    const contractMethod = "fund_batch";
    const client = new PaymentTrackerClient({
      contractId: config.paymentTrackerContractId,
      networkPassphrase: networks.testnet.networkPassphrase,
      rpcUrl: config.rpcUrl,
      publicKey: input.walletAddress,
      signTransaction: undefined
    });
    await loadFreshSourceAccount(input.walletAddress);
    const tx = await client.fund_batch({ id: BigInt(input.batchId) as never });
    devLog("[soroban] write action", {
      actionName,
      contractMethod,
      sourceAccount: input.walletAddress,
      network: input.networkPassphrase || networks.testnet.networkPassphrase,
      transactionPhase: "simulating",
      argTypes: describeArgTypes({ id: input.batchId })
    });
    const submitted = await signAndSubmitAssembledTransaction(actionName, contractMethod, tx as unknown as SignAndSendableTransaction<unknown>, {
      walletAddress: input.walletAddress,
      networkPassphrase: input.networkPassphrase
    });
    return { success: true, message: "Batch funded successfully.", id: input.batchId };
  } catch (error) {
    return { success: false, message: parseContractError(error) };
  }
}

export async function markSentOnContract(input: { batchId: number; index: number; txRef: string; walletAddress: string; networkPassphrase: string }): Promise<ContractActionResult> {
  try {
    const actionName = "Mark Sent";
    const contractMethod = "mark_sent";
    const client = new PaymentTrackerClient({
      contractId: config.paymentTrackerContractId,
      networkPassphrase: networks.testnet.networkPassphrase,
      rpcUrl: config.rpcUrl,
      publicKey: input.walletAddress,
      signTransaction: undefined
    });
    await loadFreshSourceAccount(input.walletAddress);
    const tx = await client.mark_sent({ id: BigInt(input.batchId) as never, index: input.index as never, tx_ref: input.txRef });
    devLog("[soroban] write action", {
      actionName,
      contractMethod,
      sourceAccount: input.walletAddress,
      network: input.networkPassphrase || networks.testnet.networkPassphrase,
      transactionPhase: "simulating",
      argTypes: describeArgTypes({ id: input.batchId, index: input.index, tx_ref: input.txRef })
    });
    await signAndSubmitAssembledTransaction(actionName, contractMethod, tx as unknown as SignAndSendableTransaction<unknown>, {
      walletAddress: input.walletAddress,
      networkPassphrase: input.networkPassphrase
    });
    return { success: true, message: "Payment marked as sent." };
  } catch (error) {
    return { success: false, message: parseContractError(error) };
  }
}

export async function markFailedOnContract(input: { batchId: number; index: number; reason: string; walletAddress: string; networkPassphrase: string }): Promise<ContractActionResult> {
  try {
    const actionName = "Mark Failed";
    const contractMethod = "mark_failed";
    const client = new PaymentTrackerClient({
      contractId: config.paymentTrackerContractId,
      networkPassphrase: networks.testnet.networkPassphrase,
      rpcUrl: config.rpcUrl,
      publicKey: input.walletAddress,
      signTransaction: undefined
    });
    await loadFreshSourceAccount(input.walletAddress);
    const tx = await client.mark_failed({ id: BigInt(input.batchId) as never, index: input.index as never, reason: input.reason });
    devLog("[soroban] write action", {
      actionName,
      contractMethod,
      sourceAccount: input.walletAddress,
      network: input.networkPassphrase || networks.testnet.networkPassphrase,
      transactionPhase: "simulating",
      argTypes: describeArgTypes({ id: input.batchId, index: input.index, reason: input.reason })
    });
    await signAndSubmitAssembledTransaction(actionName, contractMethod, tx as unknown as SignAndSendableTransaction<unknown>, {
      walletAddress: input.walletAddress,
      networkPassphrase: input.networkPassphrase
    });
    return { success: true, message: "Payment marked as failed." };
  } catch (error) {
    return { success: false, message: parseContractError(error) };
  }
}

export async function refundPendingOnContract(input: { batchId: number; walletAddress: string; networkPassphrase: string }): Promise<ContractActionResult> {
  try {
    const actionName = "Refund Pending";
    const contractMethod = "refund_pending";
    const client = new PaymentTrackerClient({
      contractId: config.paymentTrackerContractId,
      networkPassphrase: networks.testnet.networkPassphrase,
      rpcUrl: config.rpcUrl,
      publicKey: input.walletAddress,
      signTransaction: undefined
    });
    await loadFreshSourceAccount(input.walletAddress);
    const tx = await client.refund_pending({ id: BigInt(input.batchId) as never });
    devLog("[soroban] write action", {
      actionName,
      contractMethod,
      sourceAccount: input.walletAddress,
      network: input.networkPassphrase || networks.testnet.networkPassphrase,
      transactionPhase: "simulating",
      argTypes: describeArgTypes({ id: input.batchId })
    });
    await signAndSubmitAssembledTransaction(actionName, contractMethod, tx as unknown as SignAndSendableTransaction<unknown>, {
      walletAddress: input.walletAddress,
      networkPassphrase: input.networkPassphrase
    });
    return { success: true, message: "Refund processed successfully." };
  } catch (error) {
    return { success: false, message: parseContractError(error) };
  }
}
