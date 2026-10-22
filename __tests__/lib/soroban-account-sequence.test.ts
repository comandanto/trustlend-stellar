import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/stellar/wallet", () => ({ signTransactionWithWallet: vi.fn() }));
vi.mock("@/lib/services/redis", () => ({ redis: null }));

import { Keypair } from "@stellar/stellar-sdk";
import { getAccountSequence, HORIZON_URL } from "@/lib/stellar/soroban";

describe("getAccountSequence", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the sequence for a valid Stellar address", async () => {
    const address = Keypair.random().publicKey();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ sequence: "123456789" }),
    } as Response);

    await expect(getAccountSequence(address)).resolves.toBe("123456789");
    expect(fetch).toHaveBeenCalledWith(`${HORIZON_URL}/accounts/${address}`);
  });

  it.each([
    "",
    "not-an-address",
    "../../admin",
    "GABC/../../evil",
    "CCLVI2JGD7PUV75VHOLTUZF3CVXYBUTOSLKNLHEUUFXOY73BFXUEVEMO", // contract id, not an account
    Keypair.random().publicKey().slice(0, 55), // truncated
    `${Keypair.random().publicKey()}?x=1`,
  ])("rejects malformed address %j without making a request", async (address) => {
    await expect(getAccountSequence(address)).rejects.toThrow(/Invalid Stellar account address/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects non-string input", async () => {
    await expect(getAccountSequence(undefined as unknown as string)).rejects.toThrow(
      /Invalid Stellar account address/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports an unfunded account on 404", async () => {
    const address = Keypair.random().publicKey();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404, statusText: "Not Found" } as Response);

    await expect(getAccountSequence(address)).rejects.toThrow(/not found on Stellar network/);
  });
});
