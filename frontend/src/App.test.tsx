import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

vi.mock("./lib/stellar", () => ({
  config: {
    network: "testnet",
    rpcUrl: "https://soroban-testnet.stellar.org",
    paymentTrackerContractId: "",
    paymentStatsContractId: ""
  },
  getRecentEvents: vi.fn(async () => [])
}));

describe("App", () => {
  afterEach(() => {
    cleanup();
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
});
