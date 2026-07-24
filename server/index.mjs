import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import express from 'express'
import multer from 'multer'
import {
  buildMealRecommendationPrompt,
  mealRecommendationSchema,
  MealRecommendationError,
  normalizeMealConstraints,
  normalizeMealRequest,
  normalizeRemainingMacros,
  parseMealRecommendationResult,
  recommendationResponse,
} from '../api/_meal-recommendations.mjs'

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

  let context
  try {
    const constraints = normalizeMealConstraints({
      ...request.body?.preferences,
      avoidedIngredients: request.body?.avoidedIngredients,
      rejectedMeals: request.body?.rejectedMeals,
    })
    context = {
      ingredients,
      remaining: normalizeRemainingMacros(request.body?.remaining),
      constraints,
      mealRequest: normalizeMealRequest(request.body?.mealRequest),
    }
  } catch (error) {
    if (error instanceof MealRecommendationError) {
      response.status(error.statusCode).json({ error: error.message })
      return
    }
    throw error
  }

  try {
    const result = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 3_600,
      output_config: {
        format: {
          type: 'json_schema',
          schema: mealRecommendationSchema,
        },
      },
      messages: [{
        role: 'user',
        content: buildMealRecommendationPrompt(context),
      }],
    })
    response.json(recommendationResponse(parseMealRecommendationResult(result), context.remaining, context.constraints))
  } catch (error) {
    console.error('Meal recommendations failed:', error)
    const message = error instanceof MealRecommendationError
      ? error.message
      : 'Meal recommendations did not complete. Please try again.'
    response.status(error instanceof MealRecommendationError ? error.statusCode : 502).json({ error: message })
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
