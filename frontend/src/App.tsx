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
import {
  createBatchOnContract,
  fundBatchOnContract,
  loadBatchFromContract,
  markFailedOnContract,
  markSentOnContract,
  normalizeBatchFormValues,
  refundPendingOnContract,
  type BatchSummary
} from "./lib/soroban";
import { buildStellarExpertAccountUrl, copyTextToClipboard, shortenAddress } from "./lib/wallet";
import { config, getRecentEvents, type MarketEvent } from "./lib/stellar";

export function App() {
  const [events, setEvents] = useState<MarketEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBatchLoading, setIsBatchLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [walletAddress, setWalletAddress] = useState("");
  const [walletNetworkPassphrase, setWalletNetworkPassphrase] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [walletNotice, setWalletNotice] = useState("");
  const [isWalletMenuOpen, setIsWalletMenuOpen] = useState(false);
  const [error, setError] = useState("");
  const [batch, setBatch] = useState<BatchSummary | null>(null);
  const [batchIdInput, setBatchIdInput] = useState("1");
  const [memoInput, setMemoInput] = useState("July contractor payouts");
  const [tokenInput, setTokenInput] = useState("");
  const [statsContractInput, setStatsContractInput] = useState(config.paymentStatsContractId);
  const [recipientsInput, setRecipientsInput] = useState("");
  const [amountsInput, setAmountsInput] = useState("");
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

    void loadEvents();
    const timer = window.setInterval(() => {
      void loadEvents();
    }, 15_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    void loadBatchFromCurrentId();
  }, []);

  const configured = useMemo(
    () => Boolean(config.paymentTrackerContractId && config.paymentStatsContractId),
    []
  );

  async function loadBatchFromCurrentId() {
    const id = Number(batchIdInput || 1);
    if (!Number.isFinite(id) || id <= 0) {
      return;
    }

    setIsBatchLoading(true);
    setWalletError("");
    try {
      const nextBatch = await loadBatchFromContract(id);
      setBatch(nextBatch);
      if (nextBatch) {
        setBatchIdInput(String(nextBatch.id));
      }
    } catch (err) {
      setBatch(null);
      setError(err instanceof Error ? err.message : "Unable to load batch data.");
    } finally {
      setIsBatchLoading(false);
    }
  }

  async function handleConnectWallet() {
    setIsConnecting(true);
    setWalletError("");
    setWalletNotice("");

    try {
      const result = await connectWallet();
      if (result.error) {
        setWalletAddress("");
        setWalletNetworkPassphrase("");
        setWalletError(result.error);
        return;
      }

      setWalletAddress(result.address);
      setWalletNetworkPassphrase(result.networkPassphrase);
      setIsWalletMenuOpen(false);
      setWalletNotice("Wallet connected. You can now sign Soroban transactions.");
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

  async function handleLoadBatch() {
    await loadBatchFromCurrentId();
  }

  async function handleCreateBatch() {
    console.log("Create Batch clicked");
    console.log("[app] createBatch start", {
      walletAddress,
      walletNetworkPassphrase,
      memoInput,
      tokenInput,
      statsContractInput,
      recipientsInput,
      amountsInput,
      isSubmitting
    });

    if (!walletAddress || !walletNetworkPassphrase) {
      setWalletError("Connect your Freighter wallet before creating a batch.");
      return;
    }

    setIsSubmitting(true);
    setWalletError("");
    setWalletNotice("");

    try {
      const { recipients, amounts } = normalizeBatchFormValues(
        recipientsInput,
        amountsInput,
        walletAddress,
        "1"
      );
      const result = await createBatchOnContract({
        sender: walletAddress,
        token: tokenInput || "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        statsContract: statsContractInput || config.paymentStatsContractId,
        memo: memoInput,
        recipients,
        amounts,
        walletAddress,
        networkPassphrase: walletNetworkPassphrase
      });

      if (!result.success) {
        setWalletError(result.message || "The batch could not be created.");
        return;
      }

      setWalletNotice("Batch created successfully. Refreshing the latest batch state.");
      const nextBatchId = result.id ?? Number(batchIdInput || 1);
      setBatchIdInput(String(nextBatchId));
      await loadBatchFromContract(nextBatchId);
      setBatch(await loadBatchFromContract(nextBatchId));
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : "Unable to create the batch.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleFundBatch() {
    if (!walletAddress || !walletNetworkPassphrase) {
      setWalletError("Connect your Freighter wallet before funding a batch.");
      return;
    }

    setIsSubmitting(true);
    setWalletError("");
    setWalletNotice("");

    try {
      const result = await fundBatchOnContract({ batchId: Number(batchIdInput), walletAddress, networkPassphrase: walletNetworkPassphrase });
      if (!result.success) {
        setWalletError(result.message || "The batch could not be funded.");
        return;
      }
      setWalletNotice("Batch funded successfully.");
      await handleLoadBatch();
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : "Unable to fund the batch.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleMarkSent(index: number) {
    if (!walletAddress || !walletNetworkPassphrase) {
      setWalletError("Connect your Freighter wallet before updating a payment.");
      return;
    }

    setIsSubmitting(true);
    setWalletError("");
    setWalletNotice("");

    try {
      const result = await markSentOnContract({ batchId: Number(batchIdInput), index, txRef: `ui-${Date.now()}`, walletAddress, networkPassphrase: walletNetworkPassphrase });
      if (!result.success) {
        setWalletError(result.message || "The payment could not be marked as sent.");
        return;
      }
      setWalletNotice("Payment marked as sent.");
      await handleLoadBatch();
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : "Unable to mark the payment as sent.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleMarkFailed(index: number) {
    if (!walletAddress || !walletNetworkPassphrase) {
      setWalletError("Connect your Freighter wallet before updating a payment.");
      return;
    }

    setIsSubmitting(true);
    setWalletError("");
    setWalletNotice("");

    try {
      const result = await markFailedOnContract({ batchId: Number(batchIdInput), index, reason: "UI marked failed", walletAddress, networkPassphrase: walletNetworkPassphrase });
      if (!result.success) {
        setWalletError(result.message || "The payment could not be marked as failed.");
        return;
      }
      setWalletNotice("Payment marked as failed.");
      await handleLoadBatch();
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : "Unable to mark the payment as failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRefundPending() {
    if (!walletAddress || !walletNetworkPassphrase) {
      setWalletError("Connect your Freighter wallet before refunding pending payments.");
      return;
    }

    setIsSubmitting(true);
    setWalletError("");
    setWalletNotice("");

    try {
      const result = await refundPendingOnContract({ batchId: Number(batchIdInput), walletAddress, networkPassphrase: walletNetworkPassphrase });
      if (!result.success) {
        setWalletError(result.message || "Pending payments could not be refunded.");
        return;
      }
      setWalletNotice("Pending payments refunded.");
      await handleLoadBatch();
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : "Unable to refund pending payments.");
    } finally {
      setIsSubmitting(false);
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
            Multi-address payment batches with real Soroban contract calls, wallet signing, and live event streaming.
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
        <StatusTile icon={<CheckCircle2 />} label="On-chain" value={batch ? `Batch ${batch.id}` : "Awaiting load"} />
      </section>

      <section className="workspace">
        <div className="panel bounties">
          <div className="panelTitle">
            <h2>Contract batch view</h2>
            <button className="iconButton" type="button" aria-label="Open explorer" onClick={handleLoadBatch}>
              <ExternalLink size={18} />
            </button>
          </div>

          <div className="inlineForm">
            <label>
              Batch ID
              <input value={batchIdInput} onChange={(event) => setBatchIdInput(event.target.value)} />
            </label>
            <button className="secondary" type="button" onClick={handleLoadBatch} disabled={isBatchLoading}>
              {isBatchLoading ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
              Load batch
            </button>
          </div>

          {batch ? (
            <article className="bounty contractBatch">
              <div>
                <h3>{batch.memo || `Batch ${batch.id}`}</h3>
                <p>Sender: {batch.sender || "Unknown"}</p>
                <p>Recipient count: {batch.recipientCount}</p>
                <p>Total amount: {batch.totalAmount}</p>
              </div>
              <div className="bountyMeta">
                <strong>{batch.funded ? "Funded" : "Pending funding"}</strong>
                <span>{batch.refunded ? "Refunded" : `${batch.sentCount} sent / ${batch.failedCount} failed`}</span>
              </div>
            </article>
          ) : (
            <p className="empty">No batch data loaded yet. Enter a batch ID and fetch it from the deployed contract.</p>
          )}

          <div className="actionPanel">
            <h3>Create batch</h3>
            <label>
              Memo
              <input value={memoInput} onChange={(event) => setMemoInput(event.target.value)} />
            </label>
            <label>
              Token contract
              <input value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} placeholder="Token contract address" />
            </label>
            <label>
              Stats contract
              <input value={statsContractInput} onChange={(event) => setStatsContractInput(event.target.value)} />
            </label>
            <label>
              Recipients (comma-separated)
              <textarea value={recipientsInput} onChange={(event) => setRecipientsInput(event.target.value)} placeholder="G...,G..." />
            </label>
            <label>
              Amounts (comma-separated)
              <textarea value={amountsInput} onChange={(event) => setAmountsInput(event.target.value)} placeholder="50,75" />
            </label>
            <button
              className="secondary"
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                console.log("[app] Create Batch button clicked");
                void handleCreateBatch();
              }}
              disabled={isSubmitting}
            >
              {isSubmitting ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
              Create batch
            </button>
          </div>

          <div className="actionPanel">
            <h3>Batch actions</h3>
            <button className="secondary" type="button" onClick={handleFundBatch} disabled={isSubmitting || !batch}>
              {isSubmitting ? <Loader2 className="spin" size={18} /> : <ShieldCheck size={18} />}
              Fund batch
            </button>
            <button className="secondary" type="button" onClick={handleRefundPending} disabled={isSubmitting || !batch}>
              {isSubmitting ? <Loader2 className="spin" size={18} /> : <ShieldCheck size={18} />}
              Refund pending
            </button>
          </div>

          {batch?.payments?.length ? (
            <div className="actionPanel">
              <h3>Recipient payments</h3>
              {batch.payments.map((payment) => (
                <div className="paymentRow" key={`${payment.index}-${payment.recipient}`}>
                  <div>
                    <strong>{payment.recipient.slice(0, 12)}...</strong>
                    <p>Amount: {payment.amount} • {payment.status}</p>
                  </div>
                  <div className="paymentActions">
                    <button className="secondary compact" type="button" onClick={() => void handleMarkSent(payment.index)} disabled={isSubmitting}>
                      Mark sent
                    </button>
                    <button className="secondary compact" type="button" onClick={() => void handleMarkFailed(payment.index)} disabled={isSubmitting}>
                      Mark failed
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="panel events">
          <div className="panelTitle">
            <h2>Live events</h2>
            {isLoading ? <Loader2 className="spin" size={18} /> : <Clock size={18} />}
          </div>
          {error && <p className="error">{error}</p>}
          {!error && !isLoading && events.length === 0 && (
            <p className="empty">No payment events found yet. The contract is connected, but no events have been emitted on testnet yet.</p>
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
