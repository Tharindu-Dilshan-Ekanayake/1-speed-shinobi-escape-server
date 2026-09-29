/**
 * Verifies a Bloxity access token by asking Bloxity who it belongs to
 * (GET /v1/auth/me). The verified id and name are the only identity the server
 * trusts; anything the client puts in a request body is ignored for auth.
 */

const BLOXITY_API = process.env.BLOXITY_API_URL || 'https://api.bloxity.io'
const CACHE_MS = 5 * 60 * 1000

/** token -> { user, at } */
const cache = new Map()

async function verifyToken(token) {
  if (typeof token !== 'string' || token.length < 10 || token.length > 4096) return null
  const hit = cache.get(token)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.user

  try {
    const res = await fetch(`${BLOXITY_API}/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const body = await res.json()
    const u = body?.user || body
    const id = u?._id || u?.id
    if (typeof id !== 'string' || !id) return null
    const user = { id, name: String(u.displayName || u.username || 'Player').slice(0, 24) }
    cache.set(token, { user, at: Date.now() })
    if (cache.size > 5000) cache.delete(cache.keys().next().value)
    return user
  } catch (err) {
    console.warn('[auth] Bloxity verify failed', err.message)
    return null
  }
}

/** Express middleware: requires `Authorization: Bearer <bloxity token>`. */
async function requireUser(req, res, next) {
  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const user = await verifyToken(token)
  if (!user) return res.status(401).json({ error: 'not logged in' })
  req.user = user
  next()
}

module.exports = { verifyToken, requireUser }
