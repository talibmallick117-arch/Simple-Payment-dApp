export function shortenAddress(address: string) {
  if (address.length <= 8) {
    return address;
  }

  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export async function copyTextToClipboard(text: string) {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard access is not available in this browser.");
  }

  await navigator.clipboard.writeText(text);
}

export function buildStellarExpertAccountUrl(address: string) {
  return `https://stellar.expert/explorer/testnet/account/${address}`;
}

