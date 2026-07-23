import { IncomingForm } from 'formidable'
import { readFile } from 'node:fs/promises'
import { anthropic, limitUser, parseModelJson, requireUser, sendError, textResult } from './_shared.mjs'

export const config = { api: { bodyParser: false } }
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const confidenceLevels = new Set(['high', 'medium', 'low'])

const scanGuidance = {
  fridge: `Inspect the fridge photo carefully from top to bottom. Identify only food and drink that is visibly recognizable, including produce, leftovers, condiments, and packaged food. Use a generic food name when a brand is not important. Do not infer food inside opaque or unlabeled containers.`,
  pantry: `Inspect every visible pantry shelf carefully from top to bottom, including cans, jars, boxes, bags, bottles, and loose ingredients. Read labels only when they are actually visible. If branding or a partial label is unclear, return a useful generic food name and lower confidence rather than guessing a brand or specific variety. Never infer hidden products or the contents of opaque unlabeled containers.`,
}

function normalizedIngredients(value) {
  if (!Array.isArray(value)) throw new Error('The AI returned an invalid ingredient list.')

  const seen = new Set()
  return value.flatMap((item) => {
    const name = typeof item?.name === 'string' ? item.name.trim().replace(/\s+/g, ' ').slice(0, 100) : ''
    const key = name.toLowerCase()
    if (!name || seen.has(key)) return []
    seen.add(key)

    return [{
      name,
      confidence: confidenceLevels.has(item?.confidence) ? item.confidence : 'medium',
      note: typeof item?.note === 'string' ? item.note.trim().replace(/\s+/g, ' ').slice(0, 180) : '',
    }]
  }).slice(0, 40)
}

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
    const [fields, files] = await form.parse(request)
    const image = files.image?.[0]
    const requestedMode = fields.mode?.[0]
    const mode = requestedMode === 'pantry' ? 'pantry' : 'fridge'
    if (!image) return response.status(400).json({ error: 'No photo was received. Choose the image again and retry.' })
    if (!imageTypes.has(image.mimetype || '')) return response.status(415).json({ error: 'This photo format is not supported. Choose a JPG, PNG, WEBP, GIF, or an iPhone screenshot.' })
    const imageData = (await readFile(image.filepath)).toString('base64')
    const result = await anthropic().messages.create({
      model: 'claude-sonnet-5', max_tokens: 1200,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: image.mimetype, data: imageData } },
        { type: 'text', text: `${scanGuidance[mode]} Return JSON only: {"ingredients":[{"name":"short specific food name","confidence":"high|medium|low","note":"brief uncertainty, or empty string"}]}. Do not identify non-food objects, guess quantities, or include anything that cannot actually be seen. Confidence must reflect visual evidence. It is better to omit an item than invent one.` },
      ] }],
    })
    const output = parseModelJson(textResult(result))
    response.json({ ingredients: normalizedIngredients(output?.ingredients), mode })
  } catch (error) { uploadError(response, error) }
}
