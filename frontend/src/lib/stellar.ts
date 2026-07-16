import { rpc } from "@stellar/stellar-sdk";

export type MarketEvent = {
  id: string;
  topic: string;
  ledger: number;
};

const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
const DEFAULT_NETWORK = "testnet";
const DEFAULT_PAYMENT_TRACKER_CONTRACT_ID = "CBNNUFSTMHM6FHDBPAC4J3IRAO4TLYDCDFWKCYGGOWG76LY5QNXXKESB";
const DEFAULT_PAYMENT_STATS_CONTRACT_ID = "CBCSQQXQF4LDFXFZ7MRLPYHVOJGLYVVVOLUCNWF42AXQ4YCAJ4LBJQRM";
const DEFAULT_PAYMENT_TOKEN_CONTRACT_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

const rpcUrl = import.meta.env.VITE_STELLAR_RPC_URL ?? DEFAULT_RPC_URL;
const contractId = import.meta.env.VITE_PAYMENT_TRACKER_CONTRACT_ID ?? DEFAULT_PAYMENT_TRACKER_CONTRACT_ID;

export const config = {
  network: import.meta.env.VITE_STELLAR_NETWORK ?? DEFAULT_NETWORK,
  rpcUrl,
  paymentTrackerContractId: contractId,
  paymentStatsContractId: import.meta.env.VITE_PAYMENT_STATS_CONTRACT_ID ?? DEFAULT_PAYMENT_STATS_CONTRACT_ID,
  paymentTokenContractId: import.meta.env.VITE_PAYMENT_TOKEN_CONTRACT_ID ?? DEFAULT_PAYMENT_TOKEN_CONTRACT_ID
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
