// Local development entry point: the real app, with USDA replaced by recorded
// fixtures so the UI can be exercised without an API key or rate limits.
// Used only by `npm run dev:mock`; production deploys src/index.ts.
import { createFakeUsda } from "../test/fixtures/usda/fake-fetch";
import { createApp } from "./app";

export default createApp({ usdaFetch: createFakeUsda().fetch });
