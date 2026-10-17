#!/usr/bin/env node
// Lets the Apple Watch Shortcut through Access to its one sync path
// (scripts/cloudflare.mjs ensureWatchSync). The deploy workflow runs it with
// the invite key, which may edit Access apps and policies. Safe to run again.

import { client, ensureWatchSync, readConfig, SetupError, WATCH_SYNC_PATH } from "./cloudflare.mjs";

async function main() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new SetupError("Set CLOUDFLARE_API_TOKEN to a key that may edit Access apps and policies.");
  const cf = client(token);
  const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? (await cf("GET", "/accounts"))[0]?.id;
  if (!account) throw new SetupError("This key can't see any account.");
  const { host } = await readConfig();
  await ensureWatchSync(cf, account, host);
  console.log(`✓ The Apple Watch Shortcut can reach ${host}${WATCH_SYNC_PATH}`);
}

main().catch((err) => {
  console.error(`✗ ${err instanceof SetupError ? err.message : err?.stack ?? err}`);
  process.exit(1);
});
