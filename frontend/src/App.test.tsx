import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
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
    paymentStatsContractId: "CBCSQQXQF4LDFXFZ7MRLPYHVOJGLYVVVOLUCNWF42AXQ4YCAJ4LBJQRM"
  },
  getRecentEvents: vi.fn(async () => [])
}));

vi.mock("./lib/freighter", () => ({
  connectWallet: vi.fn(),
  getActiveWalletAddress: vi.fn(async () => "")
}));

vi.mock("./lib/soroban", () => ({
  loadBatchFromContract: vi.fn(async () => mockBatch),
  createBatchOnContract: vi.fn(async () => ({ id: 1 })),
  fundBatchOnContract: vi.fn(async () => ({ funded: true })),
  markSentOnContract: vi.fn(async () => ({ success: true })),
  markFailedOnContract: vi.fn(async () => ({ success: true })),
  refundPendingOnContract: vi.fn(async () => ({ refundAmount: "100" }))
}));

describe("App", () => {
  afterEach(() => {
    cleanup();
    vi.mocked(freighter.getActiveWalletAddress).mockResolvedValue("");
    vi.mocked(soroban.loadBatchFromContract).mockClear();
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
    vi.mocked(freighter.getActiveWalletAddress).mockResolvedValue(
      "GBOD6K5Q4GQ3R7ZL4QJ2P2L7KQ4S7K6R8H6M4QJ7FH6M4QJ7FH6M4QJ7"
    );

    render(<App />);

    const walletButton = await screen.findByRole("button", { name: /gbod/i });
    fireEvent.click(walletButton);

    expect(await screen.findByRole("menu", { name: /wallet actions/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /copy address/i })).toBeInTheDocument();
  });
});
