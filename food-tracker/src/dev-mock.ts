// Local development entry point: the real app, with USDA replaced by recorded
// fixtures so the UI can be exercised without an API key or rate limits.
// Used only by `npm run dev:mock`; production deploys src/index.ts.
import { createFakeUsda } from "../test/fixtures/usda/fake-fetch";
import { createApp } from "./app";
import type { Env } from "./env";

const app = createApp({ usdaFetch: createFakeUsda().fetch });

export default {
  fetch(request, env, ctx) {
    // The fake accepts any key, so no real one is needed (or sent anywhere) here.
    return app.fetch(request, { ...env, USDA_API_KEY: env.USDA_API_KEY || "dev-mock" }, ctx);
  },
} satisfies ExportedHandler<Env>;
