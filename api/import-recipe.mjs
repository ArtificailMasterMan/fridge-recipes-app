import { FieldValue } from 'firebase-admin/firestore'
import { adminDatabase, limitUser, requireUser, sendError } from './_shared.mjs'
import { fetchRecipePage, parseRecipeDocument } from './_recipe-import.mjs'

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' })

  try {
    const user = await requireUser(request)
    limitUser(user.uid)
    const requestedUrl = typeof request.body?.url === 'string' ? request.body.url.trim().slice(0, 2_000) : ''
    if (!requestedUrl) return response.status(400).json({ error: 'Enter a recipe website URL.' })

    const html = await fetchRecipePage(requestedUrl)
    const recipe = parseRecipeDocument(html)
    const created = await adminDatabase().collection('users').doc(user.uid).collection('savedRecipes').add({
      ...recipe,
      savedAt: FieldValue.serverTimestamp(),
    })

    response.json({ recipe: { id: created.id, ...recipe } })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (
      message.includes('URL') || message.includes('http or https') || message.includes('sign-in credentials') ||
      message.includes('address is not allowed') || message.includes('No complete structured recipe')
    ) {
      return response.status(400).json({ error: message })
    }
    sendError(response, error)
  }
}
