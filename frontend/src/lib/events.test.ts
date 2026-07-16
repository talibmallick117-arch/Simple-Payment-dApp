import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const getLatestLedger = vi.fn(async () => ({ sequence: 100 }));
  const getEvents = vi.fn(async () => ({ latestLedger: 100, cursor: "", events: [] as Array<Record<string, unknown>> }));

  return { getLatestLedger, getEvents };
});

vi.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: class {
      getLatestLedger = mocks.getLatestLedger;
      getEvents = mocks.getEvents;

      constructor(url: string) {
        void url;
      }
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
  switch: () => { name?: string; value?: number };
  str?: () => string;
  sym?: () => string;
  i32?: () => number;
  u32?: () => number;
  u64?: () => bigint;
  i64?: () => bigint;
  timepoint?: () => bigint;
  duration?: () => bigint;
  error?: () => unknown;
  address?: () => { toString?: () => string } | string;
  vec?: () => unknown[];
  map?: () => Array<{ key?: unknown; val?: unknown }>;
  bytes?: () => Uint8Array;
  instance?: () => unknown;
};

function mockScVal(name: string, value: number, methods: Partial<MockScVal> = {}): MockScVal {
  return {
    switch: () => ({ name, value }),
    ...methods
  };
}

function mockStringScVal(text: string): MockScVal {
  return mockScVal("scvSymbol", 15, { sym: () => text, str: () => text });
}

function mockI32ScVal(value: number): MockScVal {
  return mockScVal("scvI32", 4, { i32: () => value });
}

function mockUnsupportedScVal(): MockScVal {
  return mockScVal("scvContractInstance", 19, { instance: () => ({}) });
}

beforeEach(() => {
  mocks.getLatestLedger.mockReset();
  mocks.getLatestLedger.mockResolvedValue({ sequence: 100 });
  mocks.getEvents.mockReset();
  vi.mocked(loadBatchFromContract).mockReset();
});

describe("event decoding", () => {
  it("decodes an I32 event value without throwing and preserves the rendered fields", async () => {
    mocks.getEvents.mockResolvedValueOnce({
      latestLedger: 100,
      cursor: "",
      events: [
        {
          id: "1",
          ledger: 100,
          ledgerClosedAt: "2026-07-15T10:00:00Z",
          contractId: "CBTESTTRACKER",
          topic: [mockStringScVal("batch"), mockStringScVal("created")],
          value: mockI32ScVal(7)
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
      amount: "70",
      decodeIssue: false
    });
  });

  it("skips unsupported ScVal variants without breaking the rest of the event", async () => {
    mocks.getEvents.mockResolvedValueOnce({
      latestLedger: 100,
      cursor: "",
      events: [
        {
          id: "2",
          ledger: 101,
          ledgerClosedAt: "2026-07-15T10:01:00Z",
          contractId: "CBTESTTRACKER",
          topic: [mockStringScVal("batch"), mockStringScVal("created")],
          value: mockUnsupportedScVal()
        }
      ]
    });

    const events = await getRecentEvents();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventName: "Batch created",
      ledger: 101
    });
    expect(events[0].batchId).toBeUndefined();
    expect(events[0].decodeIssue).toBe(true);
  });
});
