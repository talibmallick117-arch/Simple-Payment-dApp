import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const scValToNative = vi.fn((value: unknown) => {
    if (value && typeof value === "object" && (value as { fail?: boolean }).fail) {
      throw new Error("Bad union switch: 4");
    }
    return (value as { native?: unknown }).native;
  });

  const getLatestLedger = vi.fn(async () => ({ sequence: 100 }));
  const getEvents = vi.fn(async () => ({ latestLedger: 100, cursor: "", events: [] as Array<Record<string, unknown>> }));

  return { scValToNative, getLatestLedger, getEvents };
});

vi.mock("@stellar/stellar-base", () => ({
  scValToNative: mocks.scValToNative
}));

vi.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: class {
      getLatestLedger = mocks.getLatestLedger;
      getEvents = mocks.getEvents;

      constructor(_url: string) {}
    }
  }
}));

vi.mock("./soroban", () => ({
  loadBatchFromContract: vi.fn()
}));

vi.mock("./stellar", () => ({
  config: {
    rpcUrl: "https://soroban-testnet.stellar.org",
    paymentTrackerContractId: "CBTESTTRACKER",
    paymentStatsContractId: "CBTESTSTATS",
    paymentTokenContractId: "CBTESTTOKEN"
  }
}));

import { getRecentEvents } from "./events";
import { loadBatchFromContract } from "./soroban";

type MockScVal = {
  native?: unknown;
  fail?: boolean;
  switch: () => { name?: string; value?: number };
  u64?: () => bigint;
  str?: () => string;
};

function mockScVal(native: unknown, name: string, value: number): MockScVal {
  return {
    native,
    switch: () => ({ name, value }),
    str: () => String(native)
  };
}

function mockBadU64(native: unknown): MockScVal {
  return {
    native,
    fail: true,
    switch: () => ({ name: "scvU64", value: 4 }),
    u64: () => BigInt(native as number)
  };
}

beforeEach(() => {
  mocks.scValToNative.mockReset();
  mocks.scValToNative.mockImplementation((value: unknown) => {
    if (value && typeof value === "object" && (value as { fail?: boolean }).fail) {
      throw new Error("Bad union switch: 4");
    }
    return (value as { native?: unknown }).native;
  });
  mocks.getLatestLedger.mockReset();
  mocks.getLatestLedger.mockResolvedValue({ sequence: 100 });
  mocks.getEvents.mockReset();
  vi.mocked(loadBatchFromContract).mockReset();
});

describe("event decoding", () => {
  it("decodes a supported event even when the ScVal union variant is not handled by scValToNative", async () => {
    mocks.getEvents.mockResolvedValueOnce({
      latestLedger: 100,
      cursor: "",
      events: [
        {
          id: "1",
          ledger: 100,
          ledgerClosedAt: "2026-07-15T10:00:00Z",
          contractId: "CBTESTTRACKER",
          topic: [mockScVal("batch", "scvSymbol", 14), mockScVal("created", "scvSymbol", 14)],
          value: mockBadU64(7)
        }
      ]
    });

    vi.mocked(loadBatchFromContract).mockResolvedValueOnce({
      id: 7,
      memo: "Batch 7",
      sender: "GBOD6K5Q4GQ3R7ZL4QJ2P2L7KQ4S7K6R8H6M4QJ7FH6M4QJ7FH6M4QJ7",
      token: "CBTOKEN",
      statsContract: "CBSTATS",
      totalAmount: "70",
      recipientCount: 2,
      sentCount: 0,
      failedCount: 0,
      refunded: false,
      funded: false,
      payments: []
    });

    const events = await getRecentEvents();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventName: "Batch created",
      batchId: 7,
      sender: "GBOD6K5Q4GQ3R7ZL4QJ2P2L7KQ4S7K6R8H6M4QJ7FH6M4QJ7FH6M4QJ7",
      recipientCount: 2,
      amount: "70"
    });
    expect(events[0].decodeIssue).toBe(true);
  });

  it("falls back safely when topic and value decoding both fail", async () => {
    mocks.getEvents.mockResolvedValueOnce({
      latestLedger: 100,
      cursor: "",
      events: [
        {
          id: "2",
          ledger: 101,
          ledgerClosedAt: "2026-07-15T10:01:00Z",
          contractId: "CBTESTTRACKER",
          topic: [mockBadU64(1), mockBadU64(2)],
          value: mockBadU64(9)
        }
      ]
    });

    const events = await getRecentEvents();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventName: "Contract event",
      ledger: 101
    });
    expect(events[0].batchId).toBeUndefined();
    expect(events[0].decodeIssue).toBe(true);
  });
});
