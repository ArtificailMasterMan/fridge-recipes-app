import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMealRecommendationPrompt,
  calculateRemainingMacros,
  MAX_MEAL_REQUEST_LENGTH,
  MealRecommendationError,
  mealFitsConstraints,
  mealFitsRemainingMacros,
  noFitMessage,
  normalizeMeal,
  normalizeMealConstraints,
  normalizeMealRequest,
  normalizeRemainingMacros,
  parseMealRecommendationResult,
  recommendationResponse,
  RETRY_RECOMMENDATION_MESSAGE,
  TRUNCATED_RECOMMENDATION_MESSAGE,
} from '../api/_meal-recommendations.mjs'

const validMeal = (overrides = {}) => ({
  name: 'Lemon chicken rice bowl',
  timeMinutes: 30,
  calories: 520,
  protein: 42,
  carbs: 58,
  fat: 14,
  macroFit: 'Fits the remaining daily budget',
  whyItFits: 'Savory chicken, bright lemon, and rice make a cohesive bowl.',
  ingredients: ['chicken breast', 'rice', 'lemon', 'olive oil'],
  requiredIngredients: ['lemon'],
  optionalUpgrades: ['parsley'],
  effort: 'standard',
  usesOven: false,
  flavorProfile: 'fresh',
  steps: ['Season and sear the chicken.', 'Serve it over cooked rice with lemon.'],
  ...overrides,
})

const messageResult = (value, stopReason = 'end_turn') => ({
  stop_reason: stopReason,
  content: [{ type: 'text', text: JSON.stringify(value) }],
})

test('normalizes a complete valid meal without coercing nutrition', () => {
  assert.deepEqual(normalizeMeal(validMeal()), validMeal())
})

test('rejects invalid nutrition instead of converting it to zero', () => {
  for (const value of [undefined, null, '42', Number.NaN, Number.POSITIVE_INFINITY, -1, 20_001]) {
    assert.equal(normalizeMeal(validMeal({ protein: value })), null)
  }
})

test('rejects blank names, incomplete structured fields, invalid time, and empty steps', () => {
  assert.equal(normalizeMeal(validMeal({ name: '   ' })), null)
  assert.equal(normalizeMeal(validMeal({ whyItFits: '' })), null)
  assert.equal(normalizeMeal(validMeal({ ingredients: [] })), null)
  assert.equal(normalizeMeal(validMeal({ effort: 'huge' })), null)
  assert.equal(normalizeMeal(validMeal({ usesOven: 'no' })), null)
  assert.equal(normalizeMeal(validMeal({ flavorProfile: 'sweet' })), null)
  assert.equal(normalizeMeal(validMeal({ timeMinutes: '30' })), null)
  assert.equal(normalizeMeal(validMeal({ steps: [] })), null)
})

test('normalizes bounded meal preferences and hard exclusions', () => {
  assert.deepEqual(normalizeMealConstraints({
    maxTime: 30.4,
    effort: 'minimal',
    oven: 'no-oven',
    flavor: 'spicy',
    avoidedIngredients: [' Mushroom ', 'mushroom', 'pork'],
    rejectedMeals: ['Old bowl'],
  }), {
    maxTime: 30,
    effort: 'minimal',
    oven: 'no-oven',
    flavor: 'spicy',
    avoidedIngredients: ['Mushroom', 'pork'],
    rejectedMeals: ['Old bowl'],
  })
  assert.deepEqual(normalizeMealConstraints({ maxTime: 2, effort: 'hard', oven: 'sometimes', flavor: 'sweet' }), {
    maxTime: null,
    effort: 'any',
    oven: 'any',
    flavor: 'any',
    avoidedIngredients: [],
    rejectedMeals: [],
  })
})

test('enforces time, effort, oven, flavor, rejected names, and avoided foods', () => {
  assert.equal(mealFitsConstraints(validMeal(), { maxTime: 30, flavor: 'fresh' }), true)
  assert.equal(mealFitsConstraints(validMeal(), { maxTime: 20 }), false)
  assert.equal(mealFitsConstraints(validMeal(), { effort: 'minimal' }), false)
  assert.equal(mealFitsConstraints(validMeal({ usesOven: true }), { oven: 'no-oven' }), false)
  assert.equal(mealFitsConstraints(validMeal(), { flavor: 'spicy' }), false)
  assert.equal(mealFitsConstraints(validMeal(), { rejectedMeals: ['Lemon chicken rice bowl'] }), false)
  assert.equal(mealFitsConstraints(validMeal(), { avoidedIngredients: ['lemon'] }), false)
  assert.equal(mealFitsConstraints(validMeal({ name: 'Chicken bowl', whyItFits: 'A savory rice bowl.', ingredients: ['chicken', 'rice'], requiredIngredients: [], optionalUpgrades: [], steps: ['Cook chicken.', 'Serve with rice.'] }), { avoidedIngredients: ['lemon'] }), true)
})

test('filters every applicable remaining macro regardless of macroFit prose', () => {
  const remaining = { calories: 520, protein: 42, carbs: 58, fat: 14 }
  assert.equal(mealFitsRemainingMacros(validMeal(), remaining), true)
  for (const key of ['calories', 'protein', 'carbs', 'fat']) {
    assert.equal(mealFitsRemainingMacros(validMeal({ [key]: remaining[key] + 0.1, macroFit: 'Perfect fit' }), remaining), false)
  }
})

test('returns no-fit message when every meal exceeds a limit or hard choice', () => {
  const remaining = { calories: 400, protein: 50, carbs: 80, fat: 20 }
  assert.deepEqual(recommendationResponse({ meals: [validMeal()] }, remaining), { meals: [], message: noFitMessage(remaining) })
  assert.deepEqual(recommendationResponse({ meals: [validMeal()] }, null, { effort: 'minimal' }), { meals: [], message: noFitMessage(null) })
})

test('keeps valid meals, rejects malformed meals, and caps output at three', () => {
  const value = { meals: [validMeal({ name: 'One' }), validMeal({ name: 'Invalid', calories: '500' }), validMeal({ name: 'Two' }), validMeal({ name: 'Three' }), validMeal({ name: 'Four' })] }
  assert.deepEqual(recommendationResponse(value, null).meals.map((meal) => meal.name), ['One', 'Two', 'Three'])
})

test('calculates server-side remaining macros and clamps consumed overages', () => {
  assert.deepEqual(calculateRemainingMacros(
    { calories: 2_000, protein: 150, carbs: 200, fat: 70 },
    [{ calories: 800, protein: 60, carbs: 90, fat: 25 }, { calories: 1_400, protein: 100, carbs: 80, fat: 20 }],
  ), { calories: 0, protein: 0, carbs: 30, fat: 25 })
  assert.equal(calculateRemainingMacros({}, []), null)
})

test('normalizes only finite client fallback limits', () => {
  assert.deepEqual(normalizeRemainingMacros({ calories: 500, protein: -10, carbs: '80', fat: Number.NaN }), { calories: 500, protein: 0, carbs: null, fat: null })
  assert.equal(normalizeRemainingMacros(null), null)
})

test('preserves detailed requests and serializes hard constraints in the prompt', () => {
  const details = 'Make it "crispy" with {heat}, C:\\recipes\nNo mustard — add jalapeño 🌶️'
  assert.equal(normalizeMealRequest(details), details)
  const prompt = buildMealRecommendationPrompt({ ingredients: ['chicken'], remaining: null, constraints: { oven: 'no-oven' }, mealRequest: details })
  assert.match(prompt, /jalapeño/)
  assert.match(prompt, /no-oven/)
  assert.doesNotThrow(() => JSON.parse(prompt.match(/context: (\{.*\})\n\n/s)[1]))
})

test('rejects overlong meal specifics with a controlled client error', () => {
  assert.throws(() => normalizeMealRequest('x'.repeat(MAX_MEAL_REQUEST_LENGTH + 1)), (error) => error instanceof MealRecommendationError && error.statusCode === 400)
})

test('detects max-token truncation before attempting to parse output', () => {
  assert.throws(() => parseMealRecommendationResult({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"meals":[{"name":"cut off' }] }), (error) => error instanceof MealRecommendationError && error.message === TRUNCATED_RECOMMENDATION_MESSAGE)
})

test('returns controlled errors for refusals, missing output, and malformed structured text', () => {
  assert.throws(() => parseMealRecommendationResult({ stop_reason: 'refusal', content: [] }), /could not be completed for that request/)
  for (const result of [
    { stop_reason: 'end_turn', content: [] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: '{bad json' }] },
    { stop_reason: 'stop_sequence', content: [{ type: 'text', text: '{}' }] },
  ]) {
    assert.throws(() => parseMealRecommendationResult(result), (error) => error instanceof MealRecommendationError && error.message === RETRY_RECOMMENDATION_MESSAGE)
  }
})

test('parses a complete schema-constrained text response', () => {
  const value = { meals: [validMeal()] }
  assert.deepEqual(parseMealRecommendationResult(messageResult(value)), value)
})
