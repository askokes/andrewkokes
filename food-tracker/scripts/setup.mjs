#!/usr/bin/env node
// One-command first deploy: `npm run setup`.
// Asks for the API token, who's allowed in, and the USDA key, then sets up
// Access, the database, deploys, and checks the site is live. Safe to re-run.

import { spawn } from "node:child_process";
import readline from "node:readline";
import { client, ensureAccess, ensureDatabase, parseEmails, patchConfig, readConfig, SetupError } from "./cloudflare.mjs";

const TOTAL = 7;
let stepNo = 0;
const step = (msg) => console.log(`\n[${++stepNo}/${TOTAL}] ${msg}`);
const ok = (msg) => console.log(`      ✓ ${msg}`);

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Show the prompt, swallow the typed or pasted characters.
      rl._writeToOutput = (s) => {
        if (s.includes(question)) rl.output.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

function run(command, env, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      env,
      stdio: [input === undefined ? "inherit" : "pipe", "inherit", "inherit"],
    });
    if (input !== undefined) child.stdin.end(`${input}\n`);
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new SetupError(`"${command}" failed (exit ${code}). See the output above.`))));
  });
}

async function waitForSite(host) {
  const deadline = Date.now() + 4 * 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`https://${host}/`, { redirect: "manual" });
      const location = res.headers.get("location") ?? "";
      if (res.status >= 300 && res.status < 400 && location.includes("cloudflareaccess.com")) return "guarded";
      if (res.status === 200) return "open";
    } catch {
      // DNS or certificate not ready yet.
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 10_000));
  }
  return "timeout";
}

async function main() {
  const [major] = process.versions.node.split(".").map(Number);
  if (major < 20) throw new SetupError(`Node 20 or newer is needed. You have ${process.versions.node}. Get it at https://nodejs.org`);

  const { host, dbName } = await readConfig();
  if (!host || !dbName) throw new SetupError("wrangler.jsonc is missing the route pattern or database_name.");
  const apex = host.split(".").slice(-2).join(".");

  console.log(`\nFood Tracker setup for https://${host}\nThree questions, then it runs on its own.\n`);

  const token = process.env.CLOUDFLARE_API_TOKEN || (await ask("1. Paste your Cloudflare API token (hidden): ", { hidden: true }));
  if (!token) throw new SetupError("No token entered.");
  const emails = parseEmails(
    process.env.ALLOWED_EMAILS || (await ask("2. Emails allowed in, separated by commas: ")),
  );
  const usdaKey =
    process.env.USDA_API_KEY || (await ask("3. USDA API key (hidden, press Enter to use DEMO_KEY): ", { hidden: true })) || "DEMO_KEY";

  const cf = client(token);

  step("Checking your Cloudflare account");
  let account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!account) {
    const accounts = await cf("GET", "/accounts");
    if (accounts.length === 0) throw new SetupError("This token can't see any account. Re-create it with the Workers template.");
    if (accounts.length === 1) {
      account = accounts[0].id;
    } else {
      accounts.forEach((a, i) => console.log(`      ${i + 1}. ${a.name}`));
      const pick = Number(await ask("      Which account? Enter the number: "));
      account = accounts[pick - 1]?.id;
      if (!account) throw new SetupError("That isn't one of the numbers listed.");
    }
  }
  ok("Token works");
  try {
    const zones = await cf("GET", `/zones?name=${apex}&account.id=${account}`);
    if (zones.length === 0) {
      throw new SetupError(`${apex} isn't a site in this Cloudflare account, so ${host} can't be created. Tell Claude.`);
    }
    if (zones[0].status !== "active") {
      throw new SetupError(`${apex} is in Cloudflare but its status is "${zones[0].status}", not active. Its nameservers haven't moved to Cloudflare yet.`);
    }
    ok(`${apex} is active on Cloudflare`);
  } catch (err) {
    if (err instanceof SetupError && /failed \((401|403)\)/.test(err.message)) {
      console.log(`      ! Couldn't check ${apex} with this token. Continuing; the deploy step will catch it if it's wrong.`);
    } else {
      throw err;
    }
  }

  step("Setting up sign-in (Cloudflare Access)");
  const { teamDomain, aud } = await ensureAccess(cf, account, host, emails);
  await patchConfig({ ACCESS_TEAM_DOMAIN: teamDomain, ACCESS_AUD: aud });
  ok(`One-time PIN login for: ${emails.join(", ")}`);

  step("Creating the database");
  const dbId = await ensureDatabase(cf, account, dbName);
  await patchConfig({ database_id: dbId });
  ok(`Database "${dbName}" ready`);

  const env = { ...process.env, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, CI: "true" };

  step("Building the app");
  await run("npm run build", env);

  step("Creating the database tables");
  await run("npx wrangler d1 migrations apply DB --remote", env);

  step(`Deploying to ${host}`);
  await run("npx wrangler deploy", env);
  await run("npx wrangler secret put USDA_API_KEY", env, usdaKey);
  ok("Deployed");

  step(`Waiting for https://${host} to come online (up to 4 minutes)`);
  const status = await waitForSite(host);
  console.log("");
  if (status === "guarded") {
    ok("Live, and it asks for sign-in");
    console.log(`\nDone. Open https://${host} on your phone and follow TESTING.md.`);
    console.log(`Then save the config:  git commit -am "Configure deploy" && git push\n`);
  } else if (status === "open") {
    throw new SetupError(`${host} loads WITHOUT asking for sign-in. Access isn't guarding it. Don't share the link; tell Claude.`);
  } else {
    console.log(`\n      ! Deployed, but ${host} isn't answering yet. New addresses can take a few more minutes.`);
    console.log(`      Try it on your phone in 5 minutes. If it still fails, run "npm run setup" again and send Claude the output.\n`);
  }
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof SetupError ? err.message : err?.stack ?? err}\n`);
  process.exit(1);
});
