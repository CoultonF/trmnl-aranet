export interface TokenProtector {
  encrypt(value: string): Promise<string>;
  decrypt(value: string): Promise<string>;
}
export function createTokenProtector(key: Uint8Array): TokenProtector {
  if (key.byteLength !== 32) {
    throw new Error("DATA_ENCRYPTION_KEY must decode to 32 bytes");
  }

  const keyBytes = new Uint8Array(key.byteLength);
  keyBytes.set(key);
  const importedKey = crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);

  return {
    async encrypt(value) {
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: nonce },
        await importedKey,
        new TextEncoder().encode(value),
      );
      return `${Buffer.from(nonce).toString("base64url")}.${Buffer.from(ciphertext).toString("base64url")}`;
    },

    async decrypt(value) {
      const [encodedNonce, encodedCiphertext, extra] = value.split(".");
      if (!encodedNonce || !encodedCiphertext || extra !== undefined) {
        throw new Error("Invalid encrypted token");
      }

      const plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: new Uint8Array(Buffer.from(encodedNonce, "base64url")),
        },
        await importedKey,
        new Uint8Array(Buffer.from(encodedCiphertext, "base64url")),
      );
      return new TextDecoder().decode(plaintext);
    },
  };
}

export async function hashAccessToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Buffer.from(digest).toString("hex");
}
