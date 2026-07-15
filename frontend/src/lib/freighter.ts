import {
  getAddress,
  getNetworkDetails,
  isConnected,
  signTransaction,
  requestAccess
} from "@stellar/freighter-api";
import { Networks } from "@stellar/stellar-sdk";

export type WalletConnectionResult =
  | {
      address: string;
      network: string;
      networkPassphrase: string;
      error?: undefined;
    }
  | {
      address: "";
      network: "";
      networkPassphrase: "";
      error: string;
    };

export type WalletSession = {
  address: string;
  networkPassphrase: string;
  connected: boolean;
};

function formatFreighterError(error: unknown) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }

  return "Unable to connect to Freighter.";
}

function isRejectedFreighterError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;

  return (
    code === -4 ||
    (typeof message === "string" && message.toLowerCase().includes("rejected"))
  );
}

export async function connectWallet(): Promise<WalletConnectionResult> {
  const status = await isConnected();
  if (status.error) {
    return {
      address: "",
      network: "",
      networkPassphrase: "",
      error: "Freighter could not be reached. Make sure the extension is installed, enabled, and unlocked."
    };
  }

  if (!status.isConnected) {
    return {
      address: "",
      network: "",
      networkPassphrase: "",
      error: "Freighter is installed but locked or not connected. Unlock it, then try again."
    };
  }

  const access = await requestAccess();
  if (access.error) {
    return {
      address: "",
      network: "",
      networkPassphrase: "",
      error: isRejectedFreighterError(access.error)
        ? "Wallet access was rejected."
        : formatFreighterError(access.error)
    };
  }

  const networkDetails = await getNetworkDetails();

  if (networkDetails.error) {
    return {
      address: "",
      network: "",
      networkPassphrase: "",
      error: formatFreighterError(networkDetails.error)
    };
  }

  const expectedPassphrase = Networks.TESTNET;

  const networkMatches =
    networkDetails.network === "TESTNET" ||
    networkDetails.networkPassphrase === expectedPassphrase ||
    networkDetails.network.toUpperCase() === "TESTNET";

  if (!networkMatches) {
    return {
      address: "",
      network: "",
      networkPassphrase: "",
      error: "Switch Freighter to Testnet and try again."
    };
  }

  const address = access.address || (await getAddress()).address;
  if (!address) {
    return {
      address: "",
      network: "",
      networkPassphrase: "",
      error: "Freighter did not return an account address."
    };
  }

  return {
    address,
    network: networkDetails.network,
    networkPassphrase: networkDetails.networkPassphrase
  };
}

export async function getActiveWalletAddress() {
  const session = await getActiveWalletSession();
  return session.address;
}

export async function getActiveWalletSession(): Promise<WalletSession> {
  const status = await isConnected();
  if (status.error || !status.isConnected) {
    return { address: "", networkPassphrase: "", connected: false };
  }

  const addressResponse = await getAddress();
  if (addressResponse.error || !addressResponse.address) {
    return { address: "", networkPassphrase: "", connected: false };
  }

  const networkDetails = await getNetworkDetails();
  if (networkDetails.error) {
    return { address: addressResponse.address, networkPassphrase: "", connected: false };
  }

  const networkMatches =
    networkDetails.network === "TESTNET" ||
    networkDetails.networkPassphrase === Networks.TESTNET ||
    networkDetails.network.toUpperCase() === "TESTNET";

  if (!networkMatches) {
    return { address: addressResponse.address, networkPassphrase: "", connected: false };
  }

  return {
    address: addressResponse.address,
    networkPassphrase: networkDetails.networkPassphrase,
    connected: true
  };
}

export async function signTransactionWithFreighter(
  transactionXdr: string,
  session: WalletSession
) {
  return signTransaction(transactionXdr, {
    address: session.address,
    networkPassphrase: session.networkPassphrase
  });
}
