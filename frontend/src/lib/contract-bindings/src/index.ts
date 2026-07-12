import { Buffer } from "buffer";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type { u32, i128 } from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  // @ts-expect-error Buffer exists in browser builds
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CBNNUFSTMHM6FHDBPAC4J3IRAO4TLYDCDFWKCYGGOWG76LY5QNXXKESB",
  }
} as const

export type DataKey = {tag: "NextId", values: void} | {tag: "Batch", values: readonly [u64]} | {tag: "Recipient", values: readonly [u64, u32]};


export interface PaymentBatch {
  failed_count: u32;
  funded: boolean;
  id: u64;
  memo: string;
  recipient_count: u32;
  refunded: boolean;
  sender: string;
  sent_count: u32;
  stats_contract: string;
  token: string;
  total_amount: i128;
}

export const TrackerError = {
  1: {message:"MissingBatch"},
  2: {message:"Unauthorized"},
  3: {message:"AlreadyFunded"},
  4: {message:"NotFunded"},
  5: {message:"AlreadyFinal"},
  6: {message:"InvalidInput"},
  7: {message:"MissingRecipient"},
  8: {message:"AlreadyRefunded"}
}

export type PaymentStatus = {tag: "Pending", values: void} | {tag: "Sent", values: void} | {tag: "Failed", values: void} | {tag: "Refunded", values: void};


export interface RecipientPayment {
  amount: i128;
  batch_id: u64;
  index: u32;
  note: string;
  recipient: string;
  status: PaymentStatus;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface Client {
  /**
   * Construct and simulate a get_batch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_batch: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<PaymentBatch>>>

  /**
   * Construct and simulate a mark_sent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  mark_sent: ({id, index, tx_ref}: {id: u64, index: u32, tx_ref: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a fund_batch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  fund_batch: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_payment transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_payment: ({id, index}: {id: u64, index: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<RecipientPayment>>>

  /**
   * Construct and simulate a mark_failed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  mark_failed: ({id, index, reason}: {id: u64, index: u32, reason: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_batch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  create_batch: ({sender, token, stats_contract, memo, recipients, amounts}: {sender: string, token: string, stats_contract: string, memo: string, recipients: Array<string>, amounts: Array<i128>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a refund_pending transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  refund_pending: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

}
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAAwAAAAAAAAAAAAAABk5leHRJZAAAAAAAAQAAAAAAAAAFQmF0Y2gAAAAAAAABAAAABgAAAAEAAAAAAAAACVJlY2lwaWVudAAAAAAAAAIAAAAGAAAABA==",
        "AAAAAQAAAAAAAAAAAAAADFBheW1lbnRCYXRjaAAAAAsAAAAAAAAADGZhaWxlZF9jb3VudAAAAAQAAAAAAAAABmZ1bmRlZAAAAAAAAQAAAAAAAAACaWQAAAAAAAYAAAAAAAAABG1lbW8AAAAQAAAAAAAAAA9yZWNpcGllbnRfY291bnQAAAAABAAAAAAAAAAIcmVmdW5kZWQAAAABAAAAAAAAAAZzZW5kZXIAAAAAABMAAAAAAAAACnNlbnRfY291bnQAAAAAAAQAAAAAAAAADnN0YXRzX2NvbnRyYWN0AAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAADHRvdGFsX2Ftb3VudAAAAAs=",
        "AAAABAAAAAAAAAAAAAAADFRyYWNrZXJFcnJvcgAAAAgAAAAAAAAADE1pc3NpbmdCYXRjaAAAAAEAAAAAAAAADFVuYXV0aG9yaXplZAAAAAIAAAAAAAAADUFscmVhZHlGdW5kZWQAAAAAAAADAAAAAAAAAAlOb3RGdW5kZWQAAAAAAAAEAAAAAAAAAAxBbHJlYWR5RmluYWwAAAAFAAAAAAAAAAxJbnZhbGlkSW5wdXQAAAAGAAAAAAAAABBNaXNzaW5nUmVjaXBpZW50AAAABwAAAAAAAAAPQWxyZWFkeVJlZnVuZGVkAAAAAAg=",
        "AAAAAgAAAAAAAAAAAAAADVBheW1lbnRTdGF0dXMAAAAAAAAEAAAAAAAAAAAAAAAHUGVuZGluZwAAAAAAAAAAAAAAAARTZW50AAAAAAAAAAAAAAAGRmFpbGVkAAAAAAAAAAAAAAAAAAhSZWZ1bmRlZA==",
        "AAAAAQAAAAAAAAAAAAAAEFJlY2lwaWVudFBheW1lbnQAAAAGAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAACGJhdGNoX2lkAAAABgAAAAAAAAAFaW5kZXgAAAAAAAAEAAAAAAAAAARub3RlAAAAEAAAAAAAAAAJcmVjaXBpZW50AAAAAAAAEwAAAAAAAAAGc3RhdHVzAAAAAAfQAAAADVBheW1lbnRTdGF0dXMAAAA=",
        "AAAAAAAAAAAAAAAJZ2V0X2JhdGNoAAAAAAAAAQAAAAAAAAACaWQAAAAAAAYAAAABAAAD6QAAB9AAAAAMUGF5bWVudEJhdGNoAAAH0AAAAAxUcmFja2VyRXJyb3I=",
        "AAAAAAAAAAAAAAAJbWFya19zZW50AAAAAAAAAwAAAAAAAAACaWQAAAAAAAYAAAAAAAAABWluZGV4AAAAAAAABAAAAAAAAAAGdHhfcmVmAAAAAAAQAAAAAQAAA+kAAAACAAAH0AAAAAxUcmFja2VyRXJyb3I=",
        "AAAAAAAAAAAAAAAKZnVuZF9iYXRjaAAAAAAAAQAAAAAAAAACaWQAAAAAAAYAAAABAAAD6QAAAAIAAAfQAAAADFRyYWNrZXJFcnJvcg==",
        "AAAAAAAAAAAAAAALZ2V0X3BheW1lbnQAAAAAAgAAAAAAAAACaWQAAAAAAAYAAAAAAAAABWluZGV4AAAAAAAABAAAAAEAAAPpAAAH0AAAABBSZWNpcGllbnRQYXltZW50AAAH0AAAAAxUcmFja2VyRXJyb3I=",
        "AAAAAAAAAAAAAAALbWFya19mYWlsZWQAAAAAAwAAAAAAAAACaWQAAAAAAAYAAAAAAAAABWluZGV4AAAAAAAABAAAAAAAAAAGcmVhc29uAAAAAAAQAAAAAQAAA+kAAAACAAAH0AAAAAxUcmFja2VyRXJyb3I=",
        "AAAAAAAAAAAAAAAMY3JlYXRlX2JhdGNoAAAABgAAAAAAAAAGc2VuZGVyAAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAADnN0YXRzX2NvbnRyYWN0AAAAAAATAAAAAAAAAARtZW1vAAAAEAAAAAAAAAAKcmVjaXBpZW50cwAAAAAD6gAAABMAAAAAAAAAB2Ftb3VudHMAAAAD6gAAAAsAAAABAAAD6QAAAAYAAAfQAAAADFRyYWNrZXJFcnJvcg==",
        "AAAAAAAAAAAAAAAOcmVmdW5kX3BlbmRpbmcAAAAAAAEAAAAAAAAAAmlkAAAAAAAGAAAAAQAAA+kAAAALAAAH0AAAAAxUcmFja2VyRXJyb3I=" ]),
      options
    )
  }
  public readonly fromJSON = {
    get_batch: (this as unknown as ContractClient).txFromJSON<Result<PaymentBatch>>,
    mark_sent: (this as unknown as ContractClient).txFromJSON<Result<void>>,
    fund_batch: (this as unknown as ContractClient).txFromJSON<Result<void>>,
    get_payment: (this as unknown as ContractClient).txFromJSON<Result<RecipientPayment>>,
    mark_failed: (this as unknown as ContractClient).txFromJSON<Result<void>>,
    create_batch: (this as unknown as ContractClient).txFromJSON<Result<u64>>,
    refund_pending: (this as unknown as ContractClient).txFromJSON<Result<i128>>,
  }
}