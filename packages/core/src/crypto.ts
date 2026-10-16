import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for secrets at rest (for example, WhatsApp access tokens).
 * Format: "v1:<iv b64>:<auth tag b64>:<ciphertext b64>".
 */
const VERSION = "v1";
const IV_BYTES = 12;

export function parseEncryptionKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)");
  }
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(
    ":",
  );
}

export function decryptSecret(payload: string, key: Buffer): string {
  const [version, iv, tag, data] = payload.split(":");
  if (version !== VERSION || !iv || !tag || !data) {
    throw new Error("Unsupported or malformed secret payload");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString(
    "utf8",
  );
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}
