import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import express from 'express'
import multer from 'multer'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(currentDirectory, '.env') })

const app = express()
const port = Number(process.env.PORT || 8787)
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } })

app.use(express.json({ limit: '1mb' }))

function configuredClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return null
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

function parseJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return JSON.parse(fenced ? fenced[1].trim() : text.trim())
}

function ingredientResponse(value) {
  if (!value || !Array.isArray(value.ingredients)) {
    throw new Error('The model returned an invalid ingredient list.')
  }
  return {
    ingredients: value.ingredients
      .filter((item) => typeof item?.name === 'string')
      .slice(0, 30)
      .map((item) => ({
        name: item.name.trim(),
        confidence: ['high', 'medium', 'low'].includes(item.confidence) ? item.confidence : 'medium',
        note: typeof item.note === 'string' ? item.note.trim() : undefined,
      }))
      .filter((item) => item.name),
  }
}

function recommendationResponse(value) {
  if (!value || !Array.isArray(value.meals)) {
    throw new Error('The model returned invalid meal recommendations.')
  }
  return {
    meals: value.meals
      .filter((meal) => typeof meal?.name === 'string')
      .slice(0, 3)
      .map((meal) => ({
        name: meal.name.trim(),
        timeMinutes: Number.isFinite(Number(meal.timeMinutes)) ? Number(meal.timeMinutes) : null,
        calories: Number.isFinite(Number(meal.calories)) ? Math.max(0, Math.round(Number(meal.calories))) : 0,
        protein: Number.isFinite(Number(meal.protein)) ? Math.max(0, Math.round(Number(meal.protein))) : 0,
        carbs: Number.isFinite(Number(meal.carbs)) ? Math.max(0, Math.round(Number(meal.carbs))) : 0,
        fat: Number.isFinite(Number(meal.fat)) ? Math.max(0, Math.round(Number(meal.fat))) : 0,
        macroFit: typeof meal.macroFit === 'string' ? meal.macroFit.trim() : 'Estimated fit',
        inventory: typeof meal.inventory === 'string' ? meal.inventory.trim() : 'Check ingredients',
        whyItFits: typeof meal.whyItFits === 'string' ? meal.whyItFits.trim() : '',
        missingIngredients: Array.isArray(meal.missingIngredients)
          ? meal.missingIngredients.filter((item) => typeof item === 'string').slice(0, 5)
          : [],
        steps: Array.isArray(meal.steps) ? meal.steps.filter((item) => typeof item === 'string').slice(0, 5) : [],
      }))
      .filter((meal) => meal.name),
  }
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY) })
})

app.post('/api/scan-fridge', upload.single('image'), async (request, response) => {
  const client = configuredClient()
  if (!client) {
    response.status(503).json({ error: 'AI scanning is not configured. Add your API key to server/.env and restart the app.' })
    return
  }
  if (!request.file || !imageTypes.has(request.file.mimetype)) {
    response.status(400).json({ error: 'Choose a JPG, PNG, WEBP, or GIF image.' })
    return
  }

  try {
    const result = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 900,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: request.file.mimetype, data: request.file.buffer.toString('base64') } },
          { type: 'text', text: 'Identify food ingredients visibly present in this fridge/pantry photo. Return JSON only: {"ingredients":[{"name":"short specific name","confidence":"high|medium|low","note":"optional brief uncertainty"}]}. Do not identify non-food objects. Do not guess brands, quantities, or items you cannot see.' },
        ],
      }],
    })
    const text = result.content.find((item) => item.type === 'text')?.text
    response.json(ingredientResponse(parseJson(text || '')))
  } catch (error) {
    console.error(error)
    response.status(502).json({ error: 'The photo scan did not complete. Please try a clearer photo.' })
  }
})

app.post('/api/recommend-meals', async (request, response) => {
  const client = configuredClient()
  if (!client) {
    response.status(503).json({ error: 'AI recommendations are not configured. Add your API key to server/.env and restart the app.' })
    return
  }
  const ingredients = Array.isArray(request.body?.ingredients)
    ? request.body.ingredients.filter((item) => typeof item === 'string' && item.trim()).slice(0, 30)
    : []
  if (!ingredients.length) {
    response.status(400).json({ error: 'Add or confirm at least one ingredient first.' })
    return
  }

  const context = {
    ingredients,
    remaining: request.body?.remaining ?? null,
    mealRequest: typeof request.body?.mealRequest === 'string' ? request.body.mealRequest.slice(0, 120) : 'a satisfying meal',
  }

  try {
    const result = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1700,
      messages: [{
        role: 'user',
        content: `You are a practical home cook and macro-aware meal planner. Build 1 to 3 genuinely appetizing, cohesive meal ideas from this context: ${JSON.stringify(context)}. Flavor and a plausible cooking technique are mandatory. Never force odd combinations just to satisfy macros. Prefer the listed ingredients and only name a few common missing ingredients when they materially improve the meal. Nutrition is always an estimate. If no good meal can be made, return one honest meal with an explanation and useful missing ingredients. Return JSON only: {"meals":[{"name":"...","timeMinutes":20,"calories":500,"protein":35,"carbs":55,"fat":15,"macroFit":"excellent fit|good fit|...","inventory":"ready now|missing: ...","whyItFits":"one concise sentence","missingIngredients":["..."],"steps":["short step", "short step"]}]}.`,
      }],
    })
    const text = result.content.find((item) => item.type === 'text')?.text
    response.json(recommendationResponse(parseJson(text || '')))
  } catch (error) {
    console.error(error)
    response.status(502).json({ error: 'Meal recommendations did not complete. Please try again.' })
  }
})

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    response.status(413).json({ error: 'Choose an image smaller than 8 MB.' })
    return
  }
  response.status(500).json({ error: 'Something went wrong on the server.' })
})

app.listen(port, () => console.log(`Fridge Recipes API listening on http://localhost:${port}`))
