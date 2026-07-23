import { IncomingForm } from 'formidable'
import { readFile } from 'node:fs/promises'
import { anthropic, limitUser, parseModelJson, requireUser, sendError, textResult } from './_shared.mjs'

export const config = { api: { bodyParser: false } }
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' })
  try {
    const user = await requireUser(request)
    limitUser(user.uid)
    const form = new IncomingForm({ maxFileSize: 8 * 1024 * 1024, maxFiles: 1 })
    const [, files] = await form.parse(request)
    const image = files.image?.[0]
    if (!image || !imageTypes.has(image.mimetype || '')) return response.status(400).json({ error: 'Choose a JPG, PNG, WEBP, or GIF image.' })
    const imageData = (await readFile(image.filepath)).toString('base64')
    const result = await anthropic().messages.create({
      model: 'claude-sonnet-5', max_tokens: 900,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: image.mimetype, data: imageData } },
        { type: 'text', text: 'Identify food ingredients visibly present in this fridge/pantry photo. Return JSON only: {"ingredients":[{"name":"short specific name","confidence":"high|medium|low","note":"optional brief uncertainty"}]}. Do not identify non-food objects. Do not guess brands, quantities, or items you cannot see.' },
      ] }],
    })
    const output = parseModelJson(textResult(result))
    if (!Array.isArray(output?.ingredients)) throw new Error('The AI returned an invalid ingredient list.')
    response.json({ ingredients: output.ingredients.filter((item) => typeof item?.name === 'string').slice(0, 30) })
  } catch (error) { sendError(response, error) }
}
