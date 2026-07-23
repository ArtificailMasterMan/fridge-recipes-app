import { FieldValue } from 'firebase-admin/firestore'
import { adminDatabase, requireUser, sendError } from './_shared.mjs'

const MAX_MACRO = 20_000
const MAX_TEXT = 500
const macro = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(MAX_MACRO, Math.round(Number(value)))) : 0
const text = (value, maximum = MAX_TEXT) => typeof value === 'string' ? value.trim().slice(0, maximum) : ''
const date = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : new Date().toISOString().slice(0, 10)
const meal = (value) => ({
  name: text(value?.name, 120), timeMinutes: Number.isFinite(Number(value?.timeMinutes)) ? Math.max(0, Math.min(600, Math.round(Number(value.timeMinutes)))) : null,
  calories: macro(value?.calories), protein: macro(value?.protein), carbs: macro(value?.carbs), fat: macro(value?.fat),
  macroFit: text(value?.macroFit, 100), inventory: text(value?.inventory, 200), whyItFits: text(value?.whyItFits, 500),
  missingIngredients: Array.isArray(value?.missingIngredients) ? value.missingIngredients.map((item) => text(item, 100)).filter(Boolean).slice(0, 8) : [],
  steps: Array.isArray(value?.steps) ? value.steps.map((item) => text(item, 300)).filter(Boolean).slice(0, 8) : [],
})

function entriesFrom(snapshot) {
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
}

export default async function handler(request, response) {
  if (!['GET', 'POST'].includes(request.method)) return response.status(405).json({ error: 'Method not allowed.' })
  try {
    const user = await requireUser(request)
    const database = adminDatabase()
    const root = database.collection('users').doc(user.uid)
    const currentDate = date(request.method === 'GET' ? request.query.date : request.body?.date)

    if (request.method === 'GET') {
      const [profile, ingredients, entries, savedRecipes] = await Promise.all([
        root.collection('profile').doc('default').get(),
        root.collection('ingredients').doc('current').get(),
        root.collection('dailyLogs').doc(currentDate).collection('entries').orderBy('createdAt', 'asc').get(),
        root.collection('savedRecipes').orderBy('savedAt', 'desc').get(),
      ])
      return response.json({
        profile: profile.exists ? profile.data() : null,
        ingredients: Array.isArray(ingredients.data()?.items) ? ingredients.data().items : [],
        entries: entriesFrom(entries),
        savedRecipes: entriesFrom(savedRecipes),
      })
    }

    const action = request.body?.action
    if (action === 'save-profile') {
      const profile = { name: text(request.body?.profile?.name, 100), calories: macro(request.body?.profile?.calories), protein: macro(request.body?.profile?.protein), carbs: macro(request.body?.profile?.carbs), fat: macro(request.body?.profile?.fat), updatedAt: FieldValue.serverTimestamp() }
      await root.collection('profile').doc('default').set(profile, { merge: true })
      return response.json({ profile })
    }
    if (action === 'save-ingredients') {
      const items = Array.isArray(request.body?.items) ? [...new Set(request.body.items.map((item) => text(item, 100)).filter(Boolean))].slice(0, 100) : []
      await root.collection('ingredients').doc('current').set({ items, updatedAt: FieldValue.serverTimestamp() })
      return response.json({ items })
    }
    if (action === 'add-food') {
      const food = request.body?.food
      const name = text(food?.name, 160)
      if (!name) return response.status(400).json({ error: 'Enter a food or meal name.' })
      const entry = { name, category: text(food?.category, 40) || 'Snack', serving: text(food?.serving, 100), calories: macro(food?.calories), protein: macro(food?.protein), carbs: macro(food?.carbs), fat: macro(food?.fat), nutritionSource: 'user-provided', createdAt: FieldValue.serverTimestamp() }
      const created = await root.collection('dailyLogs').doc(currentDate).collection('entries').add(entry)
      return response.json({ entry: { id: created.id, ...entry } })
    }
    if (action === 'remove-last-food') {
      const latest = await root.collection('dailyLogs').doc(currentDate).collection('entries').orderBy('createdAt', 'desc').limit(1).get()
      if (!latest.empty) await latest.docs[0].ref.delete()
      return response.json({ ok: true })
    }
    if (action === 'save-recipe') {
      const recipe = meal(request.body?.recipe)
      if (!recipe.name) return response.status(400).json({ error: 'Recipe name is required.' })
      const created = await root.collection('savedRecipes').add({ ...recipe, savedAt: FieldValue.serverTimestamp() })
      return response.json({ recipe: { id: created.id, ...recipe } })
    }
    if (action === 'remove-recipe') {
      const recipeId = text(request.body?.recipeId, 200)
      if (!recipeId) return response.status(400).json({ error: 'Recipe is required.' })
      await root.collection('savedRecipes').doc(recipeId).delete()
      return response.json({ ok: true })
    }
    return response.status(400).json({ error: 'Unknown account action.' })
  } catch (error) {
    sendError(response, error)
  }
}
