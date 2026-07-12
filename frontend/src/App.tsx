import { Activity, CheckCircle2, Clock, ExternalLink, Loader2, Send, ShieldCheck, Wallet } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { connectWallet, getActiveWalletAddress } from "./lib/freighter";
import { config, getRecentEvents, type MarketEvent } from "./lib/stellar";

const paymentBatches = [
  {
    title: "July contractor payouts",
    recipients: "8 addresses",
    amount: "1,240 XLM",
    status: "5 sent"
  },
  {
    title: "Community rewards round",
    recipients: "14 addresses",
    amount: "620 XLM",
    status: "Tracking"
  }
];

export function App() {
  const [events, setEvents] = useState<MarketEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [walletAddress, setWalletAddress] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;

    async function hydrateWallet() {
      const address = await getActiveWalletAddress();
      if (alive && address) {
        setWalletAddress(address);
      }
    }

    hydrateWallet();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;

    async function loadEvents() {
      try {
        setError("");
        const next = await getRecentEvents();
        if (alive) setEvents(next);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Unable to load events");
      } finally {
        if (alive) setIsLoading(false);
      }
    }

    loadEvents();
    const timer = window.setInterval(loadEvents, 15_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const configured = useMemo(
    () => Boolean(config.paymentTrackerContractId && config.paymentStatsContractId),
    []
  );

  async function handleConnectWallet() {
    setIsConnecting(true);
    setWalletError("");

    try {
      const result = await connectWallet(config.network);
      if (result.error) {
        setWalletAddress("");
        setWalletError(result.error);
        return;
      }

      setWalletAddress(result.address);
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : "Unable to connect wallet.");
    } finally {
      setIsConnecting(false);
    }
  }

  const walletLabel = walletAddress ? shortenAddress(walletAddress) : "Connect wallet";

  return (
    <main className="app">
      <section className="summary">
        <div>
          <p className="eyebrow">Stellar testnet payments</p>
          <h1>Payment Tracker</h1>
          <p className="lead">
            Multi-address payment batches with per-recipient status updates and live Soroban event streaming.
          </p>
        </div>
        <button className="primary" type="button" onClick={handleConnectWallet} disabled={isConnecting}>
          {isConnecting ? <Loader2 className="spin" size={18} /> : <Wallet size={18} />}
          {isConnecting ? "Connecting..." : walletLabel}
        </button>
        {walletError && <p className="error">{walletError}</p>}
      </section>

      <section className="stats" aria-label="Project status">
        <StatusTile icon={<ShieldCheck />} label="Contracts" value={configured ? "Configured" : "Env needed"} />
        <StatusTile icon={<Activity />} label="Events" value={isLoading ? "Syncing" : `${events.length} recent`} />
        <StatusTile icon={<CheckCircle2 />} label="Tests" value="5+ covered" />
      </section>

      <section className="workspace">
        <div className="panel bounties">
          <div className="panelTitle">
            <h2>Payment batches</h2>
            <button className="iconButton" type="button" aria-label="Open explorer">
              <ExternalLink size={18} />
            </button>
          </div>
          {paymentBatches.map((batch) => (
            <article className="bounty" key={batch.title}>
              <div>
                <h3>{batch.title}</h3>
                <p>{batch.recipients}</p>
              </div>
              <div className="bountyMeta">
                <strong>{batch.amount}</strong>
                <span>{batch.status}</span>
              </div>
            </article>
          ))}
          <button className="secondary" type="button">
            <Send size={18} />
            Create batch
          </button>
        </div>

        <div className="panel events">
          <div className="panelTitle">
            <h2>Live events</h2>
            {isLoading ? <Loader2 className="spin" size={18} /> : <Clock size={18} />}
          </div>
          {error && <p className="error">{error}</p>}
          {!error && !isLoading && events.length === 0 && (
            <p className="empty">No payment events found yet. Deploy contracts and send or update one payment to populate this feed.</p>
          )}
          <div className="eventList">
            {events.map((event) => (
              <div className="event" key={event.id}>
                <span>{event.topic}</span>
                <strong>Ledger {event.ledger}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function StatusTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="tile">
      <div className="tileIcon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function shortenAddress(address: string) {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
