import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import * as freighter from "./lib/freighter";

vi.mock("./lib/stellar", () => ({
  config: {
    network: "testnet",
    rpcUrl: "https://soroban-testnet.stellar.org",
    paymentTrackerContractId: "",
    paymentStatsContractId: ""
  },
  getRecentEvents: vi.fn(async () => [])
}));

vi.mock("./lib/freighter", () => ({
  connectWallet: vi.fn(),
  getActiveWalletAddress: vi.fn(async () => "")
}));

describe("App", () => {
  afterEach(() => {
    cleanup();
    vi.mocked(freighter.getActiveWalletAddress).mockResolvedValue("");
  });

  it("renders the production dApp surface", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Payment Tracker" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect wallet/i })).toBeInTheDocument();
  });

  it("shows an empty event state", async () => {
    render(<App />);

    expect(await screen.findByText(/No payment events found yet/i)).toBeInTheDocument();
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
