// A little picture for each food and meal in the Diary. Pure decoration: the
// name beside it always says what the food is, so a miss costs nothing.

import type { Meal } from "../../src/food/types";

export const MEAL_EMOJI: Record<Meal, string> = { breakfast: "🍳", lunch: "🥪", dinner: "🍝", snack: "🍎" };
export const OTHER_MEAL_EMOJI = "🍽️";
const DEFAULT = "🍽️";

// First match wins, so dishes come before what's in them ("pizza" before
// "cheese", "chicken salad" is a salad, "apple juice" is juice). Each pattern
// is matched against whole words, plurals allowed.
const RULES: [string, string][] = [
  // Dishes
  ["pizza", "🍕"],
  ["burger|cheeseburger|hamburger|big mac|quarter pounder|mcdouble|whopper|baconator", "🍔"],
  ["mcnugget|nugget|chick n strip|tender|strip|mcchicken|mccrispy|chick n mini", "🍗"],
  ["crunchwrap|chalupa|gordita|doritos locos|quesadilla", "🌮"],
  ["egg roll|rangoon|spring roll|potsticker", "🥟"],
  ["chow mein|lo mein|chow fun", "🍜"],
  ["mcflurry|frosted lemonade|frosted coffee|frosty", "🍦"],
  ["mcmuffin|mcgriddle", "🥪"],
  ["hot dog|hotdog", "🌭"],
  ["taco", "🌮"],
  ["burrito|wrap", "🌯"],
  ["sandwich|sub|blt", "🥪"],
  ["sushi|sashimi|california roll|tuna roll|salmon roll", "🍣"],
  ["ramen|noodle|pho", "🍜"],
  ["spaghetti|pasta|lasagna|macaroni|mac and cheese|fettuccine|penne", "🍝"],
  ["salad", "🥗"],
  ["soup|chili|stew", "🍲"],
  ["dumpling|potsticker", "🥟"],
  ["fries|french fries", "🍟"],
  ["pancake", "🥞"],
  ["waffle", "🧇"],
  ["oatmeal|oats|cereal|granola", "🥣"],
  ["smoothie|shake|milkshake", "🥤"],
  // Drinks
  ["beer|lager|ale|ipa|stout|bud light|budweiser|blue moon|coors|miller|michelob|corona|modelo|heineken|stella|pacifico|yuengling|sam adams|pbr|pabst|shiner|dos equis|busch|natty|keystone|guinness", "🍺"],
  ["wine|rose|champagne|prosecco|sangria", "🍷"],
  ["margarita|cocktail|martini|mojito|daiquiri", "🍹"],
  ["vodka|whiskey|whisky|bourbon|tequila|rum|gin|shot|liquor|distilled", "🥃"],
  ["seltzer|white claw|truly|cider", "🥂"],
  ["coffee|latte|espresso|cappuccino|americano|mocha", "☕"],
  ["tea|matcha", "🍵"],
  ["juice|lemonade", "🧃"],
  ["soda|coke|cola|pepsi|sprite|dr pepper|mountain dew", "🥤"],
  ["water", "💧"],
  ["milk", "🥛"],
  // Sweets
  ["ice cream|gelato|frozen yogurt", "🍨"],
  ["cookie", "🍪"],
  ["cake|cupcake|brownie", "🧁"],
  ["donut|doughnut", "🍩"],
  ["pie", "🥧"],
  ["chocolate|candy bar", "🍫"],
  ["candy|gummy|gummies", "🍬"],
  ["popcorn", "🍿"],
  // Breads and grains
  ["croissant", "🥐"],
  ["bagel", "🥯"],
  ["pretzel", "🥨"],
  ["bread|toast|bun|roll|biscuit|muffin|tortilla", "🍞"],
  ["rice", "🍚"],
  // Proteins
  ["bacon", "🥓"],
  ["egg", "🥚"],
  ["shrimp|prawn", "🍤"],
  ["salmon|tuna|fish|cod|tilapia|trout|crab|lobster", "🐟"],
  ["chicken|turkey|wing|drumstick", "🍗"],
  ["steak|beef|pork|ham|sausage|meat|lamb|ribs", "🥩"],
  ["peanut|almond|nut|cashew|walnut|pecan|pistachio", "🥜"],
  ["cheese", "🧀"],
  ["yogurt", "🥣"],
  ["butter", "🧈"],
  ["honey", "🍯"],
  // Fruit
  ["banana", "🍌"],
  ["apple", "🍎"],
  ["orange|clementine|mandarin|tangerine", "🍊"],
  ["lemon|lime", "🍋"],
  ["grape|raisin", "🍇"],
  ["strawberr(y|ies)|strawberry", "🍓"],
  ["blueberr(y|ies)|blueberry|berr(y|ies)", "🫐"],
  ["cherr(y|ies)|cherry", "🍒"],
  ["peach|nectarine", "🍑"],
  ["pear", "🍐"],
  ["pineapple", "🍍"],
  ["mango", "🥭"],
  ["watermelon|melon|cantaloupe", "🍉"],
  ["kiwi", "🥝"],
  ["coconut", "🥥"],
  ["avocado|guacamole", "🥑"],
  // Vegetables
  ["tomato", "🍅"],
  ["carrot", "🥕"],
  ["broccoli", "🥦"],
  ["corn", "🌽"],
  ["potato|potatoes|hash brown", "🥔"],
  ["cucumber|pickle", "🥒"],
  ["lettuce|spinach|kale|greens", "🥬"],
  ["pepper|jalapeno", "🫑"],
  ["onion", "🧅"],
  ["garlic", "🧄"],
  ["bean|lentil|chickpea|hummus|edamame|pea", "🫘"],
];

const COMPILED = RULES.map(([words, emoji]): [RegExp, string] => [new RegExp(`\\b(?:${words})(?:e?s)?\\b`, "i"), emoji]);

function match(text: string): string | null {
  for (const [re, emoji] of COMPILED) if (re.test(text)) return emoji;
  return null;
}

/**
 * The picture for a food: from the name the user knows it by first, then the
 * USDA description ("Alcoholic beverage, beer, light, BUD LIGHT").
 */
export function foodEmoji(name: string, usdaName?: string | null): string {
  return match(name) ?? (usdaName ? match(usdaName) : null) ?? DEFAULT;
}
