// Everyday foods mapped straight to the USDA record people mean (SPEC sections 6
// and 7). USDA's search ranks short generic words badly: "rice" has no cooked
// rice in its top 50 hits, "milk" has no fluid milk and "bacon" puts rendered fat
// first. A phrase in this table goes straight to its record instead.
//
// Every fdcId is an SR Legacy or Foundation record, chosen in the form people eat
// it (cooked rice, brewed coffee, fluid 2% milk, pan-fried bacon slices). The
// comment above each entry is the record's USDA description and what a unitless
// mention resolves to ("a banana", "some rice"), checked against USDA's official
// downloads; test/common.test.ts checks the same against the fixture records.
//
// Pure data and string matching: no imports, so usda.ts can import this module.

export interface CommonFood {
  /**
   * Lowercase phrases people say ("rice", "white rice", "cooked rice"). Matching
   * ignores case, punctuation and simple plurals, and is exact otherwise:
   * "rice crackers" never matches "rice".
   */
  names: string[];
  /** The SR Legacy or Foundation record they most likely mean, as eaten. */
  fdcId: number;
  /**
   * What a unitless mention means ("a glass of milk" is a cup) when the record's
   * own portions don't resolve it well. A key unitOptions returns for the
   * record, or one of this entry's `portions`. The app tries it first for every
   * food offered for the phrase (the alternatives too), and for this record
   * wherever it is offered (see commonUnit).
   */
  unit?: string;
  /**
   * What a plural with no count means, when that isn't `unit`: "dumplings",
   * "mozzarella sticks" and "a bag of gummy bears" are a serving, where "six
   * dumplings" and "a gummy bear" count `unit`s. See spokenUnits.
   */
  plural?: string;
  /** Common variants the confirm screen should offer next, most likely first (at most 4). */
  alternatives?: number[];
  /**
   * Units people use that USDA's portions don't give us: a can of soda, a
   * container of yogurt. They apply to `fdcId` wherever it appears, see
   * commonPortions. Grams are for ONE unit.
   */
  portions?: { unit: string; label: string; grams: number }[];
}

export type CommonPortion = NonNullable<CommonFood["portions"]>[number];

export const COMMON_FOODS: readonly CommonFood[] = [
  // ---------------------------------------------------------------- eggs
  // Egg, whole, raw, fresh: 1 large = 50 g, 72 kcal
  { names: ["eggs", "whole egg"], fdcId: 171287, unit: "large", alternatives: [172187, 173423, 173424] },
  // Egg, whole, cooked, scrambled: 1 large = 61 g, 91 kcal
  { names: ["scrambled eggs"], fdcId: 172187, alternatives: [172185, 173423, 171287] },
  // Egg, whole, cooked, fried: 1 large = 46 g, 90 kcal
  { names: ["fried egg", "sunny side up egg", "over easy egg"], fdcId: 173423, alternatives: [172187, 173424, 172186] },
  // Egg, whole, cooked, hard-boiled: 1 large = 50 g, 78 kcal
  { names: ["hard boiled egg", "hardboiled egg", "boiled egg"], fdcId: 173424, alternatives: [172186, 172187, 171287] },
  // Egg, whole, cooked, poached: 1 large = 50 g, 72 kcal
  { names: ["poached egg"], fdcId: 172186, alternatives: [173424, 173423] },
  // Egg, whole, cooked, omelet: 1 omelet (2 eggs) = 122 g, 188 kcal
  {
    names: ["omelet", "omelette", "egg omelet"],
    fdcId: 172185,
    unit: "each",
    alternatives: [172187, 171287],
    portions: [{ unit: "each", label: "omelet (2 eggs)", grams: 122 }],
  },
  // Egg, white, raw, fresh: 1 large = 33 g, 17 kcal
  { names: ["egg whites"], fdcId: 172183, alternatives: [171287, 172187] },

  // ---------------------------------------------------------------- milk and dairy drinks
  // Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D: 1 cup = 244 g, 122 kcal
  {
    names: ["milk", "2% milk", "2 percent milk", "two percent milk", "reduced fat milk"],
    fdcId: 171267,
    unit: "cup",
    alternatives: [171265, 170872, 171269],
  },
  // Milk, whole, 3.25% milkfat, with added vitamin D: 1 cup = 244 g, 149 kcal
  { names: ["whole milk", "vitamin d milk"], fdcId: 171265, unit: "cup", alternatives: [171267, 170872, 171269] },
  // Milk, lowfat, fluid, 1% milkfat, with added vitamin A and vitamin D: 1 cup = 244 g, 103 kcal
  {
    names: ["1% milk", "1 percent milk", "one percent milk", "low fat milk", "lowfat milk"],
    fdcId: 170872,
    unit: "cup",
    alternatives: [171267, 171269, 171265],
  },
  // Milk, nonfat, fluid, with added vitamin A and vitamin D (fat free or skim): 1 cup = 245 g, 83 kcal
  {
    names: ["skim milk", "nonfat milk", "non fat milk", "fat free milk"],
    fdcId: 171269,
    unit: "cup",
    alternatives: [170872, 171267, 171265],
  },
  // Milk, chocolate, fluid, commercial, reduced fat, with added vitamin A and vitamin D: 1 cup = 250 g, 190 kcal
  { names: ["chocolate milk"], fdcId: 170880, unit: "cup", alternatives: [170881, 170879] },
  // Beverages, almond milk, unsweetened, shelf stable: 1 cup = 262 g, 39 kcal
  {
    names: ["almond milk", "unsweetened almond milk"],
    fdcId: 174832,
    unit: "cup",
    alternatives: [168751, 174820, 2257046],
  },
  // Oat milk, unsweetened, plain, refrigerated: 1 cup (8 fl oz) = 240 g, 116 kcal
  {
    names: ["oat milk", "oatmilk"],
    fdcId: 2257046,
    unit: "cup",
    alternatives: [174832, 172456, 171267],
    portions: [{ unit: "cup", label: "cup (8 fl oz)", grams: 240 }],
  },
  // Soymilk, original and vanilla, with added calcium, vitamins A and D: 1 cup = 243 g, 105 kcal
  { names: ["soy milk", "soymilk"], fdcId: 172456, unit: "cup", alternatives: [174832, 2257046, 171267] },
  // Milk, chocolate beverage, hot cocoa, homemade: 1 cup = 250 g, 193 kcal
  { names: ["hot chocolate", "hot cocoa", "cocoa"], fdcId: 171277, unit: "cup", alternatives: [174123, 170880] },
  // Milk shakes, thick vanilla: 1 shake (11 fl oz) = 313 g, 351 kcal
  {
    names: ["milkshake", "milk shake", "vanilla milkshake", "vanilla shake"],
    fdcId: 170884,
    unit: "each",
    alternatives: [170883],
    portions: [{ unit: "each", label: "shake (11 fl oz)", grams: 313 }],
  },
  // Milk shakes, thick chocolate: 1 shake (10.6 fl oz) = 300 g, 357 kcal
  {
    names: ["chocolate milkshake", "chocolate milk shake", "chocolate shake"],
    fdcId: 170883,
    unit: "each",
    alternatives: [170884],
    portions: [{ unit: "each", label: "shake (10.6 fl oz)", grams: 300 }],
  },
  // Fast foods, strawberry banana smoothie made with ice and low-fat yogurt: 1 smoothie (12 fl oz) = 347 g, 226 kcal
  {
    names: ["smoothie", "fruit smoothie", "strawberry banana smoothie"],
    fdcId: 170775,
    unit: "each",
    portions: [{ unit: "each", label: "smoothie (12 fl oz)", grams: 347 }],
  },

  // ---------------------------------------------------------------- cheese, yogurt, butter, cream
  // Cheese, cheddar (Includes foods for USDA's Food Distribution Program): 1 slice = 28 g, 113 kcal
  { names: ["cheese", "cheddar", "cheddar cheese"], fdcId: 173414, alternatives: [170853, 171244, 171251] },
  // Cheese, pasteurized process, American, fortified with vitamin D: 1 slice = 28 g, 103 kcal
  { names: ["american cheese"], fdcId: 170853, alternatives: [171289, 173414] },
  // Cheese, mozzarella, low moisture, part-skim: 1 oz = 28.3 g, 84 kcal
  { names: ["mozzarella", "mozzarella cheese"], fdcId: 171244, unit: "oz", alternatives: [170845, 170900] },
  // Cheese, mozzarella, low moisture, part-skim: 1 stick (1 oz) = 28 g, 83 kcal
  {
    names: ["string cheese", "cheese stick"],
    fdcId: 171244,
    unit: "each",
    alternatives: [173414, 170853],
    portions: [{ unit: "each", label: "stick (1 oz)", grams: 28 }],
  },
  // Cheese, swiss: 1 slice = 28 g, 110 kcal
  { names: ["swiss cheese", "swiss"], fdcId: 171251, alternatives: [170850, 173414] },
  // Cheese, provolone: 1 slice = 28 g, 98 kcal
  { names: ["provolone", "provolone cheese"], fdcId: 170850, alternatives: [171251, 171244] },
  // Cheese, parmesan, grated: 1 tbsp = 5 g, 21 kcal
  { names: ["parmesan", "parmesan cheese"], fdcId: 171247, unit: "tbsp" },
  // Cheese, feta: 1 oz = 28.3 g, 75 kcal
  { names: ["feta", "feta cheese"], fdcId: 173420, unit: "oz" },
  // Cheese, cream: 1 serving (2 tbsp) = 29 g, 102 kcal
  // A bagel's worth and the label serving; the independent labels' default too.
  {
    names: ["cream cheese"],
    fdcId: 173418,
    unit: "serving",
    alternatives: [169079, 172207],
    portions: [{ unit: "serving", label: "serving (2 tbsp)", grams: 29 }],
  },
  // Cheese, cream, low fat: 1 serving (2 tbsp) = 30 g, 62 kcal
  {
    names: ["low fat cream cheese", "light cream cheese", "neufchatel"],
    fdcId: 169079,
    unit: "serving",
    alternatives: [173418, 172207],
    portions: [{ unit: "serving", label: "serving (2 tbsp)", grams: 30 }],
  },
  // Cheese, cream, fat free: 1 serving (2 tbsp) = 36 g, 38 kcal
  {
    names: ["fat free cream cheese"],
    fdcId: 172207,
    unit: "serving",
    alternatives: [169079, 173418],
    portions: [{ unit: "serving", label: "serving (2 tbsp)", grams: 36 }],
  },
  // Cheese, cottage, creamed, large or small curd: 1 cup, large curd = 210 g, 206 kcal
  { names: ["cottage cheese"], fdcId: 172179, unit: "cup", alternatives: [172182, 173417] },
  // Yogurt, Greek, plain, nonfat: 1 serving (170 g) = 170 g, 104 kcal
  {
    names: ["greek yogurt", "plain greek yogurt", "nonfat greek yogurt"],
    fdcId: 330137,
    alternatives: [170902, 330415, 2259794],
  },
  // Yogurt, Greek, vanilla, nonfat: 1 container (5.3 oz) = 150 g, 117 kcal
  {
    names: ["vanilla greek yogurt"],
    fdcId: 170902,
    unit: "each",
    alternatives: [330137, 330415],
    portions: [{ unit: "each", label: "container (5.3 oz)", grams: 150 }],
  },
  // Yogurt, fruit, low fat,9 g protein/8 oz: 1 container (6 oz) = 170 g, 168 kcal
  {
    names: ["yogurt", "yoghurt", "fruit yogurt", "strawberry yogurt"],
    fdcId: 170889,
    unit: "each",
    alternatives: [170888, 170886, 330137],
    portions: [{ unit: "each", label: "container (6 oz)", grams: 170 }],
  },
  // Yogurt parfait, lowfat, with fruit and granola: 1 item = 149 g, 125 kcal
  { names: ["yogurt parfait", "parfait", "fruit and yogurt parfait", "granola parfait"], fdcId: 170355, unit: "each" },
  // Yogurt, vanilla, low fat.: 1 cup = 245 g, 208 kcal
  { names: ["vanilla yogurt"], fdcId: 170888, unit: "cup", alternatives: [170889, 170886] },
  // Yogurt, plain, low fat: 1 cup = 245 g, 154 kcal
  { names: ["plain yogurt"], fdcId: 170886, unit: "cup", alternatives: [170888, 330137] },
  // Butter, salted: 1 tbsp = 14.2 g, 102 kcal
  { names: ["butter", "salted butter"], fdcId: 173410, unit: "tbsp", alternatives: [173430] },
  // Butter, without salt: 1 tbsp = 14.2 g, 102 kcal
  { names: ["unsalted butter"], fdcId: 173430, unit: "tbsp", alternatives: [173410] },
  // Cream, sour, cultured: 1 tbsp = 12 g, 24 kcal
  { names: ["sour cream"], fdcId: 171257, unit: "tbsp", alternatives: [171256] },
  // Cream, fluid, half and half: 1 tbsp = 15 g, 20 kcal
  { names: ["half and half"], fdcId: 171255, unit: "tbsp", alternatives: [173453, 171267] },
  // Cream, fluid, light (coffee cream or table cream): 1 tbsp = 15 g, 29 kcal
  // "Coffee with cream"; on its own USDA's search for "cream" ranks cream cheese first.
  {
    names: ["cream", "coffee cream", "light cream", "table cream"],
    fdcId: 170857,
    unit: "tbsp",
    alternatives: [171255, 170859],
  },
  // Cream, fluid, heavy whipping: 1 tbsp = 15 g, 51 kcal
  {
    names: ["heavy cream", "heavy whipping cream", "whipping cream"],
    fdcId: 170859,
    unit: "tbsp",
    alternatives: [170857],
  },
  // Cream substitute, flavored, liquid: 1 tbsp = 15 g, 38 kcal
  {
    names: ["coffee creamer", "creamer", "flavored creamer"],
    fdcId: 173453,
    unit: "tbsp",
    alternatives: [171255, 168097],
  },
  // Cream, whipped, cream topping, pressurized: 1 tbsp = 3 g, 8 kcal
  { names: ["whipped cream"], fdcId: 170860, unit: "tbsp" },

  // ---------------------------------------------------------------- frozen desserts
  // Ice creams, vanilla: 1 cup = 132 g, 274 kcal
  {
    names: ["ice cream", "vanilla ice cream"],
    fdcId: 167575,
    unit: "cup",
    alternatives: [168809, 168810, 168105],
    portions: [{ unit: "cup", label: "cup", grams: 132 }],
  },
  // Ice creams, chocolate: 1 cup = 132 g, 285 kcal
  { names: ["chocolate ice cream"], fdcId: 168809, unit: "cup", alternatives: [167575, 168810] },
  // Frozen yogurts, flavors other than chocolate: 1 cup = 174 g, 221 kcal
  { names: ["frozen yogurt", "froyo"], fdcId: 168105, unit: "cup", alternatives: [168815, 167575] },
  // Ice cream sandwich: 1 serving (70 g) = 70 g, 166 kcal
  { names: ["ice cream sandwich"], fdcId: 172226 },
  // Fast foods, vanilla, light, soft-serve ice cream, with cone: 1 item = 120 g, 196 kcal
  // The cone with its ice cream; "Ice cream cones, cake or wafer-type" is the empty 4 g cone.
  {
    names: ["ice cream cone", "cone", "soft serve", "soft serve cone", "soft serve ice cream", "vanilla cone"],
    fdcId: 173274,
    unit: "each",
    alternatives: [172061, 167575],
  },
  // Fast foods, sundae, hot fudge: 1 sundae = 158 g, 284 kcal
  { names: ["sundae", "hot fudge sundae"], fdcId: 173276, alternatives: [173275] },

  // ---------------------------------------------------------------- chicken and turkey
  // Chicken, broilers or fryers, breast, meat only, cooked, roasted: 1 breast = 172 g, 284 kcal
  {
    names: ["chicken breast", "chicken", "baked chicken", "baked chicken breast", "roasted chicken breast"],
    fdcId: 171477,
    alternatives: [171534, 170756, 173625],
  },
  // Chicken, broiler or fryers, breast, skinless, boneless, meat only, cooked, grilled: 1 piece = 196 g, 296 kcal
  { names: ["grilled chicken", "grilled chicken breast"], fdcId: 171534, alternatives: [171477, 171140] },
  // Chicken, broilers or fryers, thigh, meat only, cooked, roasted: 1 thigh without skin = 116 g, 208 kcal
  // Thighs are mostly bought boneless and skinless; with skin (232 kcal per 100 g) is the first alternative.
  // USDA's portions file the 116 g thigh without skin and the 137 g one with skin under the same
  // word, which unitOptions reads as one "thigh" (137 g), so the skinless one is a unit of its own.
  {
    names: ["chicken thigh"],
    fdcId: 172388,
    unit: "piece",
    alternatives: [173625, 170359],
    portions: [{ unit: "piece", label: "thigh without skin", grams: 116 }],
  },
  // Chicken, broilers or fryers, drumstick, meat and skin, cooked, roasted: 1 drumstick = 96 g, 183 kcal
  { names: ["chicken drumstick", "drumstick", "chicken leg"], fdcId: 173612, alternatives: [170757, 331897] },
  // Chicken, broilers or fryers, wing, meat and skin, cooked, roasted: 1 order (6 wings) = 192 g, 488 kcal
  // (1 wing = 32 g, 81 kcal).
  // Six wings come to about 490 kcal, close to a restaurant's six plain wings; flour-fried (321 kcal
  // per 100 g) is an alternative. USDA gives no weight per wing for the roasted record (its "piece" is
  // 85 g), so a wing is the 32 g USDA gives for a fried wing without its bone.
  // "Wings" with no count are an order of six.
  {
    names: ["chicken wings", "wings", "buffalo wings", "hot wings"],
    fdcId: 173630,
    unit: "each",
    plural: "order",
    alternatives: [173629, 170360, 171523, 172830],
    portions: [
      { unit: "each", label: "wing (bone removed)", grams: 32 },
      { unit: "order", label: "order (6 wings)", grams: 192 },
    ],
  },
  // Chicken, nuggets, white meat, precooked, frozen, not reheated: 1 serving = 82 g, 214 kcal; 1 piece = 20 g, 52 kcal
  // "Nuggets" with no count are USDA's serving, about 4 nuggets.
  { names: ["chicken nuggets", "nuggets"], fdcId: 172112, plural: "serving", alternatives: [170718, 173346, 173321] },
  // Fast foods, chicken tenders: 1 serving = 184 g, 499 kcal; 1 piece (tender) = 45 g, 122 kcal
  // USDA's 30 g strip is light for the tenders sold at chains (Chick-fil-A's and Cane's are 45 to 55 g);
  // "chicken tenders" with no count are USDA's serving, about 4 tenders.
  {
    names: ["chicken tenders", "chicken strips", "chicken fingers", "tenders"],
    fdcId: 173321,
    unit: "piece",
    plural: "serving",
    alternatives: [173346, 170718],
    portions: [{ unit: "piece", label: "tender", grams: 45 }],
  },
  // Fast Foods, Fried Chicken, Breast, meat and skin and breading: 1 breast = 203 g, 467 kcal
  { names: ["fried chicken", "fried chicken breast"], fdcId: 170756, alternatives: [170359, 170757, 170360] },
  // Turkey, all classes, light meat, cooked, roasted: 1 serving (3 oz) = 85 g, 125 kcal
  {
    names: ["turkey", "roast turkey", "roasted turkey"],
    fdcId: 171491,
    unit: "serving",
    alternatives: [172941, 174572],
    portions: [
      { unit: "serving", label: "serving (3 oz)", grams: 85 },
      { unit: "slice", label: "slice (1 oz)", grams: 28 },
    ],
  },
  // Turkey breast, sliced, prepackaged: 1 slice = 16 g, 17 kcal
  {
    names: ["deli turkey", "sliced turkey", "turkey slice", "turkey lunch meat", "turkey lunchmeat"],
    fdcId: 172941,
    alternatives: [174572, 171491],
  },
  // Turkey, Ground, cooked: 1 patty = 82 g, 167 kcal
  { names: ["ground turkey"], fdcId: 171506, alternatives: [171799, 174034] },

  // ---------------------------------------------------------------- beef, pork, sausages
  // Pork, cured, bacon, pre-sliced, cooked, pan-fried: 1 slice = 11.5 g, 54 kcal
  { names: ["bacon", "pork bacon"], fdcId: 168322, alternatives: [171639, 167914, 168383] },
  // Bacon, turkey, microwaved: 1 slice = 8.1 g, 30 kcal
  { names: ["turkey bacon"], fdcId: 171639, alternatives: [168322, 171640] },
  // Canadian bacon, cooked, pan-fried: 1 slice = 13.8 g, 20 kcal
  { names: ["canadian bacon"], fdcId: 168383, alternatives: [168322, 173864] },
  // Pork sausage, link/patty, cooked, pan-fried: 1 patty = 27 g, 88 kcal
  { names: ["sausage", "breakfast sausage", "sausage patty", "pork sausage"], fdcId: 174578, alternatives: [172971] },
  // Pork sausage, link/patty, fully cooked, microwaved: 1 link = 21 g, 92 kcal
  { names: ["sausage links", "breakfast links"], fdcId: 172971, alternatives: [174578] },
  // Ham, sliced, regular (approximately 11% fat): 1 slice = 28 g, 46 kcal
  { names: ["ham", "sliced ham", "deli ham", "ham slice"], fdcId: 173864, alternatives: [173863, 746952] },
  // Beef, ground, 80% lean meat / 20% fat, crumbles, cooked, pan-browned: 1 serving (3 oz cooked) = 85 g, 231 kcal
  {
    names: ["ground beef", "hamburger meat", "beef", "cooked beef"],
    fdcId: 171799,
    unit: "serving",
    alternatives: [174034, 171506],
    portions: [{ unit: "serving", label: "serving (3 oz cooked)", grams: 85 }],
  },
  // Beef, ground, 85% lean meat / 15% fat, crumbles, cooked, pan-browned: 1 serving (3 oz cooked) = 85 g, 218 kcal
  {
    names: ["lean ground beef", "85% lean ground beef"],
    fdcId: 174034,
    unit: "serving",
    alternatives: [171799, 171506],
    portions: [{ unit: "serving", label: "serving (3 oz cooked)", grams: 85 }],
  },
  // Beef, ground, 80% lean meat / 20% fat, patty, cooked, broiled: 1 patty (1/4 lb raw) = 85 g, 230 kcal
  {
    names: ["hamburger patty", "burger patty", "beef patty"],
    fdcId: 171797,
    unit: "each",
    alternatives: [171506],
    portions: [{ unit: "each", label: "patty (1/4 lb raw)", grams: 85 }],
  },
  // Beef, top sirloin, steak, separable lean only, trimmed to 1/8" fat, all grades, cooked, broiled: 1 steak (6 oz cooked) = 170 g, 303 kcal
  {
    names: ["steak", "sirloin", "sirloin steak", "top sirloin", "beef steak", "grilled steak"],
    fdcId: 174054,
    unit: "each",
    alternatives: [168644, 168634],
    portions: [{ unit: "each", label: "steak (6 oz cooked)", grams: 170 }],
  },
  // Pork, fresh, loin, top loin (chops), boneless, separable lean only, cooked, broiled: 1 chop = 145 g, 251 kcal
  { names: ["pork chop"], fdcId: 168253, alternatives: [168240] },
  // Pulled pork in barbecue sauce: 1 cup = 249 g, 418 kcal
  { names: ["pulled pork", "bbq pulled pork"], fdcId: 173344, unit: "cup" },
  // Meatballs, frozen, Italian style: 1 piece = 18.7 g, 54 kcal
  { names: ["meatballs"], fdcId: 171638 },
  // Frankfurter, beef, heated: 1 frankfurter = 48 g, 155 kcal
  {
    names: ["hot dog", "hotdog", "frank", "frankfurter", "wiener"],
    fdcId: 174614,
    alternatives: [171633, 171625, 173345],
  },
  // Corn dogs, frozen, prepared: 1 corn dog = 78 g, 195 kcal
  {
    names: ["corn dog", "corndog"],
    fdcId: 173345,
    unit: "each",
    alternatives: [174614],
    portions: [{ unit: "each", label: "corn dog", grams: 78 }],
  },
  // Pepperoni, beef and pork, sliced: 1 oz = 28.3 g, 143 kcal
  { names: ["pepperoni"], fdcId: 174575, unit: "oz" },
  // Salami, dry or hard, pork: 1 slice = 10 g, 41 kcal
  { names: ["salami"], fdcId: 172938 },
  // Bologna, beef: 1 slice = 30 g, 90 kcal
  { names: ["bologna"], fdcId: 172012 },
  // Snacks, beef jerky, chopped and formed: 1 piece, large = 20 g, 82 kcal
  { names: ["beef jerky", "jerky"], fdcId: 167536 },

  // ---------------------------------------------------------------- fish and seafood
  // Fish, salmon, Atlantic, farmed, cooked, dry heat: 1 serving (6 oz fillet) = 170 g, 350 kcal
  {
    names: ["salmon", "salmon fillet", "baked salmon", "grilled salmon"],
    fdcId: 175168,
    unit: "serving",
    alternatives: [173692, 171998],
    portions: [{ unit: "serving", label: "serving (6 oz fillet)", grams: 170 }],
  },
  // Fish, tuna, light, canned in water, drained solids: 1 can (5 oz), drained = 107 g, 96 kcal
  {
    names: ["tuna", "canned tuna", "tuna fish"],
    fdcId: 334194,
    unit: "can",
    alternatives: [173708],
    portions: [{ unit: "can", label: "can (5 oz), drained", grams: 107 }],
  },
  // Fish, tuna, light, canned in oil, drained solids: 1 can (5 oz), drained = 107 g, 212 kcal
  // USDA gives this record only a cup; the can is the water-packed can's drained weight.
  {
    names: ["tuna in oil", "oil packed tuna"],
    fdcId: 173708,
    unit: "can",
    alternatives: [334194],
    portions: [{ unit: "can", label: "can (5 oz), drained", grams: 107 }],
  },
  // Fish, tuna salad: 1 cup = 205 g, 383 kcal
  { names: ["tuna salad"], fdcId: 175160, unit: "cup" },
  // Crustaceans, shrimp, mixed species, cooked, moist heat (may contain additives to retain moisture): 1 large = 5.5 g, 7 kcal
  { names: ["shrimp", "cooked shrimp", "grilled shrimp", "boiled shrimp"], fdcId: 171971, alternatives: [171970] },
  // Crustaceans, shrimp, mixed species, cooked, breaded and fried: 1 large = 7.5 g, 18 kcal
  { names: ["fried shrimp", "breaded shrimp"], fdcId: 171970, alternatives: [171971] },
  // Fish, tilapia, cooked, dry heat: 1 fillet = 87 g, 111 kcal
  { names: ["tilapia"], fdcId: 175177, alternatives: [171956, 175168] },
  // Fish, cod, Atlantic, cooked, dry heat: 1 fillet = 180 g, 189 kcal
  { names: ["cod"], fdcId: 171956, alternatives: [175177, 175168] },
  // Fish, fish sticks, frozen, prepared: 1 stick = 28 g, 78 kcal
  {
    names: ["fish sticks", "fish fingers"],
    fdcId: 174195,
    unit: "each",
    portions: [{ unit: "each", label: "stick", grams: 28 }],
  },

  // ---------------------------------------------------------------- beans, tofu, nuts, spreads
  // Tofu, firm, prepared with calcium sulfate and magnesium chloride (nigari): 1 serving (3 oz) = 85 g, 66 kcal
  // Store firm tofu is about 80 kcal per 100 g; "Tofu, raw, firm, prepared with calcium sulfate" (144) is a denser kind.
  {
    names: ["tofu", "firm tofu"],
    fdcId: 172448,
    unit: "serving",
    portions: [{ unit: "serving", label: "serving (3 oz)", grams: 85 }],
  },
  // Beans, black, mature seeds, cooked, boiled, without salt: 1 cup = 172 g, 227 kcal
  { names: ["black beans"], fdcId: 173735, unit: "cup", alternatives: [175200, 175194] },
  // Beans, pinto, mature seeds, cooked, boiled, without salt: 1 cup = 171 g, 245 kcal
  { names: ["pinto beans"], fdcId: 175200, unit: "cup", alternatives: [173735, 175194] },
  // Beans, kidney, red, mature seeds, cooked, boiled, without salt: 1 cup = 177 g, 225 kcal
  { names: ["kidney beans"], fdcId: 175194, unit: "cup", alternatives: [173735, 175200] },
  // Chickpeas (garbanzo beans, bengal gram), mature seeds, cooked, boiled, without salt: 1 cup = 164 g, 269 kcal
  { names: ["chickpeas", "garbanzo beans"], fdcId: 173757, unit: "cup", alternatives: [173735, 175194] },
  // Refried beans, canned, traditional style: 1 cup = 238 g, 214 kcal
  { names: ["refried beans"], fdcId: 172438, unit: "cup", alternatives: [174296, 172465] },
  // Beans, baked, canned, with pork: 1 cup = 253 g, 268 kcal
  { names: ["baked beans"], fdcId: 175185, unit: "cup", alternatives: [173731] },
  // Hummus, commercial: 1 tbsp = 15 g, 36 kcal
  { names: ["hummus", "hommus"], fdcId: 174289, unit: "tbsp", alternatives: [172454] },
  // Peanut butter, smooth style, with salt (Includes foods for USDA's Food Distribution Program): 1 serving (2 tbsp) = 32 g, 191 kcal
  // Spread on an apple or toast, peanut butter is the label's 2 tbsp; "a spoonful" is 1 tbsp.
  {
    names: ["peanut butter", "pb", "creamy peanut butter", "smooth peanut butter"],
    fdcId: 174266,
    unit: "serving",
    alternatives: [174265, 172458, 168588],
    portions: [{ unit: "serving", label: "serving (2 tbsp)", grams: 32 }],
  },
  // Peanut butter, chunk style, with salt: 1 serving (2 tbsp) = 32 g, 189 kcal
  {
    names: ["crunchy peanut butter", "chunky peanut butter"],
    fdcId: 174265,
    unit: "serving",
    alternatives: [174266],
    portions: [{ unit: "serving", label: "serving (2 tbsp)", grams: 32 }],
  },
  // Peanut butter, smooth, reduced fat: 1 serving (2 tbsp) = 36 g, 187 kcal
  {
    names: ["reduced fat peanut butter"],
    fdcId: 172458,
    unit: "serving",
    alternatives: [174266],
    portions: [{ unit: "serving", label: "serving (2 tbsp)", grams: 36 }],
  },
  // Nuts, almond butter, plain, without salt added: 1 serving (2 tbsp) = 32 g, 197 kcal
  {
    names: ["almond butter"],
    fdcId: 168588,
    unit: "serving",
    alternatives: [174266],
    portions: [{ unit: "serving", label: "serving (2 tbsp)", grams: 32 }],
  },
  // Chocolate-flavored hazelnut spread: 1 serving (37 g) = 37 g, 199 kcal
  {
    names: ["nutella", "hazelnut spread", "chocolate hazelnut spread"],
    fdcId: 168000,
    portions: [{ unit: "tbsp", label: "tbsp", grams: 18.5 }],
  },
  // Nuts, almonds: 1 oz = 28.3 g, 164 kcal
  { names: ["almonds"], fdcId: 170567, unit: "oz", alternatives: [168596] },
  // Peanuts, all types, dry-roasted, with salt: 1 oz = 28.3 g, 166 kcal
  { names: ["peanuts", "roasted peanuts"], fdcId: 174262, unit: "oz" },
  // Nuts, cashew nuts, dry roasted, with salt added: 1 oz = 28.3 g, 163 kcal
  { names: ["cashews"], fdcId: 169421, unit: "oz" },
  // Nuts, walnuts, english: 1 oz = 28.3 g, 185 kcal
  { names: ["walnuts"], fdcId: 170187, unit: "oz" },
  // Nuts, pistachio nuts, dry roasted, with salt added: 1 oz = 28.3 g, 161 kcal
  { names: ["pistachios"], fdcId: 169426, unit: "oz" },
  // Nuts, mixed nuts, dry roasted, with peanuts, with salt added: 1 oz = 28.3 g, 168 kcal
  { names: ["mixed nuts", "nuts"], fdcId: 168599, unit: "oz", alternatives: [170567, 174262] },
  // Snacks, trail mix, regular: 1 oz = 28.3 g, 131 kcal
  { names: ["trail mix"], fdcId: 167561, unit: "oz", alternatives: [167969] },
  // Seeds, sunflower seed kernels, dry roasted, with salt added: 1 oz = 28.3 g, 165 kcal
  { names: ["sunflower seeds"], fdcId: 169418, unit: "oz" },
  // Beverages, Protein powder whey based: 1 scoop = 32 g, 113 kcal
  // USDA's portion is "1/3 cup" at the same 32 g; isolate and soy powders list their own scoops.
  {
    names: ["protein powder", "whey protein", "whey protein powder", "whey", "protein scoop"],
    fdcId: 173180,
    unit: "scoop",
    alternatives: [173177, 173181],
    portions: [{ unit: "scoop", label: "scoop", grams: 32 }],
  },

  // ---------------------------------------------------------------- rice, pasta, grains
  // Rice, white, long-grain, regular, enriched, cooked: 1 cup = 158 g, 205 kcal
  {
    names: ["rice", "white rice", "cooked rice", "steamed rice", "cooked white rice"],
    fdcId: 168878,
    unit: "cup",
    alternatives: [169704, 334536],
  },
  // Rice, brown, long-grain, cooked (Includes foods for USDA's Food Distribution Program): 1 cup = 202 g, 249 kcal
  { names: ["brown rice", "cooked brown rice"], fdcId: 169704, unit: "cup", alternatives: [168878, 334536] },
  // Restaurant, Chinese, fried rice, without meat: 1 cup = 133 g, 231 kcal
  {
    names: ["fried rice", "chinese fried rice", "vegetable fried rice"],
    fdcId: 334536,
    unit: "cup",
    alternatives: [167668, 168878],
  },
  // Pasta, cooked, enriched, without added salt: 1 cup, lasagne = 116 g, 183 kcal
  {
    names: ["pasta", "noodles", "cooked pasta", "penne", "macaroni"],
    fdcId: 169737,
    unit: "cup",
    alternatives: [168919, 167680],
  },
  // Noodles, egg, cooked, enriched, with added salt: 1 cup = 160 g, 221 kcal
  { names: ["egg noodles"], fdcId: 168919, unit: "cup", alternatives: [169737] },
  // Restaurant, Italian, spaghetti with meat sauce: 1 cup = 250 g, 303 kcal
  {
    names: ["spaghetti", "spaghetti with meat sauce", "spaghetti with sauce", "spaghetti bolognese"],
    fdcId: 167680,
    unit: "cup",
    alternatives: [169737, 169029, 169033],
    portions: [{ unit: "cup", label: "cup", grams: 250 }],
  },
  // Restaurant, family style, spaghetti and meatballs: 1 cup = 134 g, 228 kcal
  {
    names: ["spaghetti and meatballs", "spaghetti with meatballs"],
    fdcId: 169029,
    unit: "cup",
    alternatives: [167680],
  },
  // Macaroni and cheese, box mix with cheese sauce, prepared: 1 cup, prepared = 189 g, 310 kcal
  {
    names: ["mac and cheese", "macaroni and cheese", "mac n cheese", "boxed mac and cheese"],
    fdcId: 169770,
    unit: "cup",
    alternatives: [173342, 173325],
  },
  // Restaurant, Italian, lasagna with meat: 1 piece (about 1 cup) = 250 g, 463 kcal
  // Homemade and restaurant lasagna is about 185 kcal per 100 g; frozen entrees (124) are the
  // alternative. USDA's one portion is a 457 g restaurant plate, so a piece is my estimate.
  {
    names: ["lasagna", "lasagne", "meat lasagna"],
    fdcId: 169850,
    unit: "piece",
    alternatives: [173334],
    portions: [{ unit: "piece", label: "piece (about 1 cup)", grams: 250 }],
  },
  // Soup, ramen noodle, any flavor, dry: 1 package (3 oz, with seasoning) = 87 g, 383 kcal
  {
    names: ["ramen", "ramen noodles", "instant ramen", "instant noodles"],
    fdcId: 171177,
    unit: "each",
    portions: [{ unit: "each", label: "package (3 oz, with seasoning)", grams: 87 }],
  },
  // normalizeQuery turns "oatmeal" into "oats cooked", so that phrase is a name too.
  // Cereals, oats, regular and quick, unenriched, cooked with water (includes boiling and microwaving), without salt: 1 cup = 234 g, 166 kcal
  {
    names: ["oatmeal", "porridge", "oats", "cooked oats", "oats cooked"],
    fdcId: 173905,
    unit: "cup",
    alternatives: [171662, 173920],
  },
  // Cereals, oats, instant, fortified, maple and brown sugar, dry: 1 packet (1.5 oz) = 43 g, 166 kcal
  {
    names: ["instant oatmeal", "maple brown sugar oatmeal"],
    fdcId: 173920,
    unit: "packet",
    alternatives: [173905],
    portions: [{ unit: "packet", label: "packet (1.5 oz)", grams: 43 }],
  },
  // Cereals, corn grits, white, regular and quick, enriched, cooked with water, without salt: 1 cup = 257 g, 183 kcal
  { names: ["grits"], fdcId: 171655, unit: "cup" },
  // Cereals ready-to-eat, granola, homemade: 1 serving (1/2 cup) = 61 g, 298 kcal
  // Granola is eaten by the half cup, and less on yogurt ("yogurt with granola"); a cup is 597 kcal.
  {
    names: ["granola"],
    fdcId: 171646,
    unit: "serving",
    portions: [{ unit: "serving", label: "serving (1/2 cup)", grams: 61 }],
  },
  // Cereals ready-to-eat, GENERAL MILLS, CHEERIOS: 1 cup = 28 g, 104 kcal
  { names: ["cheerios"], fdcId: 173884, unit: "cup", alternatives: [174648, 172990] },
  // Cereals ready-to-eat, GENERAL MILLS, CHEERIOS: 1 cup = 28 g, 104 kcal
  // "A bowl of cereal": the independent labels' generic cold cereal, dry, with milk logged on its own.
  {
    names: ["cereal", "cold cereal", "breakfast cereal", "bowl of cereal"],
    fdcId: 173884,
    unit: "cup",
    alternatives: [172990, 174648, 171650],
  },
  // Cereals ready-to-eat, MALT-O-MEAL, Frosted Flakes: 1 cup = 41.3 g, 161 kcal
  { names: ["frosted flakes"], fdcId: 172990, unit: "cup", alternatives: [174648, 173884] },
  // Cereals ready-to-eat, RALSTON Corn Flakes: 1 cup = 28 g, 108 kcal
  { names: ["corn flakes", "cornflakes"], fdcId: 174648, unit: "cup", alternatives: [172990, 173884] },
  // Cereals ready-to-eat, POST Raisin Bran Cereal: 1 cup = 59 g, 191 kcal
  { names: ["raisin bran"], fdcId: 171650, unit: "cup", alternatives: [174648, 173884] },
  // Cereals ready-to-eat, QUAKER, CAP'N CRUNCH: 1 cup = 36 g, 143 kcal
  { names: ["capn crunch", "captain crunch"], fdcId: 171642, unit: "cup", alternatives: [171643, 172990] },
  // Cereals ready-to-eat, QUAKER, QUAKER OAT LIFE, plain: 1 cup = 42.7 g, 160 kcal
  { names: ["life cereal"], fdcId: 173891, unit: "cup", alternatives: [174620, 173884] },

  // ---------------------------------------------------------------- bread and bakery
  // Bread, white, commercially prepared (includes soft bread crumbs): 1 slice = 29 g, 77 kcal
  { names: ["bread", "white bread"], fdcId: 174924, alternatives: [172688, 168013, 174925] },
  // Bread, white, commercially prepared, toasted: 1 slice = 22 g, 64 kcal
  { names: ["toast", "white toast"], fdcId: 174925, alternatives: [172689, 174924] },
  // Bread, whole-wheat, commercially prepared: 1 slice = 32 g, 81 kcal
  {
    names: ["whole wheat bread", "wheat bread", "brown bread"],
    fdcId: 172688,
    alternatives: [172689, 168013, 174924],
  },
  // Bread, whole-wheat, commercially prepared, toasted: 1 slice = 25 g, 77 kcal
  { names: ["wheat toast", "whole wheat toast"], fdcId: 172689, alternatives: [174925, 172688] },
  // Bread, multi-grain (includes whole-grain): 1 slice, large = 41 g, 109 kcal
  {
    names: ["multigrain bread", "multi grain bread", "whole grain bread"],
    fdcId: 168013,
    alternatives: [172688, 174914],
  },
  // Bagels, plain, enriched, with calcium propionate (includes onion, poppy, sesame): 1 bagel = 99 g, 261 kcal
  { names: ["bagel", "plain bagel"], fdcId: 174899, alternatives: [172664, 174900] },
  // Muffins, English, plain, enriched, with ca prop (includes sourdough): 1 muffin = 57 g, 129 kcal
  { names: ["english muffin"], fdcId: 174994, alternatives: [172762, 174995] },
  // Tortillas, ready-to-bake or -fry, flour, shelf stable: 1 tortilla = 49 g, 146 kcal
  { names: ["tortilla", "flour tortilla"], fdcId: 167535, alternatives: [175036, 174081] },
  // Tortillas, ready-to-bake or -fry, corn: 1 tortilla = 24 g, 52 kcal
  { names: ["corn tortilla"], fdcId: 175036, alternatives: [167535] },
  // Bread, pita, white, enriched: 1 large pita = 60 g, 165 kcal
  { names: ["pita", "pita bread"], fdcId: 174915, alternatives: [174916] },
  // Fast food, biscuit: 1 biscuit = 55 g, 204 kcal
  { names: ["biscuit"], fdcId: 170302 },
  // Croissants, butter: 1 medium croissant = 57 g, 231 kcal
  { names: ["croissant", "butter croissant"], fdcId: 174987, unit: "medium" },
  // Rolls, dinner, plain, prepared from recipe, made with low fat (2%) milk: 1 roll = 35 g, 111 kcal
  { names: ["dinner roll", "roll", "bread roll"], fdcId: 172810, alternatives: [175030] },
  // Rolls, hamburger or hotdog, plain: 1 roll = 44 g, 123 kcal
  { names: ["hamburger bun", "hot dog bun", "bun", "burger bun"], fdcId: 172796, alternatives: [174090] },
  // Garlic bread, frozen: 1 slice = 59 g, 207 kcal
  { names: ["garlic bread"], fdcId: 167939 },
  // Bread, cornbread, prepared from recipe, made with low fat (2%) milk: 1 piece = 65 g, 173 kcal
  { names: ["cornbread", "corn bread"], fdcId: 174910 },
  // Muffins, blueberry, commercially prepared (Includes mini-muffins): 1 medium = 113 g, 424 kcal
  { names: ["muffin", "blueberry muffin"], fdcId: 172765, unit: "medium", alternatives: [172768, 172767] },
  // Doughnuts, yeast-leavened, glazed, enriched (includes honey buns): 1 medium doughnut = 60 g, 253 kcal
  {
    names: ["donut", "doughnut", "glazed donut", "glazed doughnut"],
    fdcId: 172758,
    unit: "medium",
    alternatives: [174991, 172759],
  },
  // Cinnamon buns, frosted (includes honey buns): 1 bun = 65 g, 294 kcal
  { names: ["cinnamon roll", "cinnamon bun", "honey bun"], fdcId: 167940 },
  // Toaster Pastries, fruit, frosted (include apples, blueberry, cherry, strawberry): 1 piece = 53 g, 204 kcal
  {
    names: ["pop tart", "poptart", "toaster pastry", "frosted pop tart"],
    fdcId: 167927,
    alternatives: [172801, 175035],
  },
  // Pancakes, buttermilk, prepared from recipe: 1 pancake = 38 g, 86 kcal
  { names: ["pancakes", "buttermilk pancakes"], fdcId: 175047, alternatives: [175009, 172773, 175006] },
  // Waffles, plain, frozen, ready -to-heat, toasted: 1 waffle = 33 g, 103 kcal
  { names: ["waffles", "eggo", "eggo waffles", "frozen waffles"], fdcId: 175048, alternatives: [175039, 167516] },
  // French toast, prepared from recipe, made with low fat (2%) milk: 1 slice = 65 g, 149 kcal
  { names: ["french toast"], fdcId: 174998, alternatives: [172035] },
  // Fast foods, french toast sticks: 1 piece = 21.8 g, 74 kcal
  { names: ["french toast sticks"], fdcId: 172035, alternatives: [174998] },
  // Fast foods, potatoes, hash browns, round pieces or patty: 1 patty = 53 g, 144 kcal
  { names: ["hash browns", "hashbrowns"], fdcId: 173273 },

  // ---------------------------------------------------------------- fast food and takeout
  // Fast foods, hamburger; single, regular patty; with condiments: 1 sandwich = 97 g, 255 kcal
  { names: ["hamburger", "burger"], fdcId: 170694, alternatives: [170691, 173319, 170693] },
  // Fast foods, cheeseburger; single, regular patty, with condiments: 1 cheeseburger = 127 g, 343 kcal
  {
    names: ["cheeseburger", "cheese burger"],
    fdcId: 170691,
    unit: "each",
    alternatives: [170694, 173319, 170690],
  },
  // Fast foods, cheeseburger; double, regular patty; with condiments: 1 sandwich = 155 g, 437 kcal
  { names: ["double cheeseburger", "double cheese burger"], fdcId: 173319, alternatives: [170691, 170694] },
  // McDONALD'S, BIG MAC: 1 item = 219 g, 563 kcal
  { names: ["big mac"], fdcId: 170720, unit: "each", alternatives: [170719, 170321] },
  // McDONALD'S, QUARTER POUNDER: 1 item = 171 g, 417 kcal
  { names: ["quarter pounder"], fdcId: 170321, unit: "each", alternatives: [170719, 170720] },
  // McDONALD'S, QUARTER POUNDER with Cheese: 1 item = 199 g, 513 kcal
  {
    names: ["quarter pounder with cheese", "qpc"],
    fdcId: 170719,
    unit: "each",
    alternatives: [170321, 170720],
  },
  // Fast foods, chicken fillet sandwich, plain with pickles: 1 sandwich = 187 g, 468 kcal
  {
    names: ["chicken sandwich", "fried chicken sandwich", "crispy chicken sandwich"],
    fdcId: 170295,
    alternatives: [170318, 170368],
  },
  // Fast Foods, grilled chicken filet sandwich, with lettuce, tomato and spread: 1 sandwich = 230 g, 419 kcal
  { names: ["grilled chicken sandwich"], fdcId: 170368, alternatives: [170295, 170318] },
  // Fast foods, fish sandwich, with tartar sauce: 1 sandwich = 220 g, 565 kcal
  { names: ["fish sandwich"], fdcId: 170296, alternatives: [170297] },
  // Fast foods, english muffin, with egg, cheese, and canadian bacon: 1 sandwich = 126 g, 287 kcal
  {
    names: ["egg mcmuffin", "breakfast sandwich"],
    fdcId: 172033,
    alternatives: [170787, 172031, 172029],
  },
  // Fast foods, biscuit, with egg, cheese, and bacon: 1 item = 145 g, 436 kcal
  // A deli "bacon egg and cheese"; the McGriddle (449) and croissant (370) versions are alternatives.
  {
    names: ["bacon egg and cheese", "bacon egg and cheese sandwich", "bacon egg and cheese biscuit", "bec"],
    fdcId: 172029,
    unit: "each",
    alternatives: [173300, 173269, 172033],
  },
  // Fast foods, biscuit, with sausage: 1 biscuit sandwich = 111 g, 412 kcal
  {
    names: ["sausage biscuit"],
    fdcId: 172031,
    unit: "each",
    alternatives: [172033],
  },
  // Fast foods, breakfast burrito, with egg, cheese, and sausage: 1 burrito = 109 g, 302 kcal
  { names: ["breakfast burrito"], fdcId: 170787, alternatives: [172033] },
  // Fast foods, potato, french fried in vegetable oil: 1 medium order = 117 g, 365 kcal
  {
    names: ["french fries", "fries"],
    fdcId: 170698,
    unit: "medium",
    alternatives: [173273, 170697],
    portions: [
      { unit: "small", label: "small order", grams: 71 },
      { unit: "medium", label: "medium order", grams: 117 },
      { unit: "large", label: "large order", grams: 154 },
    ],
  },
  // Fast foods, onion rings, breaded and fried: 1 serving (order (18 rings)) = 117 g, 481 kcal
  {
    names: ["onion rings"],
    fdcId: 170697,
    unit: "serving",
    portions: [
      { unit: "serving", label: "order (18 rings)", grams: 117 },
      { unit: "each", label: "onion ring", grams: 6.5 },
    ],
  },
  // Fast foods, nachos, with cheese: 1 serving (80 g) = 80 g, 274 kcal
  { names: ["nachos", "nachos with cheese"], fdcId: 170291, alternatives: [170292] },
  // Fast foods, taco with beef, cheese and lettuce, hard shell: 1 taco = 69 g, 156 kcal
  {
    names: ["taco", "beef taco", "hard taco", "crunchy taco"],
    fdcId: 170689,
    unit: "each",
    alternatives: [170763, 170764],
    portions: [{ unit: "each", label: "taco", grams: 69 }],
  },
  // Fast foods, taco with beef, cheese and lettuce, soft: 1 taco = 102 g, 210 kcal
  {
    names: ["soft taco", "beef soft taco"],
    fdcId: 170763,
    unit: "each",
    alternatives: [170689, 170764],
    portions: [{ unit: "each", label: "taco", grams: 102 }],
  },
  // Fast foods, taco with chicken, lettuce and cheese, soft: 1 taco = 98 g, 185 kcal
  {
    names: ["chicken taco", "chicken soft taco"],
    fdcId: 170764,
    unit: "each",
    alternatives: [170763, 170689],
    portions: [{ unit: "each", label: "taco", grams: 98 }],
  },
  // Fast foods, burrito, with beans, cheese, and beef: 1 burrito = 241 g, 434 kcal
  { names: ["burrito", "beef burrito", "beef and bean burrito"], fdcId: 173278, alternatives: [172039, 172038] },
  // Fast foods, burrito, with beans and cheese: 1 burrito = 185 g, 379 kcal
  {
    names: ["bean burrito", "bean and cheese burrito"],
    fdcId: 172039,
    unit: "each",
    alternatives: [173278, 172038],
    portions: [{ unit: "each", label: "burrito", grams: 185 }],
  },
  // Restaurant, Mexican, cheese quesadilla: 1 quesadilla = 194 g, 714 kcal
  { names: ["quesadilla", "cheese quesadilla"], fdcId: 169035, alternatives: [170765] },
  // Fast foods, quesadilla, with chicken: 1 quesadilla = 180 g, 529 kcal
  {
    names: ["chicken quesadilla"],
    fdcId: 170765,
    unit: "each",
    alternatives: [169035],
    portions: [{ unit: "each", label: "quesadilla", grams: 180 }],
  },
  // Fast Food, Pizza Chain, 14" pizza, cheese topping, regular crust: 1 slice = 107 g, 285 kcal
  {
    names: ["pizza", "cheese pizza", "pizza slice"],
    fdcId: 173292,
    unit: "slice",
    alternatives: [173295, 173293, 170367],
  },
  // Fast Food, Pizza Chain, 14" pizza, pepperoni topping, regular crust: 1 slice = 111 g, 313 kcal
  { names: ["pepperoni pizza"], fdcId: 173295, unit: "slice", alternatives: [173292, 170367] },
  // Fast Food, Pizza Chain, 14" pizza, sausage topping, regular crust: 1 slice = 116 g, 325 kcal
  { names: ["sausage pizza"], fdcId: 170367, unit: "slice", alternatives: [173295, 173292] },
  // Fast foods, breadstick, soft, prepared with garlic and parmesan cheese: 1 breadstick = 43 g, 148 kcal
  { names: ["breadsticks"], fdcId: 170788, alternatives: [167939] },
  // Fast foods, submarine sandwich, turkey breast on white bread with lettuce and tomato: 1 6-inch sub = 184 g, 271 kcal
  {
    names: ["turkey sandwich", "turkey sub"],
    fdcId: 170706,
    unit: "each",
    alternatives: [170707, 170696],
  },
  // Fast foods, submarine sandwich, ham on white bread with lettuce and tomato: 1 6-inch sub = 184 g, 278 kcal
  {
    names: ["ham sandwich", "ham sub"],
    fdcId: 170707,
    unit: "each",
    alternatives: [170706, 170696],
  },
  // Fast foods, submarine sandwich, tuna on white bread with lettuce and tomato: 1 6-inch sub = 237 g, 517 kcal
  {
    names: ["tuna sandwich", "tuna sub", "tuna salad sandwich"],
    fdcId: 170299,
    unit: "each",
    alternatives: [170706, 170696],
  },
  // Fast foods, submarine sandwich, cold cut on white bread with lettuce and tomato: 1 6-inch sub = 196 g, 418 kcal
  {
    names: ["sub", "sub sandwich", "submarine sandwich", "italian sub", "cold cut sub", "sandwich", "deli sandwich"],
    fdcId: 170696,
    unit: "each",
    alternatives: [170706, 170707],
  },
  // Fast foods, submarine sandwich, bacon, lettuce, and tomato on white bread: 1 6-inch sub = 148 g, 303 kcal
  {
    names: ["blt", "blt sandwich"],
    fdcId: 170313,
    unit: "each",
  },
  // Restaurant, Chinese, orange chicken: 1 serving (1/4 order, about 5.7 oz) = 162 g, 424 kcal
  {
    names: ["orange chicken"],
    fdcId: 167679,
    unit: "serving",
    alternatives: [167675],
    portions: [{ unit: "serving", label: "serving (1/4 order, about 5.7 oz)", grams: 162 }],
  },
  // Restaurant, Chinese, general tso's chicken: 1 serving (1/4 order) = 134 g, 395 kcal
  {
    names: ["general tsos chicken"],
    fdcId: 167675,
    unit: "serving",
    alternatives: [167679],
    portions: [{ unit: "serving", label: "serving (1/4 order)", grams: 134 }],
  },
  // Restaurant, Chinese, vegetable lo mein, without meat: 1 cup = 136 g, 165 kcal
  { names: ["lo mein", "vegetable lo mein"], fdcId: 167677, unit: "cup" },
  // Restaurant, Chinese, egg rolls, assorted: 1 piece = 89 g, 223 kcal
  { names: ["egg rolls"], fdcId: 167667, alternatives: [172103] },
  // Restaurant, Chinese, beef and vegetables: 1 serving (1/2 order, about 2 cups) = 287 g, 301 kcal
  // Beef and broccoli is USDA's beef and vegetables; a takeout order (574 g) is two servings.
  {
    names: ["beef and broccoli", "beef with broccoli", "beef and vegetables", "beef broccoli"],
    fdcId: 168072,
    unit: "serving",
    alternatives: [167678],
    portions: [
      { unit: "serving", label: "serving (1/2 order, about 2 cups)", grams: 287 },
      { unit: "order", label: "order", grams: 574 },
    ],
  },
  // Restaurant, Chinese, chicken and vegetables: 1 serving (1/2 order, about 2 cups) = 347 g, 330 kcal
  {
    names: ["chicken and broccoli", "chicken with broccoli", "chicken and vegetables"],
    fdcId: 167678,
    unit: "serving",
    alternatives: [168072],
    portions: [
      { unit: "serving", label: "serving (1/2 order, about 2 cups)", grams: 347 },
      { unit: "order", label: "order", grams: 693 },
    ],
  },
  // Potsticker or wonton, pork and vegetable, frozen, unprepared: 1 serving (6 dumplings) = 174 g, 237 kcal
  // Asian dumplings, the ones people mean; pierogi are the alternative. "Dumplings" with no count are six.
  {
    names: ["dumplings", "potstickers", "pot stickers", "gyoza", "wontons", "pork dumplings"],
    fdcId: 169773,
    unit: "piece",
    plural: "serving",
    alternatives: [169779],
    portions: [{ unit: "serving", label: "serving (6 dumplings)", grams: 174 }],
  },
  // Restaurant, Latino, chicken and rice, entree, prepared: 1 plate (about 1 3/4 cups) = 247 g, 430 kcal
  // USDA gives only a cup (141 g), and a plate of chicken and rice is more like 1 1/2 to 2 cups.
  {
    names: ["chicken and rice", "chicken with rice", "arroz con pollo"],
    fdcId: 167659,
    unit: "serving",
    portions: [{ unit: "serving", label: "plate (about 1 3/4 cups)", grams: 247 }],
  },

  // ---------------------------------------------------------------- soups and dinners
  // Soup, chunky chicken noodle, canned, ready-to-serve: 1 cup = 243 g, 100 kcal
  // Ready-to-serve, deli and homemade chicken noodle soups are about 40 kcal per 100 g; condensed
  // soup made up with water (24) is the alternative.
  {
    names: ["chicken noodle soup", "chicken soup"],
    fdcId: 171148,
    unit: "cup",
    alternatives: [172909, 174064],
    portions: [{ unit: "can", label: "can (18.7 oz)", grams: 530 }],
  },
  // Soup, tomato, canned, prepared with equal volume water, commercial: 1 serving (248 g) = 248 g, 79 kcal
  { names: ["tomato soup"], fdcId: 171176, alternatives: [174546] },
  // Chili with beans, canned: 1 cup = 256 g, 264 kcal
  { names: ["chili", "chili with beans"], fdcId: 175207, unit: "cup", alternatives: [172098] },
  // Chicken pot pie, frozen entree, prepared: 1 pie = 302 g, 616 kcal
  { names: ["chicken pot pie", "pot pie"], fdcId: 173331 },
  // Pizza rolls, frozen, unprepared: 1 serving (6 rolls) = 80 g, 262 kcal
  // "Pizza rolls" with no count are USDA's serving of six; a counted roll is 13 g.
  {
    names: ["pizza rolls", "totinos pizza rolls", "pizza bites"],
    fdcId: 168957,
    unit: "piece",
    plural: "serving",
    portions: [{ unit: "piece", label: "roll", grams: 13.3 }],
  },
  // Restaurant, family style, fried mozzarella sticks: 1 order (5 sticks) = 155 g, 504 kcal
  // USDA's serving (245 g) is a family-style platter; an order at most places is 4 to 6 sticks.
  {
    names: ["mozzarella sticks", "mozz sticks", "fried mozzarella sticks"],
    fdcId: 169015,
    unit: "piece",
    plural: "order",
    portions: [{ unit: "order", label: "order (5 sticks)", grams: 155 }],
  },

  // ---------------------------------------------------------------- vegetables and sides
  // Broccoli, cooked, boiled, drained, without salt: 1 cup, chopped = 156 g, 55 kcal
  { names: ["broccoli", "steamed broccoli", "cooked broccoli"], fdcId: 169967, unit: "cup", alternatives: [170379] },
  // Broccoli, raw: 1 serving (148 g) = 148 g, 50 kcal
  { names: ["raw broccoli"], fdcId: 170379, alternatives: [169967] },
  // Carrots, raw: 1 medium = 61 g, 25 kcal
  { names: ["carrots", "raw carrots"], fdcId: 170393, alternatives: [168568, 170394] },
  // Carrots, cooked, boiled, drained, without salt: 1 carrot = 46 g, 16 kcal
  { names: ["cooked carrots", "steamed carrots", "boiled carrots"], fdcId: 170394, alternatives: [170393, 168568] },
  // Carrots, baby, raw: 1 medium = 10 g, 4 kcal
  { names: ["baby carrots"], fdcId: 168568, alternatives: [170393, 170394] },
  // Spinach, raw: 1 cup = 30 g, 7 kcal
  { names: ["spinach", "raw spinach", "baby spinach"], fdcId: 168462, unit: "cup", alternatives: [168463, 169247] },
  // Spinach, cooked, boiled, drained, without salt: 1 cup = 180 g, 41 kcal
  { names: ["cooked spinach"], fdcId: 168463, unit: "cup", alternatives: [168462, 168421] },
  // Lettuce, cos or romaine, raw: 1 cup, shredded = 47 g, 8 kcal
  { names: ["lettuce", "romaine", "romaine lettuce"], fdcId: 169247, unit: "cup", alternatives: [169248, 168462] },
  // Lettuce, iceberg (includes crisphead types), raw: 1 cup, chopped = 57 g, 8 kcal
  { names: ["iceberg lettuce", "iceberg"], fdcId: 169248, unit: "cup", alternatives: [169247, 168462] },
  // Tomatoes, red, ripe, raw, year round average: 1 medium whole = 123 g, 22 kcal
  { names: ["tomato"], fdcId: 170457 },
  // Cucumber, with peel, raw: 1 cup, slices = 104 g, 16 kcal
  { names: ["cucumber"], fdcId: 168409, unit: "cup" },
  // Corn, sweet, yellow, cooked, boiled, drained, without salt: 1 cup, cut = 149 g, 143 kcal
  { names: ["corn", "sweet corn", "corn kernels"], fdcId: 169999, unit: "cup" },
  // Corn, sweet, yellow, cooked, boiled, drained, without salt: 1 ear, medium = 103 g, 99 kcal
  {
    names: ["corn on the cob", "corn cob"],
    fdcId: 169999,
    unit: "each",
    portions: [{ unit: "each", label: "ear, medium", grams: 103 }],
  },
  // Beans, snap, green, cooked, boiled, drained, without salt: 1 cup = 125 g, 44 kcal
  { names: ["green beans", "string beans"], fdcId: 169141, unit: "cup" },
  // Peas, green, frozen, cooked, boiled, drained, without salt: 1 cup = 160 g, 125 kcal
  { names: ["peas", "green peas"], fdcId: 170017, unit: "cup" },
  // Potatoes, baked, flesh and skin, without salt: 1 medium potato = 173 g, 161 kcal
  { names: ["potato", "baked potato"], fdcId: 170093, alternatives: [168555, 168483] },
  // Potatoes, mashed, home-prepared, whole milk and butter added: 1 cup = 210 g, 237 kcal
  { names: ["mashed potatoes"], fdcId: 168555, unit: "cup", alternatives: [170699, 170093] },
  // Sweet potato, cooked, baked in skin, flesh, without salt: 1 medium = 114 g, 103 kcal
  { names: ["sweet potato", "baked sweet potato", "yam"], fdcId: 168483, alternatives: [170093] },
  // Onions, raw: 1 medium = 110 g, 44 kcal
  { names: ["onion"], fdcId: 170000 },
  // Peppers, sweet, green, raw: 1 medium = 119 g, 24 kcal
  { names: ["bell pepper", "green pepper", "green bell pepper"], fdcId: 170427, alternatives: [170108, 169383] },
  // Peppers, sweet, red, raw: 1 medium = 119 g, 31 kcal
  { names: ["red pepper", "red bell pepper"], fdcId: 170108, alternatives: [170427, 169383] },
  // Mushrooms, white, raw: 1 cup, pieces = 70 g, 15 kcal
  { names: ["mushrooms"], fdcId: 169251, unit: "cup" },
  // Celery, raw: 1 stalk, medium = 40 g, 6 kcal
  {
    names: ["celery", "celery stick", "celery stalk"],
    fdcId: 169988,
    unit: "each",
    portions: [{ unit: "each", label: "stalk, medium", grams: 40 }],
  },
  // Cauliflower, cooked, boiled, drained, without salt: 1 cup = 124 g, 29 kcal
  { names: ["cauliflower"], fdcId: 170397, unit: "cup", alternatives: [169986] },
  // Squash, summer, zucchini, includes skin, cooked, boiled, drained, without salt: 1 cup, sliced = 180 g, 27 kcal
  { names: ["zucchini"], fdcId: 169292, unit: "cup", alternatives: [169291] },
  // Asparagus, cooked, boiled, drained: 1 cup = 180 g, 40 kcal
  { names: ["asparagus"], fdcId: 168390, unit: "cup" },
  // Brussels sprouts, cooked, boiled, drained, without salt: 1 cup = 156 g, 56 kcal
  { names: ["brussels sprouts"], fdcId: 169971, unit: "cup" },
  // Kale, raw: 1 cup = 21 g, 7 kcal
  { names: ["kale"], fdcId: 168421, unit: "cup" },
  // Cabbage, raw: 1 cup, chopped = 89 g, 22 kcal
  { names: ["cabbage"], fdcId: 169975, unit: "cup" },
  // Fast foods, coleslaw: 1 cup = 191 g, 292 kcal
  { names: ["coleslaw", "cole slaw", "slaw"], fdcId: 170300, unit: "cup" },
  // Edamame, frozen, prepared: 1 cup = 155 g, 188 kcal
  { names: ["edamame"], fdcId: 168411, unit: "cup" },
  // Vegetables, mixed, frozen, cooked, boiled, drained, without salt: 1 cup = 182 g, 118 kcal
  { names: ["mixed vegetables", "mixed veggies", "vegetables", "veggies"], fdcId: 170472, unit: "cup" },
  // Pickles, cucumber, dill or kosher dill: 1 large = 135 g, 16 kcal
  { names: ["pickle", "dill pickle"], fdcId: 168558 },
  // Olives, ripe, canned (small-extra large): 1 large = 4.4 g, 5 kcal
  { names: ["olives", "black olives"], fdcId: 169094, alternatives: [169096] },
  // Potato salad, home-prepared: 1 cup = 250 g, 358 kcal
  { names: ["potato salad"], fdcId: 169269, unit: "cup", alternatives: [173343] },
  // Avocados, raw, California: 1 fruit = 136 g, 227 kcal
  { names: ["avocado"], fdcId: 171706, alternatives: [171705] },

  // ---------------------------------------------------------------- fruit
  // Bananas, raw: 1 medium = 118 g, 105 kcal
  { names: ["banana"], fdcId: 173944 },
  // Apples, raw, with skin (Includes foods for USDA's Food Distribution Program): 1 medium = 182 g, 95 kcal
  { names: ["apple"], fdcId: 171688, alternatives: [168204, 168203] },
  // Oranges, raw, all commercial varieties: 1 fruit = 131 g, 62 kcal
  { names: ["orange"], fdcId: 169097, alternatives: [169105] },
  // Strawberries, raw: 1 medium = 12 g, 4 kcal
  { names: ["strawberries"], fdcId: 167762 },
  // Blueberries, raw: 1 cup = 148 g, 84 kcal
  { names: ["blueberries"], fdcId: 171711, unit: "cup" },
  // Raspberries, raw: 1 cup = 123 g, 64 kcal
  { names: ["raspberries"], fdcId: 167755, unit: "cup" },
  // Blackberries, raw: 1 cup = 144 g, 62 kcal
  { names: ["blackberries"], fdcId: 173946, unit: "cup" },
  // Grapes, red or green (European type, such as Thompson seedless), raw: 1 cup = 151 g, 104 kcal
  { names: ["grapes"], fdcId: 174683, unit: "cup" },
  // Cherries, sweet, raw: 1 cup, without pits = 154 g, 97 kcal
  { names: ["cherries"], fdcId: 171719, unit: "cup" },
  // Watermelon, raw: 1 slice (wedge, 1/16 melon) = 286 g, 86 kcal
  {
    names: ["watermelon"],
    fdcId: 167765,
    unit: "slice",
    portions: [{ unit: "slice", label: "slice (wedge, 1/16 melon)", grams: 286 }],
  },
  // Melons, cantaloupe, raw: 1 cup, cubes = 160 g, 54 kcal
  { names: ["cantaloupe"], fdcId: 169092, unit: "cup" },
  // Melons, honeydew, raw: 1 cup, balls = 177 g, 64 kcal
  { names: ["honeydew", "honeydew melon"], fdcId: 169911, unit: "cup" },
  // Pineapple, raw, all varieties: 1 cup, chunks = 165 g, 83 kcal
  { names: ["pineapple"], fdcId: 169124, unit: "cup" },
  // Mangos, raw: 1 fruit = 336 g, 202 kcal
  { names: ["mango"], fdcId: 169910 },
  // Peaches, yellow, raw: 1 medium = 150 g, 59 kcal
  { names: ["peach"], fdcId: 169928 },
  // Pears, raw: 1 medium = 178 g, 102 kcal
  { names: ["pear"], fdcId: 169118 },
  // Kiwifruit, green, raw: 1 fruit = 69 g, 42 kcal
  { names: ["kiwi", "kiwifruit"], fdcId: 168153 },
  // Plums, raw: 1 fruit = 66 g, 30 kcal
  { names: ["plum"], fdcId: 169949 },
  // Tangerines, (mandarin oranges), raw: 1 medium = 88 g, 47 kcal
  { names: ["clementine", "tangerine", "mandarin", "mandarin orange", "cutie"], fdcId: 169105 },
  // Grapefruit, raw, pink and red, all areas: 1 fruit = 246 g, 103 kcal
  { names: ["grapefruit"], fdcId: 174673 },
  // Raisins, dark, seedless (Includes foods for USDA's Food Distribution Program): 1 small box = 43 g, 129 kcal
  { names: ["raisins"], fdcId: 168165, unit: "small" },
  // Applesauce, canned, sweetened, without salt: 1 snack cup (4 oz) = 113 g, 77 kcal
  {
    names: ["applesauce", "apple sauce"],
    fdcId: 171696,
    unit: "each",
    alternatives: [2346414],
    portions: [{ unit: "each", label: "snack cup (4 oz)", grams: 113 }],
  },
  // Fruit cocktail, (peach and pineapple and pear and grape and cherry), canned, juice pack, solids and liquids: 1 snack cup (4 oz) = 113 g, 52 kcal
  {
    names: ["fruit cup", "fruit cocktail"],
    fdcId: 174668,
    unit: "each",
    portions: [{ unit: "each", label: "snack cup (4 oz)", grams: 113 }],
  },

  // ---------------------------------------------------------------- drinks
  // Beverages, coffee, brewed, prepared with tap water: 1 cup = 237 g, 2 kcal
  {
    names: ["coffee", "black coffee", "brewed coffee", "hot coffee", "iced coffee"],
    fdcId: 171890,
    unit: "cup",
    alternatives: [171891],
  },
  // Beverages, coffee, brewed, espresso, restaurant-prepared: 1 shot (1 fl oz) = 30 g, 3 kcal
  {
    names: ["espresso"],
    fdcId: 171891,
    unit: "shot",
    alternatives: [171890],
    portions: [{ unit: "shot", label: "shot (1 fl oz)", grams: 30 }],
  },
  // Beverages, tea, black, brewed, prepared with tap water: 1 cup = 237 g, 2 kcal
  { names: ["tea", "hot tea", "black tea", "brewed tea"], fdcId: 173227, unit: "cup", alternatives: [171917, 171888] },
  // Beverages, tea, green, brewed, regular: 1 cup = 245 g, 3 kcal
  { names: ["green tea"], fdcId: 171917, unit: "cup", alternatives: [173227, 171888] },
  // Beverages, tea, black, ready-to-drink, lemon, sweetened: 1 cup = 271 g, 122 kcal
  {
    names: ["iced tea", "sweet tea", "sweetened iced tea"],
    fdcId: 171888,
    unit: "cup",
    alternatives: [173227, 171917],
  },
  // Orange juice, chilled, includes from concentrate: 1 cup = 249 g, 122 kcal
  { names: ["orange juice", "oj"], fdcId: 169100, unit: "cup", alternatives: [169098, 173933] },
  // Apple juice, canned or bottled, unsweetened, without added ascorbic acid: 1 cup = 248 g, 114 kcal
  { names: ["apple juice"], fdcId: 173933, unit: "cup", alternatives: [169100, 173042] },
  // Grape juice, canned or bottled, unsweetened, without added ascorbic acid: 1 cup = 253 g, 152 kcal
  { names: ["grape juice"], fdcId: 173042, unit: "cup", alternatives: [173933, 169100] },
  // Cranberry juice cocktail, bottled: 1 cup = 253 g, 137 kcal
  { names: ["cranberry juice"], fdcId: 171903, unit: "cup", alternatives: [168117, 173042] },
  // Beverages, fruit punch drink, without added nutrients, canned: 1 cup = 248 g, 119 kcal
  { names: ["fruit punch"], fdcId: 171914, unit: "cup" },
  // Lemonade, frozen concentrate, white, prepared with water: 1 cup, 8 fl oz = 247 g, 99 kcal
  { names: ["lemonade"], fdcId: 173217, unit: "cup" },
  // Beverages, carbonated, cola, regular: 1 can (12 fl oz) = 370 g, 155 kcal
  {
    names: ["soda", "coke", "cola", "pop", "soda pop", "pepsi", "coca cola", "soft drink"],
    fdcId: 174852,
    unit: "can",
    alternatives: [175099, 173205, 173209],
    portions: [
      { unit: "can", label: "can (12 fl oz)", grams: 370 },
      { unit: "bottle", label: "bottle (20 fl oz)", grams: 614 },
      { unit: "small", label: "small (16 fl oz)", grams: 492 },
      { unit: "medium", label: "medium (22 fl oz)", grams: 676 },
      { unit: "large", label: "large (32 fl oz)", grams: 984 },
    ],
  },
  // Beverages, carbonated, low calorie, cola or pepper-type, with aspartame, contains caffeine: 1 can (12 fl oz) = 355 g, 7 kcal
  {
    names: ["diet coke", "diet soda", "diet pepsi", "coke zero", "diet cola"],
    fdcId: 175099,
    unit: "can",
    alternatives: [174852, 173209],
    portions: [
      { unit: "can", label: "can (12 fl oz)", grams: 355 },
      { unit: "bottle", label: "bottle (20 fl oz)", grams: 592 },
    ],
  },
  // Beverages, carbonated, lemon-lime soda, no caffeine: 1 can (12 fl oz) = 368 g, 151 kcal
  {
    names: ["sprite", "7up", "7 up", "lemon lime soda", "sierra mist"],
    fdcId: 173205,
    unit: "can",
    alternatives: [174852, 174846],
    portions: [
      { unit: "can", label: "can (12 fl oz)", grams: 368 },
      { unit: "bottle", label: "bottle (20 fl oz)", grams: 616 },
      { unit: "small", label: "small (16 fl oz)", grams: 491 },
      { unit: "medium", label: "medium (22 fl oz)", grams: 675 },
      { unit: "large", label: "large (32 fl oz)", grams: 982 },
    ],
  },
  // Beverages, carbonated, pepper-type, contains caffeine: 1 can (12 fl oz) = 368 g, 151 kcal
  {
    names: ["dr pepper", "doctor pepper"],
    fdcId: 173209,
    unit: "can",
    alternatives: [174852, 175099],
    portions: [
      { unit: "can", label: "can (12 fl oz)", grams: 368 },
      { unit: "bottle", label: "bottle (20 fl oz)", grams: 614 },
    ],
  },
  // Beverages, carbonated, root beer: 1 can (12 fl oz) = 370 g, 152 kcal
  {
    names: ["root beer"],
    fdcId: 171871,
    unit: "can",
    alternatives: [174852, 173209],
    portions: [{ unit: "can", label: "can (12 fl oz)", grams: 370 }],
  },
  // Beverages, carbonated, ginger ale: 1 can (12 fl oz) = 366 g, 124 kcal
  {
    names: ["ginger ale"],
    fdcId: 174846,
    unit: "can",
    alternatives: [173205, 174852],
    portions: [{ unit: "can", label: "can (12 fl oz)", grams: 366 }],
  },
  // Beverages, carbonated, club soda: 1 can (12 fl oz) = 355 g, 0 kcal
  {
    names: ["sparkling water", "club soda", "seltzer", "seltzer water"],
    fdcId: 174842,
    unit: "can",
    alternatives: [174158],
    portions: [{ unit: "can", label: "can (12 fl oz)", grams: 355 }],
  },
  // Water, bottled, generic: 1 cup = 237 g, 0 kcal
  {
    names: ["water", "bottled water"],
    fdcId: 174158,
    unit: "cup",
    alternatives: [174842],
    portions: [{ unit: "bottle", label: "bottle (16.9 fl oz)", grams: 500 }],
  },
  // Beverages, PEPSICO QUAKER, Gatorade, G performance O 2, ready-to-drink.: 1 bottle (20 fl oz) = 609 g, 158 kcal
  {
    names: ["gatorade", "sports drink", "powerade"],
    fdcId: 173660,
    unit: "bottle",
    portions: [{ unit: "bottle", label: "bottle (20 fl oz)", grams: 609 }],
  },
  // Beverages, Energy drink, RED BULL: 1 can (8.4 fl oz) = 258 g, 111 kcal
  {
    names: ["red bull"],
    fdcId: 173210,
    unit: "can",
    alternatives: [171935, 174822],
    portions: [{ unit: "can", label: "can (8.4 fl oz)", grams: 258 }],
  },
  // Beverages, Energy Drink, Monster, fortified with vitamins C, B2, B3, B6, B12: 1 can (16 fl oz) = 480 g, 226 kcal
  // Monster is the energy drink teens name most; USDA's generic HFCS energy drink (62 kcal/100 g, 298 a can)
  // is denser than any mainstream brand. Red Bull and sugar-free cans are the alternatives.
  {
    names: ["energy drink", "monster", "monster energy", "monster energy drink", "monster drink"],
    fdcId: 171935,
    unit: "can",
    alternatives: [173210, 174822, 173162],
    portions: [{ unit: "can", label: "can (16 fl oz)", grams: 480 }],
  },
  // Beverages, MONSTER energy drink, low carb: 1 can (16 fl oz) = 480 g, 24 kcal
  {
    names: ["monster zero", "monster low carb", "lo carb monster", "low carb monster", "sugar free monster"],
    fdcId: 173162,
    unit: "can",
    alternatives: [174822, 171935],
    portions: [{ unit: "can", label: "can (16 fl oz)", grams: 480 }],
  },
  // Beverages, Energy Drink, sugar free: 1 can (16 fl oz) = 480 g, 19 kcal
  {
    names: ["sugar free energy drink", "zero sugar energy drink", "diet energy drink"],
    fdcId: 174822,
    unit: "can",
    alternatives: [173162, 171935],
    portions: [{ unit: "can", label: "can (16 fl oz)", grams: 480 }],
  },
  // SILK Chai, soymilk: 1 medium (16 fl oz) = 486 g, 258 kcal
  // USDA's only chai latte: spiced chai with soy milk, within a few percent of a cafe's grande chai
  // latte with 2% milk (about 240 kcal). The powders Branded search finds are 400+ kcal per 100 g.
  {
    names: ["chai latte", "chai tea latte", "chai", "iced chai", "iced chai latte", "dirty chai"],
    fdcId: 173776,
    unit: "medium",
    portions: [
      { unit: "small", label: "small (12 fl oz)", grams: 365 },
      { unit: "medium", label: "medium (16 fl oz)", grams: 486 },
      { unit: "large", label: "large (20 fl oz)", grams: 608 },
    ],
  },
  // Beverages, fruit juice drink, reduced sugar, with vitamin E added: 1 pouch (6 fl oz) = 182 g, 71 kcal
  // A reduced-sugar juice drink blend, which is what Capri Sun is (about 50 to 60 kcal a pouch).
  {
    names: ["capri sun", "capri sun pouch", "juice pouch"],
    fdcId: 174176,
    unit: "pouch",
    alternatives: [171914],
    portions: [{ unit: "pouch", label: "pouch (6 fl oz)", grams: 182 }],
  },
  // Beverages, carbonated, cola, regular: 1 medium (22 fl oz) = 676 g, 284 kcal
  // A Slurpee or ICEE is frozen soda; USDA has no slush drink, and cola is the flavor sold most.
  {
    names: ["slurpee", "slushie", "icee", "frozen coke", "slush"],
    fdcId: 174852,
    unit: "medium",
    alternatives: [173205, 171914],
    portions: [{ unit: "medium", label: "medium (22 fl oz)", grams: 676 }],
  },
  // Beverages, Coconut water, ready-to-drink, unsweetened: 1 cup = 245 g, 44 kcal
  { names: ["coconut water"], fdcId: 174831, unit: "cup" },
  // Alcoholic beverage, beer, regular, all: 1 can (12 fl oz) = 356 g, 153 kcal
  {
    names: ["beer"],
    fdcId: 168746,
    unit: "can",
    alternatives: [168749],
    portions: [{ unit: "can", label: "can (12 fl oz)", grams: 356 }],
  },
  // Alcoholic beverage, beer, light: 1 can (12 fl oz) = 354 g, 103 kcal
  {
    names: ["light beer", "lite beer"],
    fdcId: 168749,
    unit: "can",
    alternatives: [168746],
    portions: [{ unit: "can", label: "can (12 fl oz)", grams: 354 }],
  },
  // Alcoholic beverage, wine, table, all: 1 serving (148 g) = 148 g, 123 kcal
  { names: ["wine"], fdcId: 173185, alternatives: [173190, 174837] },
  // Alcoholic beverage, wine, table, red: 1 serving (147 g) = 147 g, 125 kcal
  { names: ["red wine"], fdcId: 173190, alternatives: [174837, 173185] },
  // Alcoholic beverage, wine, table, white: 1 serving (147 g) = 147 g, 121 kcal
  { names: ["white wine"], fdcId: 174837, alternatives: [173190, 173185] },

  // ---------------------------------------------------------------- condiments, spreads, sweeteners
  // Catsup: 1 tbsp = 17 g, 17 kcal
  { names: ["ketchup", "catsup"], fdcId: 168556, unit: "tbsp" },
  // Mustard, prepared, yellow: 1 tsp, or 1 packet = 5 g, 3 kcal
  { names: ["mustard", "yellow mustard"], fdcId: 172234, unit: "tsp" },
  // Salad dressing, mayonnaise, regular: 1 tbsp = 13.8 g, 94 kcal
  { names: ["mayo", "mayonnaise"], fdcId: 171009, unit: "tbsp", alternatives: [173594] },
  // Salad dressing, ranch dressing, regular: 1 tbsp = 15 g, 65 kcal
  { names: ["ranch", "ranch dressing"], fdcId: 173592, unit: "tbsp", alternatives: [173593, 171019] },
  // Salad dressing, italian dressing, commercial, regular: 1 tbsp = 14.7 g, 35 kcal
  { names: ["italian dressing"], fdcId: 171019, unit: "tbsp", alternatives: [171405, 173592] },
  // Sauce, barbecue: 1 tbsp = 17 g, 29 kcal
  { names: ["bbq sauce", "barbecue sauce"], fdcId: 174523, unit: "tbsp" },
  // Sauce, ready-to-serve, pepper or hot: 1 tsp = 4.8 g, 1 kcal
  { names: ["hot sauce"], fdcId: 174527, unit: "tsp" },
  // Soy sauce made from soy and wheat (shoyu): 1 tbsp = 16 g, 9 kcal
  { names: ["soy sauce"], fdcId: 174277, unit: "tbsp" },
  // Sauce, salsa, ready-to-serve: 1 tbsp = 18 g, 5 kcal
  { names: ["salsa"], fdcId: 174524, unit: "tbsp" },
  // Sauce, pasta, spaghetti/marinara, ready-to-serve: 1 serving (132 g) = 132 g, 66 kcal
  { names: ["marinara", "marinara sauce", "spaghetti sauce", "pasta sauce"], fdcId: 171192 },
  // Oil, olive, salad or cooking: 1 tbsp = 13.5 g, 119 kcal
  { names: ["olive oil"], fdcId: 171413, unit: "tbsp" },
  // Honey: 1 tbsp = 21 g, 64 kcal
  { names: ["honey"], fdcId: 169640, unit: "tbsp" },
  // Jellies: 1 tbsp = 21 g, 56 kcal
  {
    names: ["jelly", "grape jelly"],
    fdcId: 169642,
    unit: "tbsp",
    alternatives: [169641],
    portions: [{ unit: "tbsp", label: "tbsp", grams: 21 }],
  },
  // Jams and preserves: 1 tbsp = 20 g, 56 kcal
  { names: ["jam", "strawberry jam", "preserves"], fdcId: 169641, unit: "tbsp", alternatives: [169642] },
  // Syrups, maple: 1 serving (83 g) = 83 g, 216 kcal
  { names: ["maple syrup"], fdcId: 169661, alternatives: [169578] },
  // Syrups, table blends, pancake: 1 serving (1/4 cup) = 78.5 g, 184 kcal
  {
    names: ["syrup", "pancake syrup"],
    fdcId: 169578,
    unit: "serving",
    alternatives: [169661],
    portions: [{ unit: "serving", label: "serving (1/4 cup)", grams: 78.5 }],
  },
  // Sugars, granulated: 1 tsp = 4.2 g, 16 kcal
  { names: ["sugar", "white sugar"], fdcId: 169655, unit: "tsp" },

  // ---------------------------------------------------------------- snacks
  // Snacks, potato chips, plain, salted: 1 oz = 28.3 g, 151 kcal
  { names: ["chips", "potato chips"], fdcId: 169677, unit: "oz", alternatives: [167962, 167558, 167559] },
  // Snacks, potato chips, barbecue-flavor: 1 oz = 28.3 g, 138 kcal
  { names: ["bbq chips", "barbecue chips"], fdcId: 167962, unit: "oz", alternatives: [169677, 167558] },
  // Snacks, tortilla chips, plain, white corn, salted: 1 oz = 28.3 g, 134 kcal
  { names: ["tortilla chips"], fdcId: 167558, unit: "oz", alternatives: [167559, 169677] },
  // Snacks, tortilla chips, nacho cheese: 1 oz = 28.3 g, 147 kcal
  {
    names: ["doritos", "nacho cheese chips", "nacho cheese doritos"],
    fdcId: 167559,
    unit: "oz",
    alternatives: [167558, 169677],
  },
  // Snacks, popcorn, oil-popped, white popcorn, salt added: 1 cup = 11 g, 55 kcal
  { names: ["popcorn"], fdcId: 170247, unit: "cup", alternatives: [167959] },
  // Snacks, pretzels, hard, plain, salted: 1 oz = 28.3 g, 109 kcal
  { names: ["pretzels", "hard pretzels"], fdcId: 167555, unit: "oz", alternatives: [169064] },
  // Pretzels, soft: 1 medium = 115 g, 389 kcal
  { names: ["soft pretzel"], fdcId: 169064, alternatives: [167555] },
  // Crackers, standard snack-type, regular: 1 cracker = 3.2 g, 16 kcal
  { names: ["crackers", "ritz crackers"], fdcId: 174982, alternatives: [172746, 174975] },
  // Crackers, saltines (includes oyster, soda, soup): 1 cracker = 3 g, 13 kcal
  { names: ["saltines", "saltine crackers"], fdcId: 172746, alternatives: [174982] },
  // Crackers, cheese, regular: 1 oz = 28.3 g, 139 kcal
  { names: ["cheez its", "cheezits", "cheese crackers"], fdcId: 174975, unit: "oz", alternatives: [168005, 174982] },
  // Pepperidge Farm, Goldfish, Baked Snack Crackers, Cheddar: 1 oz = 28.3 g, 130 kcal
  { names: ["goldfish", "goldfish crackers"], fdcId: 168005, unit: "oz", alternatives: [174975, 174982] },
  // Cookies, graham crackers, plain or honey (includes cinnamon): 1 cracker = 15 g, 65 kcal
  { names: ["graham crackers"], fdcId: 174957 },
  // Snacks, rice cakes, brown rice, plain, unsalted: 1 cake = 9 g, 35 kcal
  { names: ["rice cakes"], fdcId: 170250 },
  // Snacks, granola bars, soft, uncoated, plain: 1 bar = 28 g, 124 kcal
  {
    names: ["granola bar", "chewy granola bar"],
    fdcId: 167954,
    alternatives: [169674, 167542],
  },
  // Candies, fruit snacks, with high vitamin C: 1 pouch (0.9 oz) = 25.5 g, 90 kcal
  {
    names: ["fruit snacks"],
    fdcId: 170279,
    unit: "each",
    portions: [{ unit: "each", label: "pouch (0.9 oz)", grams: 25.5 }],
  },
  // Snacks, KELLOGG, KELLOGG'S RICE KRISPIES TREATS Squares: 1 serving (22 g) = 22 g, 92 kcal
  { names: ["rice krispie treat", "rice crispy treat"], fdcId: 169687 },
  // Puddings, chocolate, ready-to-eat: 1 snack cup (4 oz) = 113 g, 161 kcal
  {
    names: ["pudding", "chocolate pudding", "pudding cup"],
    fdcId: 168778,
    unit: "each",
    alternatives: [169608],
    portions: [{ unit: "each", label: "snack cup (4 oz)", grams: 113 }],
  },
  // Puddings, vanilla, ready-to-eat: 1 snack cup (4 oz) = 113 g, 147 kcal
  {
    names: ["vanilla pudding"],
    fdcId: 169608,
    unit: "each",
    alternatives: [168778],
    portions: [{ unit: "each", label: "snack cup (4 oz)", grams: 113 }],
  },

  // ---------------------------------------------------------------- cookies, cakes, candy
  // Cookies, chocolate chip, commercially prepared, regular, higher fat, enriched: 1 cookie = 12.2 g, 60 kcal
  {
    names: ["cookies", "chocolate chip cookies"],
    fdcId: 172716,
    alternatives: [172808, 172725, 174971],
  },
  // Cookies, oatmeal, with raisins: 1 cookie = 24 g, 106 kcal
  { names: ["oatmeal cookies", "oatmeal raisin cookies"], fdcId: 174963, alternatives: [172725, 172716] },
  // Cookies, sugar, commercially prepared, regular (includes vanilla): 1 cookie = 17 g, 79 kcal
  { names: ["sugar cookies"], fdcId: 174971, alternatives: [172716, 174963] },
  // Cookies, chocolate sandwich, with creme filling, regular: 1 cookie = 12 g, 56 kcal
  { names: ["oreos", "oreo cookies", "chocolate sandwich cookies"], fdcId: 172718, alternatives: [172720, 172716] },
  // Cookies, brownies, commercially prepared: 1 brownie (2-3/4 in square) = 56 g, 227 kcal
  {
    names: ["brownie"],
    fdcId: 172713,
    unit: "each",
    alternatives: [174949],
    portions: [{ unit: "each", label: "brownie (2-3/4 in square)", grams: 56 }],
  },
  // Cake, yellow, commercially prepared, with chocolate frosting, in-store bakery: 1 piece = 144 g, 546 kcal
  { names: ["cake", "birthday cake", "yellow cake"], fdcId: 174944, unit: "piece", alternatives: [174934, 174945] },
  // Cake, chocolate, commercially prepared with chocolate frosting, in-store bakery: 1 piece = 138 g, 537 kcal
  { names: ["chocolate cake"], fdcId: 174934, unit: "piece", alternatives: [174944, 172711] },
  // Cake, cheesecake, commercially prepared: 1 piece = 80 g, 257 kcal
  { names: ["cheesecake"], fdcId: 172711 },
  // Pie, apple, commercially prepared, enriched flour: 1 piece = 125 g, 296 kcal
  // Plain "pie" is apple, the pie sold most; pecan (541 a slice) is nearly twice as much.
  { names: ["apple pie", "pie"], fdcId: 175011, alternatives: [175012, 172787] },
  // Pie, pumpkin, commercially prepared: 1 slice = 133 g, 323 kcal
  { names: ["pumpkin pie"], fdcId: 172787, unit: "slice", alternatives: [172788] },
  // Candies, milk chocolate: 1 bar (1.55 oz) = 44 g, 235 kcal
  {
    names: ["chocolate", "chocolate bar", "milk chocolate", "hershey bar"],
    fdcId: 167587,
    unit: "bar",
    alternatives: [168754],
    portions: [{ unit: "bar", label: "bar (1.55 oz)", grams: 44 }],
  },
  // Candies, MARS SNACKFOOD US, SNICKERS Bar: 1 bar = 57 g, 280 kcal
  { names: ["snickers", "snickers bar"], fdcId: 169589 },
  // Candies, REESE'S Peanut Butter Cups: 1 pack (2 cups, 1.6 oz) = 45 g, 232 kcal
  {
    names: ["reeses", "reeses cup", "reeses peanut butter cup", "peanut butter cup"],
    fdcId: 168763,
    unit: "pack",
    portions: [
      { unit: "pack", label: "pack (2 cups, 1.6 oz)", grams: 45 },
      { unit: "each", label: "peanut butter cup", grams: 22.5 },
    ],
  },
  // Candies, KIT KAT Wafer Bar: 1 bar = 46 g, 238 kcal
  { names: ["kit kat", "kitkat"], fdcId: 167992 },
  // Candies, MARS SNACKFOOD US, TWIX Caramel Cookie Bars: 1 pack (2 bars, 2 oz) = 57 g, 286 kcal
  {
    names: ["twix"],
    fdcId: 168768,
    unit: "pack",
    portions: [
      { unit: "pack", label: "pack (2 bars, 2 oz)", grams: 57 },
      { unit: "each", label: "bar", grams: 28.5 },
    ],
  },
  // Candies, MARS SNACKFOOD US, M&M's Milk Chocolate Candies: 1 pack (1.69 oz) = 48 g, 236 kcal
  {
    names: ["m and ms", "mms", "m and m"],
    fdcId: 169583,
    unit: "pack",
    alternatives: [169582],
    portions: [{ unit: "pack", label: "pack (1.69 oz)", grams: 48 }],
  },
  // Candies, MARS SNACKFOOD US, SKITTLES Original Bite Size Candies: 1 serving (62 g) = 62 g, 251 kcal
  { names: ["skittles"], fdcId: 168843, unit: "serving" },
  // Candies, hard: 1 piece = 6 g, 24 kcal
  { names: ["hard candy"], fdcId: 167990 },
  // Candies, gumdrops, starch jelly pieces: 1 bag (1.4 oz, about 17 bears) = 39 g, 154 kcal
  // USDA's gummy candy; it lists 10 gummy bears at 22 g. "Gummy bears" with no count are a snack bag
  // (Haribo's 1.4 oz serving), "ten gummy bears" are ten.
  {
    names: ["gummy bears", "gummies", "gummy candy", "gumdrops"],
    fdcId: 167989,
    unit: "piece",
    plural: "bag",
    portions: [
      { unit: "piece", label: "gummy bear", grams: 2.2 },
      { unit: "bag", label: "bag (1.4 oz)", grams: 39 },
    ],
  },
  // Gelatin desserts, dry mix, prepared with water: 1 serving (1/2 cup) = 135 g, 81 kcal
  // Jell-O as eaten; USDA's own "serving" (21 g) is the dry mix it is made from.
  {
    names: ["jello", "jell o", "jello cup", "gelatin", "gelatin dessert"],
    fdcId: 169596,
    unit: "each",
    portions: [{ unit: "each", label: "serving (1/2 cup)", grams: 135 }],
  },
];

// ---------------------------------------------------------------- matching

/** "berries" and "berry", "fries" and "fry", "tomatoes" and "tomato" all become one word. */
function singular(word: string): string {
  if (word.length <= 2) return word;
  if (word.endsWith("ies")) return word.slice(0, -1); // berries -> berrie, cookies -> cookie
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ie`; // berry -> berrie
  if (/(oes|ches|shes|xes|sses|zzes)$/.test(word)) return word.slice(0, -2); // tomatoes -> tomato
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us")) return word.slice(0, -1);
  return word;
}

/**
 * The form names are compared in: like normalizeQuery (plain lowercase letters,
 * "&" read as "and", apostrophes dropped) with every other symbol a space and
 * each word singular. "Mac & Cheese!" and "mac and cheeses" give the same key.
 */
export function commonKey(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // combining accents, once NFKD has split them off
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9%]+/)
    .filter(Boolean)
    .map(singular)
    .join(" ");
}

const byKey = new Map<string, CommonFood>();
const portionsById = new Map<number, CommonPortion[]>();
const unitById = new Map<number, string>();
for (const food of COMMON_FOODS) {
  for (const name of food.names) {
    const key = commonKey(name);
    if (key && !byKey.has(key)) byKey.set(key, food);
  }
  if (food.unit && !unitById.has(food.fdcId)) unitById.set(food.fdcId, food.unit);
  if (food.portions?.length) {
    const list = portionsById.get(food.fdcId) ?? [];
    for (const p of food.portions) if (!list.some((q) => q.unit === p.unit)) list.push(p);
    portionsById.set(food.fdcId, list);
  }
}

/** Leading words that don't change which food it is: "a spicy chicken sandwich" is a chicken sandwich. */
const IGNORABLE = new Set(
  ["spicy", "homemade", "fresh", "classic", "original", "regular", "plain", "warm", "leftover"].map(singular),
);

/**
 * The table entry for a food phrase, or null. The whole phrase must match a
 * name, ignoring case, punctuation and simple plurals: "Eggs" and "egg" match,
 * "rice crackers" doesn't match "rice". Leading words like "spicy" or
 * "homemade" are dropped when the phrase has no entry as said. Takes the
 * spoken phrase or normalizeQuery's output ("oats cooked" and "catsup" are
 * names too).
 */
export function commonMatch(text: string): CommonFood | null {
  const key = commonKey(text);
  if (!key) return null;
  const exact = byKey.get(key);
  if (exact) return exact;
  const ws = key.split(" ");
  let i = 0;
  while (i < ws.length - 1 && IGNORABLE.has(ws[i])) i++;
  return (i > 0 && byKey.get(ws.slice(i).join(" "))) || null;
}

/**
 * The units to try first for a unitless mention of a table food: the entry's
 * `plural` unit when the phrase is a plural with no count ("dumplings", "a bag
 * of gummy bears"), then its `unit`. "Six dumplings" and "a dumpling" count.
 */
export function spokenUnits(entry: CommonFood | null, food: string, quantity: number): string[] {
  if (!entry) return [];
  const last = food.trim().toLowerCase().split(/\s+/).pop() ?? "";
  const uncounted = quantity === 1 && last.endsWith("s") && singular(last) !== last;
  return [uncounted ? entry.plural : undefined, entry.unit].filter((u): u is string => !!u);
}

/**
 * What a unitless mention of a table food means ("a soda" is a can), from the
 * first entry for its fdcId that names a unit; null for foods with none. An
 * alternative offered for another entry keeps its own entry's unit here.
 */
export function commonUnit(fdcId: number): string | null {
  return unitById.get(fdcId) ?? null;
}

/**
 * Extra units for a food, beyond what unitOptions finds in its USDA portions:
 * a can of soda, a container of yogurt. Empty for foods with none.
 */
export function commonPortions(fdcId: number): CommonPortion[] {
  return (portionsById.get(fdcId) ?? []).map((p) => ({ ...p }));
}
