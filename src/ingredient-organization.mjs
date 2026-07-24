const categoryRules = [
  {
    category: 'Frozen Foods',
    pattern: /\b(frozen|ice cream|popsicle|freezer)\b/i,
  },
  {
    category: 'Canned & Jarred',
    pattern: /\b(canned|can of|jarred|jar of|tinned|tin of)\b/i,
  },
  {
    category: 'Condiments & Cooking Staples',
    pattern: /\b(ketchup|mustard|mayonnaise|mayo|relish|hot sauce|soy sauce|sauce|salsa|dressing|vinegar|cooking oil|olive oil|vegetable oil|sesame oil|coconut oil|seasoning|spice|salt|pepper|paprika|cumin|oregano|thyme|rosemary|basil|cinnamon|nutmeg|broth|stock|bouillon|honey|syrup|jam|jelly|peanut butter|almond butter)\b/i,
  },
  {
    category: 'Meat & Seafood',
    pattern: /\b(chicken|turkey|beef|steak|ground meat|pork|ham|bacon|sausage|lamb|veal|duck|fish|salmon|tuna|shrimp|prawn|crab|lobster|scallop|tilapia|cod|sardine|anchovy|seafood|meatball|deli meat)\b/i,
  },
  {
    category: 'Dairy, Eggs & Alternatives',
    pattern: /\b(milk|cream|cheese|yogurt|yoghurt|butter|egg|eggs|half-and-half|sour cream|cottage cheese|tofu|tempeh)\b/i,
  },
  {
    category: 'Grains, Pasta & Baking',
    pattern: /\b(rice|pasta|spaghetti|macaroni|noodle|bread|bun|roll|tortilla|pita|naan|bagel|oat|oatmeal|cereal|quinoa|couscous|barley|flour|cornmeal|baking powder|baking soda|yeast|sugar|cracker|breadcrumb|granola)\b/i,
  },
  {
    category: 'Produce',
    pattern: /\b(apple|apricot|avocado|banana|berry|berries|blueberry|blueberries|raspberry|raspberries|strawberry|strawberries|blackberry|blackberries|orange|lemon|lime|grapefruit|grape|grapes|melon|watermelon|cantaloupe|mango|pineapple|peach|pear|plum|cherry|cherries|kiwi|coconut|tomato|tomatoes|potato|potatoes|onion|onions|garlic|ginger|carrot|carrots|celery|broccoli|cauliflower|spinach|lettuce|kale|cabbage|pepper|peppers|jalapeño|jalapeno|cucumber|zucchini|squash|corn|peas|green bean|green beans|mushroom|mushrooms|asparagus|vegetable|vegetables|fruit|fruits|herb|herbs|cilantro|parsley|basil|mint)\b/i,
  },
  {
    category: 'Snacks & Drinks',
    pattern: /\b(chips|pretzel|popcorn|cookie|cookies|candy|chocolate|snack|nuts|almonds|cashews|walnuts|peanuts|trail mix|protein bar|granola bar|juice|soda|sparkling water|coffee|tea|sports drink|energy drink|beer|wine)\b/i,
  },
]

export const INGREDIENT_CATEGORIES = [
  'Produce',
  'Meat & Seafood',
  'Dairy, Eggs & Alternatives',
  'Grains, Pasta & Baking',
  'Canned & Jarred',
  'Condiments & Cooking Staples',
  'Frozen Foods',
  'Snacks & Drinks',
  'Other',
]

const alphabetical = new Intl.Collator('en', {
  sensitivity: 'base',
  numeric: true,
})

export function sortIngredients(ingredients) {
  return [...ingredients].sort((first, second) => alphabetical.compare(first, second))
}

export function ingredientCategory(ingredient) {
  return categoryRules.find((rule) => rule.pattern.test(ingredient))?.category || 'Other'
}

export function groupIngredients(ingredients) {
  const grouped = new Map()
  for (const ingredient of sortIngredients(ingredients)) {
    const category = ingredientCategory(ingredient)
    const items = grouped.get(category) || []
    items.push(ingredient)
    grouped.set(category, items)
  }

  return INGREDIENT_CATEGORIES.flatMap((category) => {
    const items = grouped.get(category)
    return items?.length ? [{ category, ingredients: items }] : []
  })
}
