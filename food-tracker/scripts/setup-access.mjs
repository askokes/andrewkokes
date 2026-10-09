#!/usr/bin/env node
// Changes who is allowed in, without redeploying: `npm run access`.
// Replaces the allow list with exactly the emails you enter.

import readline from "node:readline/promises";
import { client, ensureAccess, parseEmails, patchConfig, readConfig, SetupError } from "./cloudflare.mjs";

async function main() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new SetupError('Run this first: export CLOUDFLARE_API_TOKEN="your-token"');
  const cf = client(token);

  const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? (await cf("GET", "/accounts"))[0]?.id;
  if (!account) throw new SetupError("This token can't see any account.");

  const { host } = await readConfig();
  let raw = process.env.ALLOWED_EMAILS;
  if (!raw) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    raw = await rl.question("Everyone who should be allowed in, separated by commas: ");
    rl.close();
  }
  const emails = parseEmails(raw);

  const { teamDomain, aud } = await ensureAccess(cf, account, host, emails);
  await patchConfig({ ACCESS_TEAM_DOMAIN: teamDomain, ACCESS_AUD: aud });
  console.log(`\n✓ ${host} now allows: ${emails.join(", ")}\n`);
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof SetupError ? err.message : err?.stack ?? err}\n`);
  process.exit(1);
});
