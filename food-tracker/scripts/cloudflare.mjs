// Shared Cloudflare API helpers for the setup scripts. No dependencies.

import { readFile, writeFile } from "node:fs/promises";

const API = process.env.CF_API_BASE ?? "https://api.cloudflare.com/client/v4";
export const CONFIG_PATH = new URL("../wrangler.jsonc", import.meta.url);

const APP_NAME = "Food Tracker";
const POLICY_NAME = "Food Tracker: allowed people";

export class SetupError extends Error {}

export function client(token) {
  return async function cf(method, path, body) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      const errs = (json.errors ?? []).map((e) => `${e.code}: ${e.message}`).join("; ");
      const hint =
        res.status === 401 || res.status === 403
          ? " The API token is missing a permission or was pasted wrong."
          : "";
      throw new SetupError(`${method} ${path} failed (${res.status}) ${errs}.${hint}`);
    }
    return json.result;
  };
}

export function parseEmails(raw) {
  const emails = (raw ?? "")
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length === 0) throw new SetupError("Enter at least one email.");
  const bad = emails.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (bad.length) throw new SetupError(`These don't look like emails: ${bad.join(", ")}`);
  return [...new Set(emails)];
}

/** One-time PIN login, an allow policy for the emails, and the Access app. Safe to re-run. */
export async function ensureAccess(cf, account, hostname, emails) {
  const base = `/accounts/${account}/access`;

  const org = await cf("GET", `${base}/organizations`).catch(() => null);
  const teamDomain = org?.auth_domain;
  if (!teamDomain) {
    throw new SetupError(
      "Zero Trust isn't set up yet. Open https://one.dash.cloudflare.com, pick a team name and the Free plan, then run this again.",
    );
  }

  const idps = await cf("GET", `${base}/identity_providers`);
  let otp = idps.find((p) => p.type === "onetimepin");
  if (!otp) otp = await cf("POST", `${base}/identity_providers`, { name: "One-time PIN", type: "onetimepin", config: {} });

  const policyBody = {
    name: POLICY_NAME,
    decision: "allow",
    include: emails.map((email) => ({ email: { email } })),
    session_duration: "720h",
  };
  const policies = await cf("GET", `${base}/policies`);
  const oldPolicy = policies.find((p) => p.name === POLICY_NAME);
  const policy = oldPolicy
    ? await cf("PUT", `${base}/policies/${oldPolicy.id}`, policyBody)
    : await cf("POST", `${base}/policies`, policyBody);

  const appBody = {
    name: APP_NAME,
    type: "self_hosted",
    domain: hostname,
    session_duration: "720h",
    // Keep the sign-in cookie off requests that other sites start, such as a
    // form posted to /api from another page. Links into the app still work.
    same_site_cookie_attribute: "lax",
    allowed_idps: [otp.id],
    auto_redirect_to_identity: true,
    app_launcher_visible: false,
    policies: [{ id: policy.id, precedence: 1 }],
  };
  const apps = await cf("GET", `${base}/apps`);
  const oldApp = apps.find((a) => a.domain === hostname || a.name === APP_NAME);
  const app = oldApp
    ? await cf("PUT", `${base}/apps/${oldApp.id}`, appBody)
    : await cf("POST", `${base}/apps`, appBody);
  if (!app?.aud) throw new SetupError("Access app saved but no AUD tag came back. Copy it from the Zero Trust dashboard.");

  return { teamDomain, aud: app.aud };
}

/** Finds or creates the D1 database and returns its id. */
export async function ensureDatabase(cf, account, name) {
  const existing = await cf("GET", `/accounts/${account}/d1/database?name=${encodeURIComponent(name)}`);
  const match = existing.find((db) => db.name === name);
  if (match) return match.uuid;
  const created = await cf("POST", `/accounts/${account}/d1/database`, { name });
  return created.uuid;
}

export async function readConfig() {
  const text = await readFile(CONFIG_PATH, "utf8");
  const host = text.match(/"pattern":\s*"([^"]+)"/)?.[1];
  const dbName = text.match(/"database_name":\s*"([^"]+)"/)?.[1];
  return { host, dbName };
}

/** Rewrites only the given string values in wrangler.jsonc, leaving comments intact. */
export async function patchConfig(values) {
  let text = await readFile(CONFIG_PATH, "utf8");
  for (const [key, value] of Object.entries(values)) {
    const re = new RegExp(`("${key}":\\s*)"[^"]*"`);
    if (!re.test(text)) throw new SetupError(`Couldn't find ${key} in wrangler.jsonc`);
    text = text.replace(re, `$1"${value}"`);
  }
  await writeFile(CONFIG_PATH, text);
}
