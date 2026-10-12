// Local development entry point: the real app, with USDA replaced by recorded
// fixtures so the UI can be exercised without an API key or rate limits, and
// Cloudflare's Access API by an in-memory policy so invites can be tried
// without touching who can really sign in.
// Used only by `npm run dev:mock`; production deploys src/index.ts.
import { createFakeUsda } from "../test/fixtures/usda/fake-fetch";
import { createApp } from "./app";
import type { Env } from "./env";
import { ALLOWED_POLICY } from "./invites";

const policy = { id: "dev", name: ALLOWED_POLICY, decision: "allow", include: [{ email: { email: "andrew@example.com" } }] as unknown[] };
const fakeCloudflare: typeof fetch = async (input, init) => {
  if ((init?.method ?? "GET") === "PUT") Object.assign(policy, JSON.parse(String(init?.body)));
  return Response.json({ success: true, result: String(input).endsWith("/policies") ? [policy] : policy });
};

const app = createApp({ usdaFetch: createFakeUsda().fetch, cfFetch: fakeCloudflare });

export default {
  fetch(request, env, ctx) {
    // The fakes accept any key, so no real one is needed (or sent anywhere) here. The dev user may invite.
    return app.fetch(
      request,
      {
        ...env,
        USDA_API_KEY: env.USDA_API_KEY || "dev-mock",
        ACCESS_INVITE_TOKEN: "dev-mock",
        CF_ACCOUNT_ID: "dev",
        ADMIN_EMAILS: [env.ADMIN_EMAILS, env.DEV_USER_EMAIL].filter(Boolean).join(","),
      },
      ctx,
    );
  },
} satisfies ExportedHandler<Env>;
