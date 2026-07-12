import { rpc } from "@stellar/stellar-sdk";

export type MarketEvent = {
  id: string;
  topic: string;
  ledger: number;
};

const rpcUrl = import.meta.env.VITE_STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
const contractId = import.meta.env.VITE_PAYMENT_TRACKER_CONTRACT_ID ?? "";

export const config = {
  network: import.meta.env.VITE_STELLAR_NETWORK ?? "testnet",
  rpcUrl,
  paymentTrackerContractId: contractId,
  paymentStatsContractId: import.meta.env.VITE_PAYMENT_STATS_CONTRACT_ID ?? ""
};

export async function getRecentEvents(): Promise<MarketEvent[]> {
  if (!contractId) return [];

  const server = new rpc.Server(rpcUrl);
  const latest = await server.getLatestLedger();
  const startLedger = Math.max(1, latest.sequence - 500);
  const response = await server.getEvents({
    startLedger,
    filters: [
      {
        type: "contract",
        contractIds: [contractId]
      }
    ],
    limit: 10
  });

  return response.events.map((event, index) => ({
    id: `${event.ledger}-${index}`,
    topic: event.topic.map((part) => part.toString()).join(" / "),
    ledger: event.ledger
  }));
}
