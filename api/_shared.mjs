import Anthropic from '@anthropic-ai/sdk'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const requests = new Map()

function adminApp() {
  if (getApps().length) return getApps()[0]
  const raw = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT
  if (!raw) throw new Error('Firebase Admin is not configured.')
  return initializeApp({ credential: cert(JSON.parse(raw)) })
}

export function adminDatabase() {
  return getFirestore(adminApp(), 'default')
}

export async function requireUser(request) {
  const header = request.headers.authorization || ''
  if (!header.startsWith('Bearer ')) throw new Error('Sign in to continue.')
  const token = header.slice(7)
  return getAuth(adminApp()).verifyIdToken(token)
}

export function limitUser(userId) {
  const now = Date.now()
  const windowStart = now - 60_000
  const recent = (requests.get(userId) || []).filter((time) => time > windowStart)
  if (recent.length >= 12) throw new Error('Too many AI requests. Please wait a minute and try again.')
  recent.push(now)
  requests.set(userId, recent)
}

export function anthropic() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('AI features are not configured.')
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

export function sendError(response, error) {
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  const status = message === 'Sign in to continue.' ? 401 : message.includes('Too many') ? 429 : message.includes('not configured') ? 503 : 502
  response.status(status).json({ error: message })
}

export function parseModelJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return JSON.parse(fenced ? fenced[1].trim() : text.trim())
}

export function textResult(result) {
  const text = result.content.find((item) => item.type === 'text')?.text
  if (!text) throw new Error('The AI response was empty.')
  return text
}
