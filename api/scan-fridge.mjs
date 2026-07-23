import { IncomingForm } from 'formidable'
import { readFile } from 'node:fs/promises'
import { anthropic, limitUser, parseModelJson, requireUser, sendError, textResult } from './_shared.mjs'

export const config = { api: { bodyParser: false } }
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

function uploadError(response, error) {
  console.error('Fridge scan failed:', error)
  const message = error instanceof Error ? error.message : ''
  if (message.toLowerCase().includes('maxfilesize')) return response.status(413).json({ error: 'That image is larger than 8 MB. Choose a smaller photo.' })
  if (message.includes('invalid ingredient list') || error instanceof SyntaxError) return response.status(502).json({ error: 'The photo was received, but the ingredient result could not be read. Try a clearer photo.' })
  sendError(response, error)
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' })
  try {
    const user = await requireUser(request)
    limitUser(user.uid)
    const form = new IncomingForm({ maxFileSize: 8 * 1024 * 1024, maxFiles: 1 })
    const [, files] = await form.parse(request)
    const image = files.image?.[0]
    if (!image) return response.status(400).json({ error: 'No photo was received. Choose the image again and retry.' })
    if (!imageTypes.has(image.mimetype || '')) return response.status(415).json({ error: 'This photo format is not supported. Choose a JPG, PNG, WEBP, GIF, or an iPhone screenshot.' })
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
  } catch (error) { uploadError(response, error) }
}
