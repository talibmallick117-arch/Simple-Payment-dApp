import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";

const mockCreateBatchTx = {
  result: {
    unwrap: () => 5n
  },
  simulation: {
    result: { ok: true }
  },
  signAndSend: vi.fn(async ({ signTransaction }: { signTransaction: (transactionXdr: string, opts?: { address?: string; networkPassphrase?: string }) => Promise<{ signedTxXdr: string; signerAddress?: string; error?: unknown }> }) => {
    const signed = await signTransaction("BASE_XDR", {
      address: "GBTESTSIGNER",
      networkPassphrase: "Test SDF Network ; September 2015"
    });

    expect(signed.signedTxXdr).toBe("SIGNED_XDR");
    return {
      result: {
        unwrap: () => 5n
      },
      sendTransactionResponse: { hash: "abc123" },
      getTransactionResponse: { txHash: "abc123" }
    };
  })
};

vi.mock("./stellar", () => ({
  normalizeContractId: (value: string | undefined) => (typeof value === "string" ? value.trim().replace(/^(['"])(.*)\1$/, "$2").trim() : ""),
  isValidContractId: (value: string | undefined) =>
    typeof value === "string" &&
    Boolean(value.trim().replace(/^(['"])(.*)\1$/, "$2").trim()) &&
    value.trim().replace(/^(['"])(.*)\1$/, "$2").trim().startsWith("C"),
  config: {
    rpcUrl: "https://soroban-testnet.stellar.org",
    paymentTrackerContractId: "CBNNUFSTMHM6FHDBPAC4J3IRAO4TLYDCDFWKCYGGOWG76LY5QNXXKESB",
    paymentStatsContractId: "CBCSQQXQF4LDFXFZ7MRLPYHVOJGLYVVVOLUCNWF42AXQ4YCAJ4LBJQRM",
    paymentTokenContractId: "CBNNUFSTMHM6FHDBPAC4J3IRAO4TLYDCDFWKCYGGOWG76LY5QNXXKESB"
  }
}));

vi.mock("./freighter", () => ({
  signTransactionWithFreighter: vi.fn(async () => ({
    signedTxXdr: "SIGNED_XDR",
    signerAddress: "GBTESTSIGNER"
  }))
}));

vi.mock("@stellar/stellar-sdk/rpc", () => ({
  Server: vi.fn().mockImplementation(() => ({
    getAccount: vi.fn(async () => ({ sequence: "1" }))
  }))
}));

vi.mock("./contract-bindings/src", () => ({
  Client: vi.fn().mockImplementation(() => ({
    create_batch: vi.fn(async () => mockCreateBatchTx)
  })),
  networks: {
    testnet: {
      networkPassphrase: "Test SDF Network ; September 2015"
    }
  }
}));

import { createBatchOnContract, normalizeBatchFormValues, parseContractError, validateCreateBatchInput } from "./soroban";

const sender = Keypair.random().publicKey();
const recipient = Keypair.random().publicKey();
const tokenContract = "CBNNUFSTMHM6FHDBPAC4J3IRAO4TLYDCDFWKCYGGOWG76LY5QNXXKESB";
const statsContract = "CBCSQQXQF4LDFXFZ7MRLPYHVOJGLYVVVOLUCNWF42AXQ4YCAJ4LBJQRM";

describe("normalizeBatchFormValues", () => {
  it("falls back to a single recipient and amount when the form is empty", () => {
    const result = normalizeBatchFormValues("", "", "GTESTRECIPIENT", "1");

    expect(result.recipients).toEqual(["GTESTRECIPIENT"]);
    expect(result.amounts).toEqual(["1"]);
  });

  it("preserves explicit recipient and amount pairs", () => {
    const result = normalizeBatchFormValues("GONE,GTWO", "10,20", "GTESTRECIPIENT", "1");

    expect(result.recipients).toEqual(["GONE", "GTWO"]);
    expect(result.amounts).toEqual(["10", "20"]);
  });

  it("rejects invalid recipient addresses before building the transaction", () => {
    const result = validateCreateBatchInput({
      sender,
      token: tokenContract,
      statsContract,
      recipients: ["not-a-stellar-address"],
      amounts: ["10"]
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toMatch(/invalid recipient address/i);
    }
  });

  it("rejects non-positive or non-integer amounts", () => {
    const result = validateCreateBatchInput({
      sender,
      token: tokenContract,
      statsContract,
      recipients: [recipient],
      amounts: ["0"]
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toMatch(/positive whole number/i);
    }
  });

  it("normalizes quoted contract IDs before validating them", () => {
    const result = validateCreateBatchInput({
      sender,
      token: `  "${tokenContract}"  `,
      statsContract: ` '${statsContract}' `,
      recipients: [recipient],
      amounts: ["10"]
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.token).toBe(tokenContract);
      expect(result.statsContract).toBe(statsContract);
    }
  });

  it("maps txBadSeq errors to a readable message", () => {
    const result = parseContractError({
      result: {
        _switch: {
          name: "txBadSeq",
          value: -5
        }
      }
    });

    expect(result).toBe("Transaction sequence conflict. Please retry with a fresh transaction.");
  });

  it("maps txMalformed transaction results to a readable message", () => {
    const result = parseContractError({
      _attributes: {
        result: {
          _switch: {
            name: "txMalformed",
            value: 16
          }
        }
      }
    });

    expect(result).toBe("The transaction is malformed. Please rebuild and try again.");
  });

  it("submits Create Batch through signAndSend without rebuilding the XDR manually", async () => {
    const result = await createBatchOnContract({
      sender,
      token: tokenContract,
      statsContract,
      memo: "test batch",
      recipients: [recipient],
      amounts: ["10"],
      walletAddress: sender,
      networkPassphrase: "Test SDF Network ; September 2015"
    });

    expect(result.success).toBe(true);
    expect(result.id).toBe(5);
    expect(mockCreateBatchTx.signAndSend).toHaveBeenCalledTimes(1);
  });
});
