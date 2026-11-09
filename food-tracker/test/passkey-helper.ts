// A software passkey for tests: makes the same registration and sign-in responses a phone's
// Face ID passkey would, with a P-256 key and "none" attestation.
import { encodeCBOR } from "@levischuck/tiny-cbor";

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4)), (c) => c.charCodeAt(0));
const sha256 = async (data: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", data));
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) (out.set(p, i), (i += p.length));
  return out;
};

/** A raw ECDSA signature (r || s) as the DER that WebAuthn uses. */
function derSignature(raw: Uint8Array) {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let v = b.slice(i);
    if (v[0] & 0x80) v = concat(new Uint8Array([0]), v);
    return concat(new Uint8Array([0x02, v.length]), v);
  };
  const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concat(new Uint8Array([0x30, body.length]), body);
}

export async function softPasskey(origin = "https://food.example.com") {
  const rpId = new URL(origin).hostname;
  const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey;
  const credId = crypto.getRandomValues(new Uint8Array(16));
  let counter = 0;

  const authData = async (flags: number, attested?: Uint8Array) => {
    const count = new Uint8Array(4);
    new DataView(count.buffer).setUint32(0, counter);
    return concat(await sha256(new TextEncoder().encode(rpId)), new Uint8Array([flags]), count, attested ?? new Uint8Array());
  };
  const clientData = (type: string, challenge: string, at = origin) =>
    new TextEncoder().encode(JSON.stringify({ type, challenge, origin: at, crossOrigin: false }));

  return {
    id: b64url(credId),
    /** navigator.credentials.create() as JSON, for these options. */
    async register(options: { challenge: string }, at = origin) {
      const cose = new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, fromB64url(jwk.x!)],
        [-3, fromB64url(jwk.y!)],
      ]);
      const idLen = new Uint8Array([0, credId.length]);
      const attested = concat(new Uint8Array(16), idLen, credId, new Uint8Array(encodeCBOR(cose as never)));
      // User present, user verified, backed up and eligible, attested credential data.
      const data = await authData(0x01 | 0x04 | 0x08 | 0x10 | 0x40, attested);
      const attestation = encodeCBOR(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", data]]) as never);
      return {
        id: b64url(credId),
        rawId: b64url(credId),
        type: "public-key",
        clientExtensionResults: {},
        response: { clientDataJSON: b64url(clientData("webauthn.create", options.challenge, at)), attestationObject: b64url(new Uint8Array(attestation)), transports: ["internal", "hybrid"] },
      };
    },
    /** navigator.credentials.get() as JSON, for these options. */
    async signIn(options: { challenge: string }, at = origin) {
      counter += 1;
      const data = await authData(0x01 | 0x04 | 0x08 | 0x10);
      const client = clientData("webauthn.get", options.challenge, at);
      const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, concat(data, await sha256(client))));
      return {
        id: b64url(credId),
        rawId: b64url(credId),
        type: "public-key",
        clientExtensionResults: {},
        response: { clientDataJSON: b64url(client), authenticatorData: b64url(data), signature: b64url(derSignature(raw)) },
      };
    },
  };
}
