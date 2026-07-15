import { scValToNative } from "@stellar/stellar-base";
import { rpc } from "@stellar/stellar-sdk";
import { loadBatchFromContract } from "./soroban";
import { config } from "./stellar";

export type MarketEvent = {
  id: string;
  eventName: string;
  batchId?: number;
  sender?: string;
  recipientCount?: number;
  amount?: string;
  ledger: number;
  timestamp?: string;
  decodeIssue?: boolean;
};

type BatchCacheEntry = Awaited<ReturnType<typeof loadBatchFromContract>>;
type RpcEvent = {
  id: string;
  ledger: number;
  ledgerClosedAt: string;
  topic: unknown[];
  value: unknown;
  contractId?: unknown;
};

const isDev = import.meta.env.DEV;

function devLog(message: string, details?: Record<string, unknown>) {
  if (!isDev) return;
  if (details) {
    console.debug(message, details);
    return;
  }
  console.debug(message);
}

function describeScValType(value: unknown): string {
  if (!value || typeof value !== "object") return typeof value;
  const maybeSwitch = (value as { switch?: () => { name?: string; value?: number } }).switch?.();
  if (!maybeSwitch) return "unknown";
  const name = typeof maybeSwitch.name === "string" ? maybeSwitch.name : "";
  const numeric = typeof maybeSwitch.value === "number" ? maybeSwitch.value : undefined;
  if (name && numeric !== undefined) return `${name}(${numeric})`;
  if (name) return name;
  if (numeric !== undefined) return `${numeric}`;
  return "unknown";
}

function decodeScValFallback(value: unknown): unknown {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const maybeSwitch = (value as { switch?: () => { name?: string; value?: number } }).switch?.();
  const switchName = maybeSwitch && typeof maybeSwitch.name === "string" ? maybeSwitch.name : "";

  if (typeof raw.u64 === "function") return Number((raw.u64 as () => bigint | number)());
  if (typeof raw.i64 === "function") return Number((raw.i64 as () => bigint | number)());
  if (typeof raw.u32 === "function") return Number((raw.u32 as () => number)());
  if (typeof raw.i32 === "function") return Number((raw.i32 as () => number)());
  if (typeof raw.str === "function") return (raw.str as () => string)();
  if (typeof raw.sym === "function") return (raw.sym as () => string)();
  if (typeof raw.bool === "function") return Boolean((raw.bool as () => boolean)());
  if (typeof raw.address === "function") {
    const address = (raw.address as () => { toString?: () => string } | string)();
    return typeof address === "string" ? address : address?.toString?.() ?? "";
  }
  if (typeof raw.bytes === "function") return (raw.bytes as () => unknown)();
  if (typeof raw.vec === "function") {
    const vec = raw.vec as () => unknown[];
    return vec().map((item) => decodeScValFallback(item) ?? toText(item));
  }
  if (typeof raw.map === "function") {
    const map = raw.map as () => Array<{ key?: unknown; val?: unknown }>;
    return map().map((entry) => [decodeScValFallback(entry.key) ?? toText(entry.key), decodeScValFallback(entry.val) ?? toText(entry.val)]);
  }

  if (switchName.toLowerCase().includes("u64") && typeof raw.u64 === "function") return Number((raw.u64 as () => bigint | number)());
  if (switchName.toLowerCase().includes("i64") && typeof raw.i64 === "function") return Number((raw.i64 as () => bigint | number)());
  if (switchName.toLowerCase().includes("u32") && typeof raw.u32 === "function") return Number((raw.u32 as () => number)());
  if (switchName.toLowerCase().includes("i32") && typeof raw.i32 === "function") return Number((raw.i32 as () => number)());

  return undefined;
}

function safeScValToNative(value: unknown, context: string, event: RpcEvent): { value: unknown; failed: boolean } {
  try {
    return { value: scValToNative(value as never), failed: false };
  } catch (error) {
    devLog("[events] decode failure", {
      context,
      contractId: event.contractId ?? "unknown",
      ledger: event.ledger,
      rawType: describeScValType(value),
      error: error instanceof Error ? error.message : String(error)
    });
    return { value: decodeScValFallback(value), failed: true };
  }
}

function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return `${value}`;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toText(item)).filter(Boolean).join(" / ");
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "";
    return entries.map(([key, item]) => `${key}: ${toText(item)}`).join(", ");
  }

  return "";
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Number(value);
  return undefined;
}

function extractNumericId(value: unknown): number | undefined {
  const direct = toNumber(value);
  if (direct !== undefined) return direct;

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractNumericId(item);
      if (nested !== undefined) return nested;
    }
    return undefined;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["id", "batchId", "batch_id", "value"]) {
      if (key in record) {
        const nested = extractNumericId(record[key]);
        if (nested !== undefined) return nested;
      }
    }
    for (const entry of Object.values(record)) {
      const nested = extractNumericId(entry);
      if (nested !== undefined) return nested;
    }
  }

  return undefined;
}

function decodeTopics(event: RpcEvent) {
  return event.topic.map((entry, index) => {
    const decoded = safeScValToNative(entry, `topic[${index}]`, event);
    return toText(decoded.value);
  });
}

function getEventName(group: string, action: string) {
  if (group === "batch" && action === "created") return "Batch created";
  if (group === "batch" && action === "funded") return "Batch funded";
  if (group === "batch" && action === "refunded") return "Batch refunded";
  if (group === "pay" && action === "sent") return "Payment sent";
  if (group === "pay" && action === "failed") return "Payment failed";
  return "Contract event";
}

function getBatchId(group: string, action: string, topicValues: string[], value: unknown): number | undefined {
  if (group === "batch" && (action === "created" || action === "funded")) {
    return extractNumericId(value);
  }

  if (group === "batch" && action === "refunded") {
    return extractNumericId(value);
  }

  if (group === "pay" && topicValues.length >= 4) {
    return toNumber(topicValues[2]);
  }

  return undefined;
}

async function buildEventRow(
  event: RpcEvent,
  batchCache: Map<number, BatchCacheEntry>
): Promise<MarketEvent> {
  const topicValues = decodeTopics(event);
  const group = topicValues[0] ?? "event";
  const action = topicValues[1] ?? "event";
  const decodedValue = safeScValToNative(event.value, "value", event);
  const batchId = getBatchId(group, action, topicValues, decodedValue.value ?? event.value);
  const batch = typeof batchId === "number" ? await getBatchSummary(batchId, batchCache) : null;
  const timestamp = event.ledgerClosedAt ? new Date(event.ledgerClosedAt).toLocaleString() : undefined;
  let amount: string | undefined;
  let recipientCount: number | undefined;
  let sender: string | undefined;
  const decodeIssue = decodedValue.failed;

  if (batch) {
    amount = batch.totalAmount;
    recipientCount = batch.recipientCount;
    sender = batch.sender;
  }

  if (group === "batch" && action === "refunded") {
    if (Array.isArray(decodedValue.value) && decodedValue.value.length >= 2) {
      amount = toText(decodedValue.value[1]);
    }
    if (!amount && decodedValue.value && typeof decodedValue.value === "object") {
      amount = toText((decodedValue.value as Record<string, unknown>).amount);
    }
  }

  if (group === "pay" && typeof batchId === "number") {
    const paymentIndex = toNumber(topicValues[3]);
    if (batch && paymentIndex !== undefined) {
      const payment = batch.payments[paymentIndex];
      amount = payment?.amount ?? amount;
    }
    if (!amount) {
      amount = toText(decodedValue.value);
    }
  }

  devLog("[events] decoded event payload", {
    id: event.id,
    ledger: event.ledger,
    ledgerClosedAt: event.ledgerClosedAt,
    contractId: event.contractId ?? "unknown",
    topicValues,
    topicTypes: event.topic.map((entry) => describeScValType(entry)),
    valueType: describeScValType(event.value),
    decodedValue: decodedValue.value,
    batchId,
    batchFound: Boolean(batch),
    decodeIssue,
    missingFields: {
      batchId: batchId === undefined,
      sender: !sender,
      recipientCount: recipientCount === undefined,
      amount: !amount
    }
  });

  return {
    id: event.id,
    eventName: getEventName(group, action),
    batchId,
    sender,
    recipientCount,
    amount,
    ledger: event.ledger,
    timestamp,
    decodeIssue
  };
}

async function getBatchSummary(batchId: number, batchCache: Map<number, BatchCacheEntry>) {
  if (batchCache.has(batchId)) {
    return batchCache.get(batchId) ?? null;
  }

  let batch = await loadBatchFromContract(batchId);
  if (!batch) {
    await new Promise((resolve) => globalThis.setTimeout(resolve, 250));
    batch = await loadBatchFromContract(batchId);
  }
  batchCache.set(batchId, batch);
  return batch;
}

export async function getRecentEvents(): Promise<MarketEvent[]> {
  if (!config.paymentTrackerContractId) return [];

  const server = new rpc.Server(config.rpcUrl);
  const latest = await server.getLatestLedger();
  const startLedger = Math.max(1, latest.sequence - 500);
  const response = await server.getEvents({
    startLedger,
    filters: [
      {
        type: "contract",
        contractIds: [config.paymentTrackerContractId]
      }
    ],
    limit: 10
  });

  const batchCache = new Map<number, BatchCacheEntry>();
  return Promise.all(response.events.map((event) => buildEventRow(event, batchCache)));
}
