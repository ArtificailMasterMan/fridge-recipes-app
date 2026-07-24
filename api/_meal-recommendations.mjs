export const MACRO_KEYS = ['calories', 'protein', 'carbs', 'fat']
export const MAX_MEAL_REQUEST_LENGTH = 2_000
export const TRUNCATED_RECOMMENDATION_MESSAGE = 'Meal ideas took too long to finish. Please try again with a shorter request.'
export const RETRY_RECOMMENDATION_MESSAGE = 'Meal recommendations did not complete correctly. Please try again.'

const MAX_MACRO = 20_000
const MAX_TIME_MINUTES = 600
const ALLOWED_EFFORTS = new Set(['any', 'minimal'])
const ALLOWED_OVEN_CHOICES = new Set(['any', 'no-oven'])
const ALLOWED_FLAVORS = new Set(['any', 'savory', 'spicy', 'fresh', 'comforting'])

export const mealRecommendationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['meals'],
  properties: {
    meals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'name', 'timeMinutes', 'calories', 'protein', 'carbs', 'fat', 'macroFit', 'whyItFits',
          'ingredients', 'requiredIngredients', 'optionalUpgrades', 'effort', 'usesOven', 'flavorProfile', 'steps',
        ],
        properties: {
          name: { type: 'string' },
          timeMinutes: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          calories: { type: 'number' },
          protein: { type: 'number' },
          carbs: { type: 'number' },
          fat: { type: 'number' },
          macroFit: { type: 'string' },
          whyItFits: { type: 'string' },
          ingredients: { type: 'array', items: { type: 'string' } },
          requiredIngredients: { type: 'array', items: { type: 'string' } },
          optionalUpgrades: { type: 'array', items: { type: 'string' } },
          effort: { type: 'string', enum: ['minimal', 'standard'] },
          usesOven: { type: 'boolean' },
          flavorProfile: { type: 'string', enum: ['savory', 'spicy', 'fresh', 'comforting'] },
          steps: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

export class MealRecommendationError extends Error {
  constructor(message, statusCode = 502) {
    super(message)
    this.name = 'MealRecommendationError'
    this.statusCode = statusCode
  }
}

function cleanText(value, maximum) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maximum) : ''
}

function strictMacro(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_MACRO) return null
  return value
}

function accountMacro(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(MAX_MACRO, value) : 0
}

function normalizeTextArray(value, maximumItems, maximumLength) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  return value.flatMap((item) => {
    const clean = cleanText(item, maximumLength)
    const key = clean.toLowerCase()
    if (!clean || seen.has(key)) return []
    seen.add(key)
    return [clean]
  }).slice(0, maximumItems)
}

function searchable(value) {
  return ` ${String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `
}

function includesFoodTerm(value, term) {
  const content = searchable(value)
  const cleanTerm = searchable(term).trim()
  if (!cleanTerm) return false
  return content.includes(` ${cleanTerm} `) || content.includes(` ${cleanTerm}s `) || content.includes(` ${cleanTerm}es `)
}

export function validLocalDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? value : null
}

export function normalizeMealRequest(value) {
  if (typeof value !== 'string' || !value.trim()) return 'A satisfying meal'
  const request = value.trim()
  if (request.length > MAX_MEAL_REQUEST_LENGTH) {
    throw new MealRecommendationError(`Keep meal specifics under ${MAX_MEAL_REQUEST_LENGTH.toLocaleString('en-US')} characters.`, 400)
  }
  return request
}

export function normalizeRemainingMacros(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const remaining = {}
  let hasLimit = false
  for (const key of MACRO_KEYS) {
    const item = value[key]
    if (typeof item === 'number' && Number.isFinite(item)) {
      remaining[key] = Math.max(0, Math.min(MAX_MACRO, item))
      hasLimit = true
    } else remaining[key] = null
  }
  return hasLimit ? remaining : null
}

export function normalizeMealConstraints(value = {}) {
  const maxTime = typeof value?.maxTime === 'number' && Number.isFinite(value.maxTime) && value.maxTime >= 5 && value.maxTime <= 240
    ? Math.round(value.maxTime)
    : null
  return {
    maxTime,
    effort: ALLOWED_EFFORTS.has(value?.effort) ? value.effort : 'any',
    oven: ALLOWED_OVEN_CHOICES.has(value?.oven) ? value.oven : 'any',
    flavor: ALLOWED_FLAVORS.has(value?.flavor) ? value.flavor : 'any',
    avoidedIngredients: normalizeTextArray(value?.avoidedIngredients, 30, 100),
    rejectedMeals: normalizeTextArray(value?.rejectedMeals, 20, 120),
  }
}

export function calculateRemainingMacros(profile, entries = []) {
  const consumed = Object.fromEntries(MACRO_KEYS.map((key) => [key, 0]))
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const key of MACRO_KEYS) consumed[key] += accountMacro(entry?.[key])
  }
  const remaining = {}
  let hasLimit = false
  for (const key of MACRO_KEYS) {
    const target = accountMacro(profile?.[key])
    if (target > 0) {
      remaining[key] = Math.max(0, target - consumed[key])
      hasLimit = true
    } else remaining[key] = null
  }
  return hasLimit ? remaining : null
}

export function normalizeMeal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const name = cleanText(value.name, 120)
  const macroFit = cleanText(value.macroFit, 100)
  const whyItFits = cleanText(value.whyItFits, 500)
  const ingredients = normalizeTextArray(value.ingredients, 20, 120)
  const steps = normalizeTextArray(value.steps, 8, 300)
  const nutrition = Object.fromEntries(MACRO_KEYS.map((key) => [key, strictMacro(value[key])]))
  const timeMinutes = value.timeMinutes === null
    ? null
    : typeof value.timeMinutes === 'number' && Number.isFinite(value.timeMinutes) && value.timeMinutes >= 0 && value.timeMinutes <= MAX_TIME_MINUTES
      ? Math.round(value.timeMinutes)
      : undefined
  const effort = value.effort === 'minimal' || value.effort === 'standard' ? value.effort : null
  const usesOven = typeof value.usesOven === 'boolean' ? value.usesOven : null
  const flavorProfile = ['savory', 'spicy', 'fresh', 'comforting'].includes(value.flavorProfile) ? value.flavorProfile : ''
  if (!name || !macroFit || !whyItFits || !ingredients.length || !steps.length || timeMinutes === undefined || !effort || usesOven === null || !flavorProfile) return null
  if (MACRO_KEYS.some((key) => nutrition[key] === null)) return null
  return {
    name,
    timeMinutes,
    ...nutrition,
    macroFit,
    whyItFits,
    ingredients,
    requiredIngredients: normalizeTextArray(value.requiredIngredients, 8, 100),
    optionalUpgrades: normalizeTextArray(value.optionalUpgrades, 8, 100),
    effort,
    usesOven,
    flavorProfile,
    steps,
  }
}

export function normalizeMealRecommendations(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.meals)) throw new MealRecommendationError(RETRY_RECOMMENDATION_MESSAGE)
  return value.meals.flatMap((meal) => {
    const normalized = normalizeMeal(meal)
    return normalized ? [normalized] : []
  })
}

export function mealFitsRemainingMacros(meal, remaining) {
  if (!remaining) return true
  return MACRO_KEYS.every((key) => remaining[key] === null || meal[key] <= remaining[key])
}

export function mealFitsConstraints(meal, constraintValue = {}) {
  const constraints = normalizeMealConstraints(constraintValue)
  if (constraints.maxTime !== null && (meal.timeMinutes === null || meal.timeMinutes > constraints.maxTime)) return false
  if (constraints.effort === 'minimal' && meal.effort !== 'minimal') return false
  if (constraints.oven === 'no-oven' && meal.usesOven) return false
  if (constraints.flavor !== 'any' && meal.flavorProfile !== constraints.flavor) return false
  if (constraints.rejectedMeals.some((name) => name.toLowerCase() === meal.name.toLowerCase())) return false
  const mealText = [meal.name, meal.whyItFits, ...meal.ingredients, ...meal.requiredIngredients, ...meal.optionalUpgrades, ...meal.steps].join(' ')
  return !constraints.avoidedIngredients.some((ingredient) => includesFoodTerm(mealText, ingredient))
}

export function noFitMessage(remaining) {
  return remaining
    ? "I couldn't find an appetizing meal that fits your remaining macros and choices without forcing a bad recommendation."
    : "I couldn't find an appetizing meal from this request and your choices without forcing a bad recommendation."
}

export function recommendationResponse(value, remaining, constraintValue = {}) {
  const meals = normalizeMealRecommendations(value)
    .filter((meal) => mealFitsRemainingMacros(meal, remaining) && mealFitsConstraints(meal, constraintValue))
    .slice(0, 3)
  return meals.length ? { meals } : { meals: [], message: noFitMessage(remaining) }
}

export function parseMealRecommendationResult(result) {
  if (!result || typeof result !== 'object') throw new MealRecommendationError(RETRY_RECOMMENDATION_MESSAGE)
  if (result.stop_reason === 'max_tokens') throw new MealRecommendationError(TRUNCATED_RECOMMENDATION_MESSAGE)
  if (result.stop_reason === 'refusal') throw new MealRecommendationError('Meal recommendations could not be completed for that request. Try changing the specifics.')
  if (result.stop_reason !== 'end_turn') throw new MealRecommendationError(RETRY_RECOMMENDATION_MESSAGE)
  const text = Array.isArray(result.content) ? result.content.find((item) => item?.type === 'text')?.text : null
  if (typeof text !== 'string' || !text.trim()) throw new MealRecommendationError(RETRY_RECOMMENDATION_MESSAGE)
  try {
    return JSON.parse(text)
  } catch {
    throw new MealRecommendationError(RETRY_RECOMMENDATION_MESSAGE)
  }
}

export function buildMealRecommendationPrompt(context) {
  return `You are a highly selective practical home cook and macro-aware meal planner. Return zero to three genuinely appetizing, cohesive meals for this context: ${JSON.stringify(context)}\n\nOnly return a meal you would honestly recommend eating. Flavor, compatible ingredients, realistic quantities, and a plausible cooking technique are mandatory. Never force odd combinations to hit nutrition numbers. Returning no meals is correct when no good option exists. Treat persistent avoided ingredients and rejected meals as hard exclusions. Obey maximum time, minimal-effort, no-oven, and flavor choices exactly when specified. Prefer the listed kitchen ingredients. The ingredients array must list every ingredient used in the complete meal. requiredIngredients must contain only items not in the kitchen that are necessary to make the meal honestly recommendable; optionalUpgrades must contain only genuinely optional improvements. Never disguise a required item as optional. Treat every non-null remaining macro as a hard maximum for the complete meal, including calories, protein, carbohydrates, and fat. Do not claim a meal fits when its estimated values exceed any maximum. Nutrition is an honest estimate for the complete meal as described. Keep each recipe to two through six concise, actionable steps.`
}
