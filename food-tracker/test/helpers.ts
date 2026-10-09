import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";

export const ISSUER = "https://test-team.cloudflareaccess.com";
export const AUD = "test-aud";

export async function makeSigner(kid = "test-key") {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };

  async function sign(
    claims: Record<string, unknown> = { email: "Daughter@Example.com" },
    opts: { aud?: string; iss?: string; expiresIn?: string | number } = {},
  ) {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(opts.iss ?? ISSUER)
      .setAudience(opts.aud ?? AUD)
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? "10m")
      .sign(privateKey);
  }

  return { jwk, sign, keys: () => createLocalJWKSet({ keys: [jwk] }) };
}
