import {
  Activity,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  Send,
  ShieldCheck,
  Wallet
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { connectWallet, getActiveWalletAddress } from "./lib/freighter";
import { buildStellarExpertAccountUrl, copyTextToClipboard, shortenAddress } from "./lib/wallet";
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
  const [walletNotice, setWalletNotice] = useState("");
  const [isWalletMenuOpen, setIsWalletMenuOpen] = useState(false);
  const [error, setError] = useState("");
  const walletMenuRef = useRef<HTMLDivElement | null>(null);

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
    function handlePointerDown(event: MouseEvent) {
      if (!walletMenuRef.current?.contains(event.target as Node)) {
        setIsWalletMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsWalletMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
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
    setWalletNotice("");

    try {
      const result = await connectWallet();
      if (result.error) {
        setWalletAddress("");
        setWalletError(result.error);
        return;
      }

      setWalletAddress(result.address);
      setIsWalletMenuOpen(false);
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : "Unable to connect wallet.");
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleWalletButtonClick() {
    if (!walletAddress) {
      await handleConnectWallet();
      return;
    }

    setIsWalletMenuOpen((current) => !current);
    setWalletNotice("");
    setWalletError("");
  }

  async function handleCopyAddress() {
    try {
      await copyTextToClipboard(walletAddress);
      setWalletNotice("Address copied to clipboard.");
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : "Unable to copy wallet address.");
    } finally {
      setIsWalletMenuOpen(false);
    }
  }

  function handleOpenExplorer() {
    window.open(buildStellarExpertAccountUrl(walletAddress), "_blank", "noopener,noreferrer");
    setIsWalletMenuOpen(false);
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
        <div className="wallet" ref={walletMenuRef}>
          <button
            className="primary walletButton"
            type="button"
            onClick={handleWalletButtonClick}
            disabled={isConnecting}
            aria-haspopup={walletAddress ? "menu" : undefined}
            aria-expanded={walletAddress ? isWalletMenuOpen : undefined}
          >
            {isConnecting ? <Loader2 className="spin" size={18} /> : <Wallet size={18} />}
            {isConnecting ? "Connecting..." : walletLabel}
            {walletAddress && !isConnecting && <ChevronDown size={16} />}
          </button>
          {walletAddress && isWalletMenuOpen && (
            <div className="walletMenu" role="menu" aria-label="Wallet actions">
              <button className="walletMenuItem" type="button" onClick={handleCopyAddress} role="menuitem">
                <Copy size={16} />
                Copy address
              </button>
              <button className="walletMenuItem" type="button" onClick={handleOpenExplorer} role="menuitem">
                <ExternalLink size={16} />
                Open in Stellar Expert
              </button>
              <button className="walletMenuItem" type="button" onClick={handleConnectWallet} role="menuitem">
                <Wallet size={16} />
                Reconnect wallet
              </button>
            </div>
          )}
        </div>
        {walletError && <p className="error">{walletError}</p>}
        {!walletError && walletNotice && <p className="notice">{walletNotice}</p>}
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
