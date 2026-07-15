import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import * as events from "./lib/events";
import * as freighter from "./lib/freighter";
import * as soroban from "./lib/soroban";

const mockBatch = {
  id: 1,
  memo: "July contractor payouts",
  sender: "GBOD6K5Q4GQ3R7ZL4QJ2P2L7KQ4S7K6R8H6M4QJ7FH6M4QJ7",
  token: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  statsContract: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  totalAmount: "100",
  recipientCount: 2,
  sentCount: 0,
  failedCount: 0,
  refunded: false,
  funded: false,
  payments: [
    {
      index: 0,
      recipient: "GBOD6K5Q4GQ3R7ZL4QJ2P2L7KQ4S7K6R8H6M4QJ7FH6M4QJ7",
      amount: "40",
      status: "Pending",
      note: ""
    }
  ]
};

vi.mock("./lib/stellar", () => ({
  config: {
    network: "testnet",
    rpcUrl: "https://soroban-testnet.stellar.org",
    paymentTrackerContractId: "CBNNUFSTMHM6FHDBPAC4J3IRAO4TLYDCDFWKCYGGOWG76LY5QNXXKESB",
    paymentStatsContractId: "CBCSQQXQF4LDFXFZ7MRLPYHVOJGLYVVVOLUCNWF42AXQ4YCAJ4LBJQRM",
    paymentTokenContractId: "CBNNUFSTMHM6FHDBPAC4J3IRAO4TLYDCDFWKCYGGOWG76LY5QNXXKESB"
  }
}));

vi.mock("./lib/events", () => ({
  getRecentEvents: vi.fn(async () => [])
}));

vi.mock("./lib/freighter", () => ({
  connectWallet: vi.fn(),
  getActiveWalletAddress: vi.fn(async () => ""),
  getActiveWalletSession: vi.fn(async () => ({ address: "", networkPassphrase: "", connected: false }))
}));

vi.mock("./lib/soroban", () => ({
  loadBatchFromContract: vi.fn(async () => mockBatch),
  createBatchOnContract: vi.fn(async () => ({ success: true, id: 1 })),
  fundBatchOnContract: vi.fn(async () => ({ success: true, funded: true })),
  markSentOnContract: vi.fn(async () => ({ success: true })),
  markFailedOnContract: vi.fn(async () => ({ success: true })),
  refundPendingOnContract: vi.fn(async () => ({ success: true, refundAmount: "100" })),
  validateCreateBatchInput: vi.fn(() => ({
    success: true,
    sender: "GBOD6K5Q4GQ3R7ZL4QJ2P2L7KQ4S7K6R8H6M4QJ7FH6M4QJ7FH6M4QJ7",
    token: "CBNNUFSTMHM6FHDBPAC4J3IRAO4TLYDCDFWKCYGGOWG76LY5QNXXKESB",
    statsContract: "CBCSQQXQF4LDFXFZ7MRLPYHVOJGLYVVVOLUCNWF42AXQ4YCAJ4LBJQRM",
    recipients: ["GBOD6K5Q4GQ3R7ZL4QJ2P2L7KQ4S7K6R8H6M4QJ7FH6M4QJ7FH6M4QJ7"],
    amounts: [100n]
  })),
  normalizeBatchFormValues: vi.fn((recipientsInput, amountsInput, fallbackRecipient, fallbackAmount) => ({
    recipients: recipientsInput ? recipientsInput.split(",").map((item: string) => item.trim()).filter(Boolean) : [fallbackRecipient],
    amounts: amountsInput ? amountsInput.split(",").map((item: string) => item.trim()).filter(Boolean) : [fallbackAmount]
  }))
}));

describe("App", () => {
  afterEach(() => {
    cleanup();
    vi.mocked(freighter.getActiveWalletSession).mockResolvedValue({ address: "", networkPassphrase: "", connected: false });
    vi.mocked(soroban.loadBatchFromContract).mockClear();
    vi.mocked(events.getRecentEvents).mockResolvedValue([]);
  });

  it("renders the production dApp surface", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Payment Tracker" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect wallet/i })).toBeInTheDocument();
  });

  it("shows a contract-backed batch summary", async () => {
    render(<App />);

    expect(await screen.findByText(/July contractor payouts/i)).toBeInTheDocument();
    expect(screen.getByText(/Recipient count/i)).toBeInTheDocument();
  });

  it("opens wallet actions when the connected wallet button is clicked", async () => {
    vi.mocked(freighter.getActiveWalletSession).mockResolvedValue({
      address: "GBOD6K5Q4GQ3R7ZL4QJ2P2L7KQ4S7K6R8H6M4QJ7FH6M4QJ7FH6M4QJ7",
      networkPassphrase: "Test SDF Network ; September 2015",
      connected: true
    });

    render(<App />);

    const walletButton = await screen.findByRole("button", { name: /gbod/i });
    fireEvent.click(walletButton);

    expect(await screen.findByRole("menu", { name: /wallet actions/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /copy address/i })).toBeInTheDocument();
  });

  it("renders live events as readable fields", async () => {
    vi.mocked(events.getRecentEvents).mockResolvedValue([
      {
        id: "1-0",
        eventName: "Batch created",
        batchId: 42,
        sender: "GBODH3R6ZMWMABCDEFGHIJKL7FH6",
        recipientCount: 3,
        amount: "250",
        ledger: 123456,
        timestamp: "7/15/2026, 10:00:00 PM"
      }
    ]);

    render(<App />);

    const card = await screen.findByRole("article", { name: /batch created/i });
    expect(within(card).getByText(/batch #42/i)).toBeInTheDocument();
    expect(within(card).getByText(/sender/i)).toBeInTheDocument();
    expect(within(card).getByTitle("GBODH3R6ZMWMABCDEFGHIJKL7FH6")).toBeInTheDocument();
    expect(within(card).getByText(/recipient/i)).toBeInTheDocument();
    expect(
      within(card).getByText((content, element) => element?.tagName === "STRONG" && content.trim() === "3")
    ).toBeInTheDocument();
    expect(within(card).getByText(/250 xlm/i)).toBeInTheDocument();
    expect(within(card).getByText(/ledger/i)).toBeInTheDocument();
    expect(
      within(card).getByText((content, element) => element?.tagName === "STRONG" && content.trim() === "123456")
    ).toBeInTheDocument();
    expect(within(card).getByText(/7\/15\/2026/i)).toBeInTheDocument();
  });

  it("renders all batch event titles and badges without overlap", async () => {
    vi.mocked(events.getRecentEvents).mockResolvedValue([
      {
        id: "1-0",
        eventName: "Batch created",
        batchId: 1,
        sender: "GBODH3R6ZMWMABCDEFGHIJKL7FH6",
        recipientCount: 2,
        amount: "100",
        ledger: 111,
        timestamp: "7/15/2026, 10:00:00 PM"
      },
      {
        id: "1-1",
        eventName: "Batch funded",
        batchId: 2,
        sender: "GBODH3R6ZMWMABCDEFGHIJKL7FH6",
        recipientCount: 2,
        amount: "100",
        ledger: 112,
        timestamp: "7/15/2026, 10:01:00 PM"
      },
      {
        id: "1-2",
        eventName: "Batch refunded",
        batchId: 3,
        sender: "GBODH3R6ZMWMABCDEFGHIJKL7FH6",
        recipientCount: 2,
        amount: "50",
        ledger: 113,
        timestamp: "7/15/2026, 10:02:00 PM"
      }
    ]);

    render(<App />);

    const heading = await screen.findByRole("heading", { name: /live events/i });
    const panel = heading.closest(".panel");
    expect(panel).not.toBeNull();
    const cards = await within(panel as HTMLElement).findAllByRole("article");
    expect(cards).toHaveLength(3);

    expect(within(cards[0]).getAllByText("Batch created")).toHaveLength(2);
    expect(within(cards[1]).getAllByText("Batch funded")).toHaveLength(2);
    expect(within(cards[2]).getAllByText("Batch refunded")).toHaveLength(2);
  });

  it("shows a friendly decode warning instead of a raw XDR error", async () => {
    vi.mocked(events.getRecentEvents).mockResolvedValue([
      {
        id: "bad-1",
        eventName: "Batch created",
        batchId: 1,
        sender: "GBODH3R6ZMWMABCDEFGHIJKL7FH6",
        recipientCount: 1,
        amount: "10",
        ledger: 200,
        timestamp: "7/15/2026, 10:00:00 PM",
        decodeIssue: true
      }
    ]);

    render(<App />);

    expect(await screen.findByText(/some event details could not be decoded/i)).toBeInTheDocument();
    expect(screen.queryByText(/bad union switch/i)).not.toBeInTheDocument();
  });

  it("uses the hydrated wallet session to create a batch without blocking on missing passphrase", async () => {
    vi.mocked(freighter.getActiveWalletSession).mockResolvedValue({
      address: "GBOD6K5Q4GQ3R7ZL4QJ2P2L7KQ4S7K6R8H6M4QJ7FH6M4QJ7FH6M4QJ7",
      networkPassphrase: "Test SDF Network ; September 2015",
      connected: true
    });

    render(<App />);

    fireEvent.change(screen.getByLabelText(/memo/i), { target: { value: "regression batch" } });
    fireEvent.change(screen.getByLabelText(/recipients/i), { target: { value: "GBOD6K5Q4GQ3R7ZL4QJ2P2L7KQ4S7K6R8H6M4QJ7FH6M4QJ7FH6M4QJ7" } });
    fireEvent.change(screen.getByLabelText(/amounts/i), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /create batch/i }));

    await waitFor(() => {
      expect(soroban.createBatchOnContract).toHaveBeenCalled();
    });

    expect(screen.queryByText(/connect your freighter wallet before creating a batch/i)).not.toBeInTheDocument();
  });

  it("submits Create Batch only once when clicked repeatedly", async () => {
    vi.mocked(freighter.getActiveWalletSession).mockResolvedValue({
      address: "GBOD6K5Q4GQ3R7ZL4QJ2P2L7KQ4S7K6R8H6M4QJ7FH6M4QJ7FH6M4QJ7",
      networkPassphrase: "Test SDF Network ; September 2015",
      connected: true
    });

    let resolveCreate: (value: { success: boolean; id?: number; message?: string }) => void = () => undefined;
    vi.mocked(soroban.createBatchOnContract).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        })
    );

    render(<App />);

    fireEvent.change(screen.getByLabelText(/memo/i), { target: { value: "double click batch" } });
    fireEvent.change(screen.getByLabelText(/recipients/i), { target: { value: "GBOD6K5Q4GQ3R7ZL4QJ2P2L7KQ4S7K6R8H6M4QJ7FH6M4QJ7FH6M4QJ7" } });
    fireEvent.change(screen.getByLabelText(/amounts/i), { target: { value: "100" } });

    const createButton = screen.getByRole("button", { name: /create batch/i });
    fireEvent.click(createButton);
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(soroban.createBatchOnContract).toHaveBeenCalledTimes(1);
    });

    resolveCreate({ success: true, id: 7 });

    await waitFor(() => {
      expect(createButton).not.toBeDisabled();
    });
  });

  it("resets the loading state after a failed Create Batch attempt", async () => {
    vi.mocked(freighter.getActiveWalletSession).mockResolvedValue({
      address: "GBOD6K5Q4GQ3R7ZL4QJ2P2L7KQ4S7K6R8H6M4QJ7FH6M4QJ7FH6M4QJ7",
      networkPassphrase: "Test SDF Network ; September 2015",
      connected: true
    });

    vi.mocked(soroban.createBatchOnContract).mockResolvedValue({
      success: false,
      message: "Transaction sequence conflict. Please retry with a fresh transaction."
    });

    render(<App />);

    fireEvent.change(screen.getByLabelText(/memo/i), { target: { value: "failed batch" } });
    fireEvent.change(screen.getByLabelText(/recipients/i), { target: { value: "GBOD6K5Q4GQ3R7ZL4QJ2P2L7KQ4S7K6R8H6M4QJ7FH6M4QJ7FH6M4QJ7" } });
    fireEvent.change(screen.getByLabelText(/amounts/i), { target: { value: "100" } });
    const createButton = screen.getByRole("button", { name: /create batch/i });
    fireEvent.click(createButton);

    expect(await screen.findByText(/transaction sequence conflict/i)).toBeInTheDocument();
    expect(createButton).not.toBeDisabled();
  });
});
