import { describe, expect, it } from "vitest";
import { normalizeBatchFormValues } from "./soroban";

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
});
