import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/** Returns the key set used to verify tokens from the given Access issuer. */
export type KeyResolver = (issuer: string) => JWTVerifyGetKey;

const jwksByIssuer = new Map<string, JWTVerifyGetKey>();

/** Fetches (and caches per isolate) the team's public signing keys. */
export const accessKeys: KeyResolver = (issuer) => {
  let jwks = jwksByIssuer.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksByIssuer.set(issuer, jwks);
  }
  return jwks;
};

/** Accepts "team", "team.cloudflareaccess.com" or "https://team.cloudflareaccess.com/". */
export function accessIssuer(teamDomain: string): string {
  const host = teamDomain
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  if (!host || /[\/\s]/.test(host)) throw new Error("ACCESS_TEAM_DOMAIN is not set or invalid");
  return `https://${host.includes(".") ? host : `${host}.cloudflareaccess.com`}`;
}

export interface VerifyOptions {
  teamDomain: string;
  aud: string;
  keys: KeyResolver;
}

/**
 * Verifies a Cf-Access-Jwt-Assertion token: signature against the team JWKS,
 * issuer, audience and expiry. Returns the user's email, lowercased.
 * Throws on any failure.
 */
export async function verifyAccessJwt(token: string, opts: VerifyOptions): Promise<string> {
  if (!opts.aud) throw new Error("ACCESS_AUD is not set");
  const issuer = accessIssuer(opts.teamDomain);
  const { payload } = await jwtVerify(token, opts.keys(issuer), {
    issuer,
    audience: opts.aud,
    algorithms: ["RS256"],
    requiredClaims: ["exp", "iat"],
    clockTolerance: 30,
  });
  const email = payload.email;
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw new Error("token has no user email");
  }
  return email.toLowerCase();
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Local dev bypass. Only honored when DEV_USER_EMAIL is set (it lives in
 * .dev.vars, which wrangler never uploads) AND the request was made to a
 * loopback host. A deployed Worker is only reachable on its custom domain,
 * so the second condition can never be true in production.
 */
export function devUserEmail(devEmail: string | undefined, requestUrl: string): string | null {
  if (!devEmail) return null;
  if (!LOCAL_HOSTS.has(new URL(requestUrl).hostname)) return null;
  return devEmail.trim().toLowerCase() || null;
}
