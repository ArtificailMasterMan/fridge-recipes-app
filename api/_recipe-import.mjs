import { lookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'

const MAX_HTML_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3
const REQUEST_TIMEOUT_MS = 8_000
const recipeType = (value) => value === 'Recipe' || (Array.isArray(value) && value.includes('Recipe'))

function ipv4Parts(address) {
  const parts = address.split('.').map(Number)
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null
}

export function isPublicAddress(address) {
  const normalized = address.toLowerCase().split('%')[0]
  const version = isIP(normalized)
  if (version === 4) {
    const parts = ipv4Parts(normalized)
    if (!parts) return false
    const [a, b, c] = parts
    return !(
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    )
  }
  if (version === 6) {
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPublicAddress(mapped[1])
    return normalized.startsWith('2') || normalized.startsWith('3')
  }
  return false
}

export function validateRecipeUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Enter a complete recipe website URL.')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Recipe links must use http or https.')
  if (url.username || url.password) throw new Error('Recipe links cannot contain sign-in credentials.')
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('That recipe website address is not allowed.')
  }
  if (!isIP(hostname) && !hostname.includes('.')) throw new Error('That recipe website address is not allowed.')
  if (isIP(hostname) && !isPublicAddress(hostname)) throw new Error('That recipe website address is not allowed.')
  return url
}

async function publicEndpoint(url) {
  if (isIP(url.hostname)) return { address: url.hostname.replace(/^\[|\]$/g, ''), family: isIP(url.hostname) }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('That recipe website address is not allowed.')
  }
  return addresses[0]
}

function requestHtml(url, endpoint) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve(value)
    }
    const transport = url.protocol === 'https:' ? https : http
    const pinnedAddress = endpoint.address
    const pinnedFamily = endpoint.family
    const request = transport.request(url, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Encoding': 'identity',
        'User-Agent': 'FridgeRecipes/1.0 recipe-importer',
      },
      lookup: (_hostname, options, callback) => {
        const done = typeof options === 'function' ? options : callback
        if (typeof options === 'object' && options?.all) return done(null, [{ address: pinnedAddress, family: pinnedFamily }])
        done(null, pinnedAddress, pinnedFamily)
      },
    }, (response) => {
      const chunks = []
      let size = 0
      response.on('data', (chunk) => {
        if (settled) return
        size += chunk.length
        if (size > MAX_HTML_BYTES) {
          finish(new Error('That recipe page is too large to import.'))
          request.destroy()
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => finish(null, {
        status: response.statusCode || 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error('The recipe website took too long to respond.')))
    request.on('error', (error) => finish(error))
    request.end()
  })
}

export async function fetchRecipePage(value) {
  let url = validateRecipeUrl(value)
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const endpoint = await publicEndpoint(url)
    const result = await requestHtml(url, endpoint)
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      if (redirect === MAX_REDIRECTS || !result.headers.location) throw new Error('The recipe website redirected too many times.')
      url = validateRecipeUrl(new URL(result.headers.location, url).href)
      continue
    }
    if (result.status < 200 || result.status >= 300) throw new Error(`The recipe website returned an error (${result.status}).`)
    const contentType = String(result.headers['content-type'] || '').toLowerCase()
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw new Error('That link does not point to a recipe webpage.')
    }
    return result.body
  }
  throw new Error('The recipe website redirected too many times.')
}

function decodeEntities(value) {
  const named = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' }
  return value.replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (match, entity) => {
    const lower = entity.toLowerCase()
    if (lower.startsWith('#x')) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16))
    if (lower.startsWith('#')) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10))
    return named[lower] || match
  })
}

function cleanText(value, maximum) {
  if (typeof value !== 'string') return ''
  return decodeEntities(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).trim().slice(0, maximum)
}

function instructionText(value) {
  if (typeof value === 'string') return [cleanText(value, 800)].filter(Boolean)
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(instructionText)
  if (value.itemListElement) return instructionText(value.itemListElement)
  const text = cleanText(value.text || value.name, 800)
  return text ? [text] : []
}

function recipeNodes(value) {
  if (Array.isArray(value)) return value.flatMap(recipeNodes)
  if (!value || typeof value !== 'object') return []
  return [value, ...recipeNodes(value['@graph'])]
}

export function parseRecipeDocument(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi)]
  for (const script of scripts) {
    let data
    try {
      data = JSON.parse(script[1].replace(/^\s*<!--|-->\s*$/g, '').trim())
    } catch {
      continue
    }
    for (const node of recipeNodes(data)) {
      if (!recipeType(node['@type'])) continue
      const name = cleanText(node.name || node.headline, 160)
      const ingredients = (Array.isArray(node.recipeIngredient) ? node.recipeIngredient : [])
        .map((item) => cleanText(item, 240)).filter(Boolean).slice(0, 100)
      const steps = instructionText(node.recipeInstructions).filter(Boolean).slice(0, 80)
      if (name && ingredients.length && steps.length) return { name, ingredients, steps, source: 'imported' }
    }
  }
  throw new Error('No complete structured recipe was found on that page.')
}
