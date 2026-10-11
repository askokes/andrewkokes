import { describe, expect, it } from "vitest";
import { foodEmoji } from "../web/src/emoji";

describe("foodEmoji", () => {
  it.each([
    ["Eggs", "🥚"],
    ["Banana", "🍌"],
    ["Blue moon", "🍺"],
    ["Chicken breast", "🍗"],
    ["Strawberries", "🍓"],
    ["Potatoes", "🥔"],
    ["Toast", "🍞"],
  ])("%s is %s", (name, emoji) => {
    expect(foodEmoji(name)).toBe(emoji);
  });

  it("puts a dish before what's in it", () => {
    expect(foodEmoji("Pepperoni pizza")).toBe("🍕");
    expect(foodEmoji("Chicken salad")).toBe("🥗");
    expect(foodEmoji("Apple juice")).toBe("🧃");
    expect(foodEmoji("Cheeseburger")).toBe("🍔");
  });

  it("matches whole words only", () => {
    expect(foodEmoji("Watermelon")).toBe("🍉");
    expect(foodEmoji("Steak")).toBe("🥩");
    expect(foodEmoji("Dinner roll")).toBe("🍞");
    expect(foodEmoji("Dr pepper")).toBe("🥤");
  });

  it("falls back to the USDA description, then a plate", () => {
    expect(foodEmoji("Michelob", "Alcoholic beverage, beer, light, low carb")).toBe("🍺");
    expect(foodEmoji("Zorblax bar")).toBe("🍽️");
  });
});
