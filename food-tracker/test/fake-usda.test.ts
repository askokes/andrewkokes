import { describe, expect, it } from "vitest";
import { createFakeUsda } from "./fixtures/usda/fake-fetch";

describe("fake USDA (test fixture sanity)", () => {
  it("serves search, bulk foods and errors like the real API", async () => {
    const usda = createFakeUsda();
    const search = await (await usda.fetch("https://api.nal.usda.gov/fdc/v1/foods/search?query=Chicken%20Breast&dataType=Foundation,SR%20Legacy&pageSize=10&api_key=k")).json<{ foods: { fdcId: number }[] }>();
    expect(search.foods.length).toBeGreaterThan(0);
    const bulk = await (await usda.fetch("https://api.nal.usda.gov/fdc/v1/foods?fdcIds=171477,173944,1&format=full&api_key=k")).json<unknown[]>();
    expect(bulk).toHaveLength(2);
    expect((await usda.fetch("https://api.nal.usda.gov/fdc/v1/foods?fdcIds=1")).status).toBe(403);
    expect(usda.calls[0]).toContain("api_key=***");
    usda.options.rateLimited = true;
    expect((await usda.fetch("https://api.nal.usda.gov/fdc/v1/food/171477?api_key=k")).status).toBe(429);
  });
});
