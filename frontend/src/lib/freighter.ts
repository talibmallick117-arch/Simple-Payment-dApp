import {
  getAddress,
  getNetworkDetails,
  isConnected,
  requestAccess
} from "@stellar/freighter-api";

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

function isFreighterInstalled() {
  return typeof window !== "undefined" && window.freighter === true;
}

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

export async function connectWallet(expectedNetwork = "testnet"): Promise<WalletConnectionResult> {
  if (!isFreighterInstalled()) {
    return {
      address: "",
      network: "",
      networkPassphrase: "",
      error: "Freighter is not installed."
    };
  }

  const status = await isConnected();
  if ("error" in status && status.error) {
    return {
      address: "",
      network: "",
      networkPassphrase: "",
      error: formatFreighterError(status.error)
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

  if (networkDetails.network !== expectedNetwork) {
    return {
      address: "",
      network: "",
      networkPassphrase: "",
      error: `Switch Freighter to ${expectedNetwork} and try again.`
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
  if (!isFreighterInstalled()) return "";

  const response = await getAddress();
  return response.error ? "" : response.address;
}

