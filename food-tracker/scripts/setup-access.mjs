#!/usr/bin/env node
// Creates (or updates) the Cloudflare Access app that guards the food tracker,
// then writes ACCESS_TEAM_DOMAIN and ACCESS_AUD into wrangler.jsonc.
//
// Usage:
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
//   ALLOWED_EMAILS="you@example.com,her@example.com" \
//   node scripts/setup-access.mjs [hostname]
//
// Token permissions: Account > Access: Apps and Policies > Edit,
// and Account > Access: Organizations, Identity Providers, and Groups > Edit.
// Safe to re-run: it updates the existing app and policy instead of duplicating.

import { readFile, writeFile } from "node:fs/promises";

const API = process.env.CF_API_BASE ?? "https://api.cloudflare.com/client/v4";
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const hostname = (process.argv[2] ?? "food.pivotaiglobal.com").toLowerCase();
const emails = (process.env.ALLOWED_EMAILS ?? "")
  .split(/[,\s]+/)
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const APP_NAME = "Food Tracker";
const POLICY_NAME = "Food Tracker: allowed people";

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

if (!token || !account) fail("Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.");
if (emails.length === 0) fail('Set ALLOWED_EMAILS, e.g. ALLOWED_EMAILS="a@x.com,b@y.com".');
const bad = emails.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
if (bad.length) fail(`These don't look like emails: ${bad.join(", ")}`);

async function cf(method, path, body) {
  const res = await fetch(`${API}/accounts/${account}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const errs = (json.errors ?? []).map((e) => `${e.code}: ${e.message}`).join("; ");
    fail(`${method} ${path} failed (${res.status}) ${errs}`);
  }
  return json.result;
}

// 1. Team domain. Exists once Zero Trust has been opened and a team name chosen.
const org = await cf("GET", "/access/organizations");
const teamDomain = org?.auth_domain;
if (!teamDomain) fail("No Zero Trust team yet. Open one.dash.cloudflare.com once, pick a team name, then re-run.");
console.log(`✓ Team domain: ${teamDomain}`);

// 2. One-time PIN login.
const idps = await cf("GET", "/access/identity_providers");
let otp = idps.find((p) => p.type === "onetimepin");
if (!otp) otp = await cf("POST", "/access/identity_providers", { name: "One-time PIN", type: "onetimepin", config: {} });
console.log("✓ One-time PIN login enabled");

// 3. Reusable allow policy with the email list.
const policyBody = {
  name: POLICY_NAME,
  decision: "allow",
  include: emails.map((email) => ({ email: { email } })),
  session_duration: "720h",
};
const policies = await cf("GET", "/access/policies");
const existingPolicy = policies.find((p) => p.name === POLICY_NAME);
const policy = existingPolicy
  ? await cf("PUT", `/access/policies/${existingPolicy.id}`, policyBody)
  : await cf("POST", "/access/policies", policyBody);
console.log(`✓ Allowed: ${emails.join(", ")}`);

// 4. Self-hosted app on the subdomain.
const appBody = {
  name: APP_NAME,
  type: "self_hosted",
  domain: hostname,
  session_duration: "720h",
  allowed_idps: [otp.id],
  auto_redirect_to_identity: true,
  app_launcher_visible: false,
  policies: [{ id: policy.id, precedence: 1 }],
};
const apps = await cf("GET", "/access/apps");
const existingApp = apps.find((a) => a.domain === hostname || a.name === APP_NAME);
const app = existingApp
  ? await cf("PUT", `/access/apps/${existingApp.id}`, appBody)
  : await cf("POST", "/access/apps", appBody);
if (!app?.aud) fail("Access app saved but no AUD tag came back. Copy it from the dashboard instead.");
console.log(`✓ Access app guards https://${hostname}`);

// 5. Write the two values the Worker needs.
const configPath = new URL("../wrangler.jsonc", import.meta.url);
let config = await readFile(configPath, "utf8");
config = config
  .replace(/("ACCESS_TEAM_DOMAIN":\s*)"[^"]*"/, `$1"${teamDomain}"`)
  .replace(/("ACCESS_AUD":\s*)"[^"]*"/, `$1"${app.aud}"`);
await writeFile(configPath, config);
console.log(`✓ wrangler.jsonc updated (ACCESS_TEAM_DOMAIN, ACCESS_AUD = ${app.aud})\n`);
