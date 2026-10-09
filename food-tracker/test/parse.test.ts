import { describe, expect, it } from "vitest";
import { parseMeal } from "../src/food/parse";
import type { Meal, ParseResult, ParsedItem, SpokenUnit } from "../src/food/types";

const item = (quantity: number, unit: SpokenUnit | null, food: string, text: string): ParsedItem => ({
  quantity,
  unit,
  food,
  text,
});
const result = (meal: Meal | null, ...items: ParsedItem[]): ParseResult => ({ meal, items });
const one = (quantity: number, unit: SpokenUnit | null, food: string, text: string) =>
  result(null, item(quantity, unit, food, text));

type Case = [string, ParseResult];

describe("parseMeal: numbers", () => {
  it.each<Case>([
    ["six eggs", one(6, null, "eggs", "six eggs")],
    ["6 eggs", one(6, null, "eggs", "6 eggs")],
    ["twelve grapes", one(12, null, "grapes", "twelve grapes")],
    ["an egg", one(1, null, "egg", "an egg")],
    ["a banana", one(1, null, "banana", "a banana")],
    ["1.5 cups of rice", one(1.5, "cup", "rice", "1.5 cups of rice")],
    ["1/2 cup oatmeal", one(0.5, "cup", "oatmeal", "1/2 cup oatmeal")],
    ["1/2 cup of oatmeal", one(0.5, "cup", "oatmeal", "1/2 cup of oatmeal")],
    ["1 1/2 cups of milk", one(1.5, "cup", "milk", "1 1/2 cups of milk")],
    ["½ cup of blueberries", one(0.5, "cup", "blueberries", "½ cup of blueberries")],
    ["1½ cups of yogurt", one(1.5, "cup", "yogurt", "1½ cups of yogurt")],
    ["¾ cup granola", one(0.75, "cup", "granola", "¾ cup granola")],
    ["½ cup greek yogurt", one(0.5, "cup", "greek yogurt", "½ cup greek yogurt")],
    ["⅓ cup granola", one(1 / 3, "cup", "granola", "⅓ cup granola")],
    ["a 1/2 cup of rice", one(0.5, "cup", "rice", "a 1/2 cup of rice")],
    ["a half cup of rice", one(0.5, "cup", "rice", "a half cup of rice")],
    ["half a sandwich", one(0.5, null, "sandwich", "half a sandwich")],
    ["half an avocado", one(0.5, null, "avocado", "half an avocado")],
    ["half of a bagel", one(0.5, null, "bagel", "half of a bagel")],
    ["one and a half cups of rice", one(1.5, "cup", "rice", "one and a half cups of rice")],
    ["two and a half ounces of cheese", one(2.5, "oz", "cheese", "two and a half ounces of cheese")],
    ["1 and 1/2 tablespoons of honey", one(1.5, "tbsp", "honey", "1 and 1/2 tablespoons of honey")],
    ["a cup and a half of rice", one(1.5, "cup", "rice", "a cup and a half of rice")],
    ["a quarter cup of almonds", one(0.25, "cup", "almonds", "a quarter cup of almonds")],
    ["a third of a cup of granola", one(1 / 3, "cup", "granola", "a third of a cup of granola")],
    ["two thirds cup of oats", one(2 / 3, "cup", "oats", "two thirds cup of oats")],
    ["three quarters of a cup of milk", one(0.75, "cup", "milk", "three quarters of a cup of milk")],
    ["twenty five almonds", one(25, null, "almonds", "twenty five almonds")],
    ["twenty-two grapes", one(22, null, "grapes", "twenty-two grapes")],
    ["twenty-five almonds", one(25, null, "almonds", "twenty-five almonds")],
    ["a hundred grams of rice", one(100, "g", "rice", "a hundred grams of rice")],
    ["two hundred and fifty grams of chicken", one(250, "g", "chicken", "two hundred and fifty grams of chicken")],
    ["a dozen eggs", one(12, null, "eggs", "a dozen eggs")],
    ["half a dozen eggs", one(6, null, "eggs", "half a dozen eggs")],
    ["a couple of cookies", one(2, null, "cookies", "a couple of cookies")],
    ["a couple eggs", one(2, null, "eggs", "a couple eggs")],
    ["a couple of eggs", one(2, null, "eggs", "a couple of eggs")],
    ["a few crackers", one(3, null, "crackers", "a few crackers")],
    ["a few strawberries.", one(3, null, "strawberries", "a few strawberries")],
    // Ranges take the higher number.
    ["two or three cookies", one(3, null, "cookies", "two or three cookies")],
    ["2-3 eggs", one(3, null, "eggs", "2-3 eggs")],
    ["like 3 or 4 cookies", one(4, null, "cookies", "3 or 4 cookies")],
    ["1-1/2 cups of flour", one(1.5, "cup", "flour", "1-1/2 cups of flour")],
  ])("%j", (text, expected) => {
    expect(parseMeal(text)).toEqual(expected);
  });
});

describe("parseMeal: units", () => {
  it.each<Case>([
    ["6 oz chicken", one(6, "oz", "chicken", "6 oz chicken")],
    ["6oz steak", one(6, "oz", "steak", "6oz steak")],
    ["six ounces of chicken", one(6, "oz", "chicken", "six ounces of chicken")],
    ["1 ounce of cheese", one(1, "oz", "cheese", "1 ounce of cheese")],
    ["4 oz. salmon", one(4, "oz", "salmon", "4 oz. salmon")],
    ["6 oz. salmon", one(6, "oz", "salmon", "6 oz. salmon")],
    ["100g rice", one(100, "g", "rice", "100g rice")],
    ["100 grams of pasta", one(100, "g", "pasta", "100 grams of pasta")],
    ["50 gm of almonds", one(50, "g", "almonds", "50 gm of almonds")],
    ["an 8-ounce steak", one(8, "oz", "steak", "an 8-ounce steak")],
    ["an 8 ounce steak", one(8, "oz", "steak", "an 8 ounce steak")],
    ["two 8 ounce steaks", one(16, "oz", "steaks", "two 8 ounce steaks")],
    ["a quarter pound burger", one(0.25, "lb", "burger", "a quarter pound burger")],
    ["8 fl oz of orange juice", one(8, "oz", "orange juice", "8 fl oz of orange juice")],
    ["a pound of ground beef", one(1, "lb", "ground beef", "a pound of ground beef")],
    ["2 lbs of potatoes", one(2, "lb", "potatoes", "2 lbs of potatoes")],
    ["1lb ground turkey", one(1, "lb", "ground turkey", "1lb ground turkey")],
    ["half a pound of shrimp", one(0.5, "lb", "shrimp", "half a pound of shrimp")],
    ["a cup of coffee", one(1, "cup", "coffee", "a cup of coffee")],
    ["2 tbsp peanut butter", one(2, "tbsp", "peanut butter", "2 tbsp peanut butter")],
    ["a tablespoon of olive oil", one(1, "tbsp", "olive oil", "a tablespoon of olive oil")],
    ["3 tbs. of butter", one(3, "tbsp", "butter", "3 tbs. of butter")],
    ["a teaspoon of sugar", one(1, "tsp", "sugar", "a teaspoon of sugar")],
    ["a teaspoon of honey", one(1, "tsp", "honey", "a teaspoon of honey")],
    ["2 tsp honey", one(2, "tsp", "honey", "2 tsp honey")],
    ["two slices of toast", one(2, "slice", "toast", "two slices of toast")],
    ["a slice of pizza", one(1, "slice", "pizza", "a slice of pizza")],
    ["three pieces of chicken", one(3, "piece", "chicken", "three pieces of chicken")],
    ["a large egg", one(1, "large", "egg", "a large egg")],
    ["two large eggs", one(2, "large", "eggs", "two large eggs")],
    ["a large coffee", one(1, "large", "coffee", "a large coffee")],
    ["a medium apple", one(1, "medium", "apple", "a medium apple")],
    ["a medium banana", one(1, "medium", "banana", "a medium banana")],
    ["a small apple", one(1, "small", "apple", "a small apple")],
    ["small fries", one(1, "small", "fries", "small fries")],
    ["large fries", one(1, "large", "fries", "large fries")],
    ["a medium-sized banana", one(1, "medium", "banana", "a medium-sized banana")],
    ["two servings of pasta", one(2, "serving", "pasta", "two servings of pasta")],
    ["a serving of pasta please", one(1, "serving", "pasta", "a serving of pasta")],
    // Typed amounts can come after the food.
    ["chicken breast 6oz", one(6, "oz", "chicken breast", "chicken breast 6oz")],
    ["pizza two slices please", one(2, "slice", "pizza", "pizza two slices")],
  ])("%j", (text, expected) => {
    expect(parseMeal(text)).toEqual(expected);
  });
});

describe("parseMeal: no unit", () => {
  it.each<Case>([
    ["two eggs", one(2, null, "eggs", "two eggs")],
    ["chicken breast", one(1, null, "chicken breast", "chicken breast")],
    ["3 scrambled eggs", one(3, null, "scrambled eggs", "3 scrambled eggs")],
    // Containers are dropped and leave no unit; "a cup of" (above) is a real unit.
    ["a bowl of cereal", one(1, null, "cereal", "a bowl of cereal")],
    ["two glasses of milk", one(2, null, "milk", "two glasses of milk")],
    ["a big plate of spaghetti", one(1, null, "spaghetti", "a big plate of spaghetti")],
    ["a glass of 2% milk", one(1, null, "2% milk", "a glass of 2% milk")],
    ["a quarter pounder", one(1, null, "quarter pounder", "a quarter pounder")],
    ["two of the cookies", one(2, null, "cookies", "two of the cookies")],
    // A number before a length is the size, not a count.
    ["a 6 inch sub", one(1, null, "6 inch sub", "a 6 inch sub")],
    ["a 6-inch sub", one(1, null, "6 inch sub", "a 6-inch sub")],
    ["two 6 inch subs", one(2, null, "6 inch subs", "two 6 inch subs")],
    ["a 12 inch pizza", one(1, null, "12 inch pizza", "a 12 inch pizza")],
  ])("%j", (text, expected) => {
    expect(parseMeal(text)).toEqual(expected);
  });
});

describe("parseMeal: several items", () => {
  it.each<Case>([
    [
      "two eggs and a slice of toast",
      result(null, item(2, null, "eggs", "two eggs"), item(1, "slice", "toast", "a slice of toast")),
    ],
    [
      "a banana, an apple, and some grapes",
      result(
        null,
        item(1, null, "banana", "a banana"),
        item(1, null, "apple", "an apple"),
        item(1, null, "grapes", "grapes"),
      ),
    ],
    [
      "eggs; toast; coffee",
      result(null, item(1, null, "eggs", "eggs"), item(1, null, "toast", "toast"), item(1, null, "coffee", "coffee")),
    ],
    [
      "a burger with a side of fries",
      result(null, item(1, null, "burger", "a burger"), item(1, null, "fries", "fries")),
    ],
    ["a sandwich plus a coke", result(null, item(1, null, "sandwich", "a sandwich"), item(1, null, "coke", "a coke"))],
    [
      "two cups of cereal then a banana",
      result(null, item(2, "cup", "cereal", "two cups of cereal"), item(1, null, "banana", "a banana")),
    ],
    [
      "a coffee and then a muffin",
      result(null, item(1, null, "coffee", "a coffee"), item(1, null, "muffin", "a muffin")),
    ],
    [
      "an apple and also a banana",
      result(null, item(1, null, "apple", "an apple"), item(1, null, "banana", "a banana")),
    ],
    ["bacon and eggs", result(null, item(1, null, "bacon", "bacon"), item(1, null, "eggs", "eggs"))],
    ["eggs and bacon", result(null, item(1, null, "eggs", "eggs"), item(1, null, "bacon", "bacon"))],
    ["eggs + toast", result(null, item(1, null, "eggs", "eggs"), item(1, null, "toast", "toast"))],
    // Plain "with" keeps one item; only "with a side of" splits.
    ["toast with butter", one(1, null, "toast with butter", "toast with butter")],
    ["a burger with fries", one(1, null, "burger with fries", "a burger with fries")],
  ])("%j", (text, expected) => {
    expect(parseMeal(text)).toEqual(expected);
  });
});

describe("parseMeal: compound foods stay whole", () => {
  it.each<Case>([
    ["mac and cheese", one(1, null, "mac and cheese", "mac and cheese")],
    ["Mac & Cheese", one(1, null, "mac and cheese", "Mac & Cheese")],
    ["a bowl of macaroni and cheese", one(1, null, "macaroni and cheese", "a bowl of macaroni and cheese")],
    [
      "a peanut butter and jelly sandwich and a glass of milk",
      result(
        null,
        item(1, null, "peanut butter and jelly sandwich", "a peanut butter and jelly sandwich"),
        item(1, null, "milk", "a glass of milk"),
      ),
    ],
    ["pb&j", one(1, null, "pb and j", "pb&j")],
    [
      "a pb and j and a glass of milk",
      result(null, item(1, null, "pb and j", "a pb and j"), item(1, null, "milk", "a glass of milk")),
    ],
    ["half a cup of mac and cheese", one(0.5, "cup", "mac and cheese", "half a cup of mac and cheese")],
    ["half and half", one(1, null, "half and half", "half and half")],
    ["coffee with half and half", one(1, null, "coffee with half and half", "coffee with half and half")],
    ["two tablespoons of half and half", one(2, "tbsp", "half and half", "two tablespoons of half and half")],
    [
      "fish and chips and a coke",
      result(null, item(1, null, "fish and chips", "fish and chips"), item(1, null, "coke", "a coke")),
    ],
    ["chips and salsa", one(1, null, "chips and salsa", "chips and salsa")],
    ["biscuits and gravy", one(1, null, "biscuits and gravy", "biscuits and gravy")],
    ["a ham and cheese sandwich", one(1, null, "ham and cheese sandwich", "a ham and cheese sandwich")],
    ["rice and beans", one(1, null, "rice and beans", "rice and beans")],
    // Only the "and" inside the compound is kept.
    [
      "chicken and rice and broccoli",
      result(null, item(1, null, "chicken and rice", "chicken and rice"), item(1, null, "broccoli", "broccoli")),
    ],
    ["spaghetti and meatballs", one(1, null, "spaghetti and meatballs", "spaghetti and meatballs")],
    ["salt and pepper chips", one(1, null, "salt and pepper chips", "salt and pepper chips")],
  ])("%j", (text, expected) => {
    expect(parseMeal(text)).toEqual(expected);
  });
});

describe("parseMeal: filler words", () => {
  it.each<Case>([
    ["I had two eggs", one(2, null, "eggs", "two eggs")],
    ["I ate a banana", one(1, null, "banana", "a banana")],
    ["I've had 2 cookies", one(2, null, "cookies", "2 cookies")],
    ["I just had a protein shake", one(1, null, "protein shake", "a protein shake")],
    ["I drank a glass of water", one(1, null, "water", "a glass of water")],
    ["I drank a cup of milk", one(1, "cup", "milk", "a cup of milk")],
    ["I ate three slices of pizza", one(3, "slice", "pizza", "three slices of pizza")],
    ["I just had 2 pieces of chicken", one(2, "piece", "chicken", "2 pieces of chicken")],
    ["I'm having a salad", one(1, null, "salad", "a salad")],
    ["I am having some soup", one(1, null, "soup", "soup")],
    ["had some grapes", one(1, null, "grapes", "grapes")],
    ["some grapes", one(1, null, "grapes", "grapes")],
    ["about 6 oz of salmon", one(6, "oz", "salmon", "6 oz of salmon")],
    ["roughly 100 grams of rice", one(100, "g", "rice", "100 grams of rice")],
    ["about 100 grams of rice", one(100, "g", "rice", "100 grams of rice")],
    ["approximately half a cup of ice cream", one(0.5, "cup", "ice cream", "half a cup of ice cream")],
    ["like 2 eggs", one(2, null, "eggs", "2 eggs")],
    ["Um, I had, uh, like two eggs", one(2, null, "eggs", "two eggs")],
    ["a little bit of rice", one(1, null, "rice", "rice")],
    ["a banana please", one(1, null, "banana", "a banana")],
    ["two eggs this morning", one(2, null, "eggs", "two eggs")],
    // "today" and "this morning" are filler, not meal hints.
    [
      "I've had four chocolate chip cookies today",
      one(4, null, "chocolate chip cookies", "four chocolate chip cookies"),
    ],
    ["this morning I had a bagel", one(1, null, "bagel", "a bagel")],
    ["log two eggs", one(2, null, "eggs", "two eggs")],
  ])("%j", (text, expected) => {
    expect(parseMeal(text)).toEqual(expected);
  });
});

describe("parseMeal: meal hints", () => {
  it.each<Case>([
    ["two eggs for breakfast", result("breakfast", item(2, null, "eggs", "two eggs"))],
    [
      "I had two eggs and a slice of toast for breakfast",
      result("breakfast", item(2, null, "eggs", "two eggs"), item(1, "slice", "toast", "a slice of toast")),
    ],
    ["for lunch I had a turkey sandwich", result("lunch", item(1, null, "turkey sandwich", "a turkey sandwich"))],
    ["I'm having a turkey sandwich for lunch", result("lunch", item(1, null, "turkey sandwich", "a turkey sandwich"))],
    ["an 8 ounce steak for dinner", result("dinner", item(8, "oz", "steak", "an 8 ounce steak"))],
    [
      "for breakfast I had bacon and eggs",
      result("breakfast", item(1, null, "bacon", "bacon"), item(1, null, "eggs", "eggs")),
    ],
    [
      "a slice of cheese pizza plus a coke for dinner",
      result("dinner", item(1, "slice", "cheese pizza", "a slice of cheese pizza"), item(1, null, "coke", "a coke")),
    ],
    [
      "100g chicken breast and 1 cup of broccoli for supper",
      result(
        "dinner",
        item(100, "g", "chicken breast", "100g chicken breast"),
        item(1, "cup", "broccoli", "1 cup of broccoli"),
      ),
    ],
    [
      "a bowl of cereal with milk for breakfast",
      result("breakfast", item(1, null, "cereal with milk", "a bowl of cereal with milk")),
    ],
    ["a granola bar as a snack", result("snack", item(1, null, "granola bar", "a granola bar"))],
    ["a protein bar as a snack", result("snack", item(1, null, "protein bar", "a protein bar"))],
    ["Supper was chicken and rice", result("dinner", item(1, null, "chicken and rice", "chicken and rice"))],
    [
      "breakfast was a bagel and orange juice",
      result("breakfast", item(1, null, "bagel", "a bagel"), item(1, null, "orange juice", "orange juice")),
    ],
    [
      "Breakfast: oatmeal and a banana",
      result("breakfast", item(1, null, "oatmeal", "oatmeal"), item(1, null, "banana", "a banana")),
    ],
    ["Lunch - a turkey sandwich", result("lunch", item(1, null, "turkey sandwich", "a turkey sandwich"))],
    ["Snacks, chips and salsa", result("snack", item(1, null, "chips and salsa", "chips and salsa"))],
    ["dinner two slices of pizza", result("dinner", item(2, "slice", "pizza", "two slices of pizza"))],
    ["lunch 6 inch sub", result("lunch", item(1, null, "6 inch sub", "6 inch sub"))],
    ["at dinner I had two tacos", result("dinner", item(2, null, "tacos", "two tacos"))],
    ["an apple for a late night snack", result("snack", item(1, null, "apple", "an apple"))],
    ["for my afternoon snack a yogurt", result("snack", item(1, null, "yogurt", "a yogurt"))],
    ["a coke with lunch", result("lunch", item(1, null, "coke", "a coke"))],
    ["a dozen wings with dinner", result("dinner", item(12, null, "wings", "a dozen wings"))],
    ["a coffee at lunch time", result("lunch", item(1, null, "coffee", "a coffee"))],
    [
      "eggs for breakfast and a sandwich for lunch",
      result("breakfast", item(1, null, "eggs", "eggs"), item(1, null, "sandwich", "a sandwich")),
    ],
    [
      "eggs for breakfast and a sandwich at lunch",
      result("breakfast", item(1, null, "eggs", "eggs"), item(1, null, "sandwich", "a sandwich")),
    ],
    // Dessert is removed from the food but doesn't pick a meal.
    ["ice cream for dessert", one(1, null, "ice cream", "ice cream")],
    // Meal words that are part of the food stay in the food.
    ["pancakes with breakfast sausage", one(1, null, "pancakes with breakfast sausage", "pancakes with breakfast sausage")],
    ["a breakfast burrito", one(1, null, "breakfast burrito", "a breakfast burrito")],
    ["two dinner rolls", one(2, null, "dinner rolls", "two dinner rolls")],
    ["a snack bar", one(1, null, "snack bar", "a snack bar")],
  ])("%j", (text, expected) => {
    expect(parseMeal(text)).toEqual(expected);
  });
});

describe("parseMeal: voice transcripts, punctuation and casing", () => {
  it.each<Case>([
    ["TWO EGGS!!!", one(2, null, "eggs", "TWO EGGS")],
    [
      "Two eggs, toast, and a banana.",
      result(
        null,
        item(2, null, "eggs", "Two eggs"),
        item(1, null, "toast", "toast"),
        item(1, null, "banana", "a banana"),
      ),
    ],
    ["  two   eggs  ", one(2, null, "eggs", "two   eggs")],
    [
      "I had two eggs. Then I had toast.",
      result(null, item(2, null, "eggs", "two eggs"), item(1, null, "toast", "toast")),
    ],
    ["I’m having a large Coffee", one(1, "large", "coffee", "a large Coffee")],
    ["I had 6 oz. of chicken.", one(6, "oz", "chicken", "6 oz. of chicken")],
    [
      "Um I had like two slices of pizza for dinner.",
      result("dinner", item(2, "slice", "pizza", "two slices of pizza")),
    ],
    [
      "I had two eggs and toast for breakfast.",
      result("breakfast", item(2, null, "eggs", "two eggs"), item(1, null, "toast", "toast")),
    ],
    ["eggs\ntoast", result(null, item(1, null, "eggs", "eggs"), item(1, null, "toast", "toast"))],
    [
      "A cup of coffee and two eggs for breakfast, please.",
      result("breakfast", item(1, "cup", "coffee", "A cup of coffee"), item(2, null, "eggs", "two eggs")),
    ],
  ])("%j", (text, expected) => {
    expect(parseMeal(text)).toEqual(expected);
  });
});

describe("parseMeal: empty and garbage input", () => {
  it.each<Case>([
    ["", result(null)],
    ["   ", result(null)],
    ["um", result(null)],
    ["um uh", result(null)],
    ["...", result(null)],
    ["?!", result(null)],
    ["😀🍕", result(null)],
    ["123", result(null)],
    ["I had", result(null)],
    ["two slices", result(null)],
    ["a an the", result(null)],
    ["for lunch", result("lunch")],
    ["Breakfast.", result("breakfast")],
    // Not a food we know, but the parser doesn't judge; the USDA lookup reports "not found".
    ["asdfgh", one(1, null, "asdfgh", "asdfgh")],
    ["constructor toString", one(1, null, "constructor tostring", "constructor toString")],
    // Zero is never an amount, so it stays in the food name.
    ["0 calorie soda", one(1, null, "0 calorie soda", "0 calorie soda")],
  ])("%j", (text, expected) => {
    expect(parseMeal(text)).toEqual(expected);
  });

  it("returns nothing for non-string input", () => {
    expect(parseMeal(undefined as unknown as string)).toEqual(result(null));
  });
});
