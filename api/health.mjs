export default function handler(_request, response) {
  response.status(200).json({ ok: true, aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY) })
}
