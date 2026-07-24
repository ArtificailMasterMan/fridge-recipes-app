export const MACRO_KEYS = ['calories', 'protein', 'carbs', 'fat']
export const MAX_MEAL_REQUEST_LENGTH = 2_000
export const TRUNCATED_RECOMMENDATION_MESSAGE = 'Meal ideas took too long to finish. Please try again with a shorter request.'
export const RETRY_RECOMMENDATION_MESSAGE = 'Meal recommendations did not complete correctly. Please try again.'

const MAX_MACRO = 20_000
const MAX_TIME_MINUTES = 600

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
          'name',
          'timeMinutes',
          'calories',
          'protein',
          'carbs',
          'fat',
          'macroFit',
          'inventory',
          'whyItFits',
          'missingIngredients',
          'steps',
        ],
        properties: {
          name: { type: 'string' },
          timeMinutes: {
            anyOf: [
              { type: 'number' },
              { type: 'null' },
            ],
          },
          calories: { type: 'number' },
          protein: { type: 'number' },
          carbs: { type: 'number' },
          fat: { type: 'number' },
          macroFit: { type: 'string' },
          inventory: { type: 'string' },
          whyItFits: { type: 'string' },
          missingIngredients: {
            type: 'array',
            items: { type: 'string' },
          },
          steps: {
            type: 'array',
            items: { type: 'string' },
          },
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
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').slice(0, maximum)
    : ''
}

function strictMacro(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_MACRO) return null
  return value
}

function accountMacro(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(MAX_MACRO, value)
    : 0
}

function normalizeTextArray(value, maximumItems, maximumLength) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => cleanText(item, maximumLength))
    .filter(Boolean)
    .slice(0, maximumItems)
}

export function validLocalDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    ? value
    : null
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
    } else {
      remaining[key] = null
    }
  }
  return hasLimit ? remaining : null
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
    } else {
      remaining[key] = null
    }
  }
  return hasLimit ? remaining : null
}

export function normalizeMeal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const name = cleanText(value.name, 120)
  const macroFit = cleanText(value.macroFit, 100)
  const inventory = cleanText(value.inventory, 200)
  const whyItFits = cleanText(value.whyItFits, 500)
  const steps = normalizeTextArray(value.steps, 8, 300)
  const nutrition = Object.fromEntries(MACRO_KEYS.map((key) => [key, strictMacro(value[key])]))
  const timeMinutes = value.timeMinutes === null
    ? null
    : typeof value.timeMinutes === 'number' && Number.isFinite(value.timeMinutes) && value.timeMinutes >= 0 && value.timeMinutes <= MAX_TIME_MINUTES
      ? Math.round(value.timeMinutes)
      : undefined

  if (!name || !macroFit || !inventory || !whyItFits || !steps.length || timeMinutes === undefined) return null
  if (MACRO_KEYS.some((key) => nutrition[key] === null)) return null

  return {
    name,
    timeMinutes,
    ...nutrition,
    macroFit,
    inventory,
    whyItFits,
    missingIngredients: normalizeTextArray(value.missingIngredients, 8, 100),
    steps,
  }
}

export function normalizeMealRecommendations(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.meals)) {
    throw new MealRecommendationError(RETRY_RECOMMENDATION_MESSAGE)
  }
  return value.meals.flatMap((meal) => {
    const normalized = normalizeMeal(meal)
    return normalized ? [normalized] : []
  })
}

export function mealFitsRemainingMacros(meal, remaining) {
  if (!remaining) return true
  return MACRO_KEYS.every((key) => remaining[key] === null || meal[key] <= remaining[key])
}

export function noFitMessage(remaining) {
  return remaining
    ? "I couldn't find an appetizing meal that fits your remaining macros without forcing a bad recommendation."
    : "I couldn't find an appetizing meal from this request without forcing a bad recommendation."
}

export function recommendationResponse(value, remaining) {
  const meals = normalizeMealRecommendations(value)
    .filter((meal) => mealFitsRemainingMacros(meal, remaining))
    .slice(0, 3)
  return meals.length ? { meals } : { meals: [], message: noFitMessage(remaining) }
}

export function parseMealRecommendationResult(result) {
  if (!result || typeof result !== 'object') throw new MealRecommendationError(RETRY_RECOMMENDATION_MESSAGE)
  if (result.stop_reason === 'max_tokens') {
    throw new MealRecommendationError(TRUNCATED_RECOMMENDATION_MESSAGE)
  }
  if (result.stop_reason === 'refusal') {
    throw new MealRecommendationError('Meal recommendations could not be completed for that request. Try changing the specifics.')
  }
  if (result.stop_reason !== 'end_turn') throw new MealRecommendationError(RETRY_RECOMMENDATION_MESSAGE)

  const text = Array.isArray(result.content)
    ? result.content.find((item) => item?.type === 'text')?.text
    : null
  if (typeof text !== 'string' || !text.trim()) throw new MealRecommendationError(RETRY_RECOMMENDATION_MESSAGE)

  try {
    return JSON.parse(text)
  } catch {
    throw new MealRecommendationError(RETRY_RECOMMENDATION_MESSAGE)
  }
}

export function buildMealRecommendationPrompt(context) {
  return `You are a highly selective practical home cook and macro-aware meal planner. Return zero to three genuinely appetizing, cohesive meals for this context: ${JSON.stringify(context)}\n\nOnly return a meal you would honestly recommend eating. Flavor, compatible ingredients, realistic quantities, and a plausible cooking technique are mandatory. Never force odd combinations to hit nutrition numbers. Returning no meals is correct when no good option exists. Prefer the listed ingredients. List only a few common missing ingredients when they materially improve a meal. Treat every non-null remaining macro as a hard maximum for the complete meal, including calories, protein, carbohydrates, and fat. Do not claim a meal fits when its estimated values exceed any maximum. Nutrition is an honest estimate for the complete meal as described. Keep each recipe to two through six concise, actionable steps.`
}
