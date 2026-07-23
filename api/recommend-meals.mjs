import { anthropic, limitUser, parseModelJson, requireUser, sendError, textResult } from './_shared.mjs'

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' })
  try {
    const user = await requireUser(request)
    limitUser(user.uid)
    const ingredients = Array.isArray(request.body?.ingredients)
      ? request.body.ingredients.filter((item) => typeof item === 'string' && item.trim()).slice(0, 30)
      : []
    if (!ingredients.length) return response.status(400).json({ error: 'Add or confirm at least one ingredient first.' })
    const context = { ingredients, remaining: request.body?.remaining ?? null, mealRequest: typeof request.body?.mealRequest === 'string' ? request.body.mealRequest.slice(0, 120) : 'a satisfying meal' }
    const result = await anthropic().messages.create({
      model: 'claude-sonnet-5', max_tokens: 1700,
      messages: [{ role: 'user', content: `You are a practical home cook and macro-aware meal planner. Build 1 to 3 genuinely appetizing, cohesive meal ideas from this context: ${JSON.stringify(context)}. Flavor and a plausible cooking technique are mandatory. Never force odd combinations just to satisfy macros. Prefer listed ingredients and only name a few common missing ingredients when they materially improve the meal. Nutrition is always an estimate. Return JSON only: {"meals":[{"name":"...","timeMinutes":20,"calories":500,"protein":35,"carbs":55,"fat":15,"macroFit":"excellent fit|good fit|...","inventory":"ready now|missing: ...","whyItFits":"one concise sentence","missingIngredients":["..."],"steps":["short step","short step"]}]}.` }],
    })
    const output = parseModelJson(textResult(result))
    if (!Array.isArray(output?.meals)) throw new Error('The AI returned invalid meal recommendations.')
    response.json({ meals: output.meals.filter((meal) => typeof meal?.name === 'string').slice(0, 3) })
  } catch (error) { sendError(response, error) }
}
