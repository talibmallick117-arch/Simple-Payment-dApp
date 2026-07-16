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
  topic?: unknown[];
  topics?: unknown[];
  value?: unknown;
  contractId?: unknown;
};

type ScValSwitchInfo = {
  name: string;
  value: number;
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
  const maybeSwitch = getScValSwitchInfo(value);
  if (!maybeSwitch) return typeof value;
  const { name, value: numeric } = maybeSwitch;
  if (name && numeric !== undefined) return `${name}(${numeric})`;
  if (name) return name;
  if (numeric !== undefined) return `${numeric}`;
  return "unknown";
}

function getScValSwitchInfo(value: unknown): ScValSwitchInfo | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as {
    switch?: () => unknown;
    _switch?: unknown;
  };

  try {
    if (typeof candidate.switch === "function") {
      const maybeSwitch = candidate.switch.call(value);
      if (maybeSwitch && typeof maybeSwitch === "object") {
        const typedSwitch = maybeSwitch as { name?: unknown; value?: unknown };
        const name = typeof typedSwitch.name === "string" ? typedSwitch.name : "";
        const numeric = typeof typedSwitch.value === "number" ? typedSwitch.value : Number.NaN;
        if (Number.isFinite(numeric)) return { name, value: numeric };
        if (name) return { name, value: -1 };
      } else if (typeof maybeSwitch === "string" || typeof maybeSwitch === "number") {
        return { name: "", value: Number(maybeSwitch) };
      }
    }

    if (candidate._switch !== undefined) {
      const maybeSwitch = candidate._switch;
      if (maybeSwitch && typeof maybeSwitch === "object") {
        const typedSwitch = maybeSwitch as { name?: unknown; value?: unknown };
        const name = typeof typedSwitch.name === "string" ? typedSwitch.name : "";
        const numeric = typeof typedSwitch.value === "number" ? typedSwitch.value : Number.NaN;
        if (Number.isFinite(numeric)) return { name, value: numeric };
        if (name) return { name, value: -1 };
      } else if (typeof maybeSwitch === "string" || typeof maybeSwitch === "number") {
        return { name: "", value: Number(maybeSwitch) };
      }
    }
  } catch (error) {
    devLog("[events] scval type inspection failed", {
      error: error instanceof Error ? error.message : String(error),
      typeofValue: typeof value,
      hasSwitch: typeof candidate.switch === "function",
      hasPrivateSwitch: candidate._switch !== undefined
    });
    return null;
  }

  return null;
}

function toBytesText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  if (value instanceof Uint8Array) return Array.from(value).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (value && typeof value === "object" && "toString" in value && typeof (value as { toString?: () => string }).toString === "function") {
    return (value as { toString: () => string }).toString();
  }
  return toText(value);
}

function decodeScValByType(value: unknown, context: string, event: RpcEvent): { value: unknown; failed: boolean } {
  const candidate = value as {
    switch?: () => unknown;
    _switch?: unknown;
  };
  const switchInfo = getScValSwitchInfo(value);
  devLog("[events] decode scval", {
    context,
    contractId: event.contractId ?? "unknown",
    ledger: event.ledger,
    typeofValue: typeof value,
    hasSwitch: typeof candidate?.switch === "function",
    hasPrivateSwitch: candidate?._switch !== undefined,
    switchName: switchInfo?.name ?? "unknown",
    switchValue: switchInfo?.value ?? "unknown"
  });

  if (!switchInfo) {
    return { value: undefined, failed: true };
  }

  const raw = value as Record<string, unknown>;
  const decodeMethod = (
    method:
      | "b"
      | "u32"
      | "i32"
      | "u64"
      | "i64"
      | "timepoint"
      | "duration"
      | "u128"
      | "i128"
      | "u256"
      | "i256"
      | "str"
      | "sym"
      | "bytes"
      | "vec"
      | "map"
      | "address"
      | "error"
  ) => {
    const fn = raw[method];
    return typeof fn === "function" ? (fn as (this: unknown) => unknown).call(value) : undefined;
  };

  switch (switchInfo.value) {
    case 0:
      return { value: decodeMethod("b"), failed: false };
    case 1:
      return { value: undefined, failed: false };
    case 2: {
      const errorValue = decodeMethod("error");
      return { value: errorValue ?? "error", failed: false };
    }
    case 3:
    case 4:
      return { value: decodeMethod(switchInfo.value === 3 ? "u32" : "i32"), failed: false };
    case 5:
      return { value: decodeMethod("u64"), failed: false };
    case 6:
      return { value: decodeMethod("i64"), failed: false };
    case 7:
      return { value: decodeMethod("timepoint"), failed: false };
    case 8:
      return { value: decodeMethod("duration"), failed: false };
    case 9:
    case 10:
    case 11:
    case 12:
      return {
        value: decodeMethod(switchInfo.value === 9 ? "u128" : switchInfo.value === 10 ? "i128" : switchInfo.value === 11 ? "u256" : "i256"),
        failed: false
      };
    case 13:
      return { value: toBytesText(decodeMethod("bytes")), failed: false };
    case 14:
      return { value: decodeMethod("str"), failed: false };
    case 15:
      return { value: decodeMethod("sym"), failed: false };
    case 16: {
      const vec = decodeMethod("vec");
      if (!Array.isArray(vec)) return { value: [], failed: true };
      let failed = false;
      const decoded = vec.map((item, index) => {
        const next = decodeScValByType(item, `${context}.vec[${index}]`, event);
        failed ||= next.failed;
        return next.value;
      });
      return { value: decoded, failed };
    }
    case 17: {
      const map = decodeMethod("map");
      if (!Array.isArray(map)) return { value: [], failed: true };
      let failed = false;
      const decoded = map.map((entry, index) => {
        const typedEntry = entry as { key?: unknown; val?: unknown };
        const key = decodeScValByType(typedEntry.key, `${context}.map[${index}].key`, event);
        const val = decodeScValByType(typedEntry.val, `${context}.map[${index}].val`, event);
        failed ||= key.failed || val.failed;
        return [key.value, val.value];
      });
      return { value: decoded, failed };
    }
    case 18:
      return { value: toText(decodeMethod("address")), failed: false };
    default:
      devLog("[events] unsupported scval union variant", {
        context,
        contractId: event.contractId ?? "unknown",
        ledger: event.ledger,
        switchName: switchInfo.name,
        switchValue: switchInfo.value
      });
      return { value: undefined, failed: true };
  }
}

function safeScValToNative(value: unknown, context: string, event: RpcEvent): { value: unknown; failed: boolean } {
  return decodeScValByType(value, context, event);
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
    const maybeToString = (value as { toString?: () => string }).toString;
    if (typeof maybeToString === "function") {
      const text = maybeToString.call(value);
      if (text && text !== "[object Object]") {
        return text;
      }
    }
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

function decodeTopics(event: RpcEvent): { values: string[]; failed: boolean } {
  let failed = false;
  const topics = Array.isArray(event.topic) ? event.topic : Array.isArray(event.topics) ? event.topics : [];
  const values = topics.map((entry, index) => {
    const decoded = safeScValToNative(entry, `topic[${index}]`, event);
    failed ||= decoded.failed;
    return decoded.failed ? "N/A" : toText(decoded.value) || "N/A";
  });

  return { values, failed: failed || topics.length === 0 };
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
  batchCache: Map<number, BatchCacheEntry>,
  eventIndex: number
): Promise<MarketEvent> {
  const topicDecode = decodeTopics(event);
  const topicValues = topicDecode.values;
  const group = topicValues[0] ?? "event";
  const action = topicValues[1] ?? "event";
  const decodedValue = safeScValToNative(event.value, "value", event);
  const batchId = decodedValue.failed ? undefined : getBatchId(group, action, topicValues, decodedValue.value);
  const batch = typeof batchId === "number" ? await getBatchSummary(batchId, batchCache) : null;
  const timestamp = event.ledgerClosedAt ? new Date(event.ledgerClosedAt).toLocaleString() : undefined;
  let amount: string | undefined;
  let recipientCount: number | undefined;
  let sender: string | undefined;
  const decodeIssue = topicDecode.failed || decodedValue.failed;

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
    eventIndex,
    topicValues,
    topicTypes: (Array.isArray(event.topic) ? event.topic : Array.isArray(event.topics) ? event.topics : []).map((entry) => describeScValType(entry)),
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

  try {
    let batch = await loadBatchFromContract(batchId);
    if (!batch) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 250));
      batch = await loadBatchFromContract(batchId);
    }
    batchCache.set(batchId, batch);
    return batch;
  } catch (error) {
    devLog("[events] batch summary lookup failed", {
      batchId,
      error: error instanceof Error ? error.message : String(error)
    });
    batchCache.set(batchId, null);
    return null;
  }
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
  return Promise.all(response.events.map((event, index) => buildEventRow(event as RpcEvent, batchCache, index)));
}
