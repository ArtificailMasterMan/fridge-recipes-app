import { anthropic, adminDatabase, limitUser, requireUser, sendError } from './_shared.mjs'
import {
  buildMealRecommendationPrompt,
  mealRecommendationSchema,
  MealRecommendationError,
  normalizeMealConstraints,
  normalizeMealRequest,
  parseMealRecommendationResult,
  calculateRemainingMacros,
  recommendationResponse,
  validLocalDate,
} from './_meal-recommendations.mjs'

const MAX_INGREDIENTS = 30

function ingredientsFrom(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim().replace(/\s+/g, ' ').slice(0, 100))
    .slice(0, MAX_INGREDIENTS)
}

function recommendationError(response, error) {
  if (error instanceof MealRecommendationError) {
    return response.status(error.statusCode).json({ error: error.message })
  }
  const message = error instanceof Error ? error.message : ''
  if (message === 'Sign in to continue.' || message.includes('Too many') || message.includes('not configured')) {
    return sendError(response, error)
  }
  console.error('Meal recommendations failed:', error)
  return response.status(502).json({ error: 'Meal recommendations did not complete. Please try again.' })
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' })

  try {
    const user = await requireUser(request)
    limitUser(user.uid)

    const ingredients = ingredientsFrom(request.body?.ingredients)
    if (!ingredients.length) return response.status(400).json({ error: 'Add or confirm at least one ingredient first.' })

    const currentDate = validLocalDate(request.body?.currentDate)
    if (!currentDate) return response.status(400).json({ error: 'A valid local calendar date is required.' })

    const database = adminDatabase()
    const root = database.collection('users').doc(user.uid)
    const [profileSnapshot, entrySnapshot] = await Promise.all([
      root.collection('profile').doc('default').get(),
      root.collection('dailyLogs').doc(currentDate).collection('entries').get(),
    ])
    const remaining = calculateRemainingMacros(
      profileSnapshot.exists ? profileSnapshot.data() : null,
      entrySnapshot.docs.map((entry) => entry.data()),
    )
    const profile = profileSnapshot.exists ? profileSnapshot.data() : null
    const constraints = normalizeMealConstraints({
      ...request.body?.preferences,
      avoidedIngredients: profile?.avoidedIngredients,
      rejectedMeals: request.body?.rejectedMeals,
    })
    const context = {
      ingredients,
      remaining,
      constraints,
      mealRequest: normalizeMealRequest(request.body?.mealRequest),
    }

    const result = await anthropic().messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 3_600,
      output_config: {
        format: {
          type: 'json_schema',
          schema: mealRecommendationSchema,
        },
      },
      messages: [{ role: 'user', content: buildMealRecommendationPrompt(context) }],
    })

    response.json(recommendationResponse(parseMealRecommendationResult(result), remaining, constraints))
  } catch (error) {
    recommendationError(response, error)
  }
}
