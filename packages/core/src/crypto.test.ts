import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, parseEncryptionKey, sha256Hex } from "./crypto";

const key = randomBytes(32);

describe("secret encryption", () => {
  it("round-trips a secret", () => {
    const encrypted = encryptSecret("token-value", key);
    expect(encrypted.startsWith("v1:")).toBe(true);
    expect(encrypted).not.toContain("token-value");
    expect(decryptSecret(encrypted, key)).toBe("token-value");
  });

  it("uses a fresh IV per encryption", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it("rejects tampered ciphertext", () => {
    const [v, iv, tag, data] = encryptSecret("token-value", key).split(":");
    const flipped = Buffer.from(data!, "base64");
    flipped[0] = flipped[0]! ^ 0xff;
    expect(() => decryptSecret([v, iv, tag, flipped.toString("base64")].join(":"), key)).toThrow();
  });

  it("rejects the wrong key", () => {
    const encrypted = encryptSecret("token-value", key);
    expect(() => decryptSecret(encrypted, randomBytes(32))).toThrow();
  });

  it("validates key length", () => {
    expect(() => parseEncryptionKey(Buffer.alloc(16).toString("base64"))).toThrow();
    expect(parseEncryptionKey(key.toString("base64"))).toHaveLength(32);
  });

  it("hashes deterministically", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
