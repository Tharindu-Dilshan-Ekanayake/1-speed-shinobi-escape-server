const http = require('http')

const { Server } = require('@colyseus/core')
const { WebSocketTransport } = require('@colyseus/ws-transport')
const cors = require('cors')
const express = require('express')

const { requireUser } = require('./auth')
const db = require('./db')
const leaderboard = require('./leaderboard')
const { LobbyRoom } = require('./LobbyRoom')
const saves = require('./saves')

const app = express()
// Bloxity Legion injects PORT (2567); locally it defaults to 3000.
const PORT = Number(process.env.PORT) || 3000

// The Vite dev server, plus the hosted game site (CLIENT_ORIGIN, injected by Legion).
const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']
if (process.env.CLIENT_ORIGIN) ALLOWED_ORIGINS.push(...process.env.CLIENT_ORIGIN.split(',').map((o) => o.trim()))

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }))
app.use(express.json({ limit: '64kb' }))

/** Readiness / liveness probe for the Legion hosting (must answer fast). */
app.get('/health', (_req, res) => res.status(200).send('ok'))
app.get('/api/health', (_req, res) => res.json({ ok: true }))

/** Wraps an async handler so a failed database call answers 500 instead of hanging. */
const safe = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error('[api]', err)
    if (!res.headersSent) res.status(500).json({ error: 'server error' })
  })

/** Lobby leaderboards: MOST WINS and MOST SPEED, top 15 each, shared by every lobby. */
app.get(
  '/api/leaderboard',
  safe(async (_req, res) => {
    res.json(await leaderboard.top(15))
  }),
)

/**
 * Score submission from the client.
 *
 * NOTE: unauthenticated - anyone can post any score. Take the id and name from the
 * verified token (see /api/save) once guests no longer need to appear on the board.
 */
app.post(
  '/api/leaderboard',
  safe(async (req, res) => {
    const ok = await leaderboard.submit(req.body || {})
    res.status(ok ? 204 : 400).end()
  }),
)

/**
 * Account progress (speed, level, rebirths, wins, characters...). The user comes
 * from the verified Bloxity token, never from the request body, so a player can
 * only read and write their own save.
 */
app.get(
  '/api/save',
  requireUser,
  safe(async (req, res) => {
    res.json((await saves.get(req.user.id)) || { data: null, updatedAt: 0 })
  }),
)

app.post(
  '/api/save',
  requireUser,
  safe(async (req, res) => {
    const ok = await saves.put(req.user.id, req.body?.data)
    res.status(ok ? 204 : 400).end()
  }),
)

/**
 * Webhook for future Bux purchases.
 * Responds 200 immediately — the platform will retry on anything else, so do the
 * real work asynchronously rather than holding the response open.
 */
app.post('/api/legion-webhook', (req, res) => {
  console.log('[legion-webhook] payload:', JSON.stringify(req.body, null, 2))
  // TODO: verify x-legion-webhook-secret header, dedupe by transactionId, grant the item.
  res.sendStatus(200)
})

// Express and Colyseus share one HTTP server: REST on /api, rooms over WebSocket.
const httpServer = http.createServer(app)
const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) })
gameServer.define('lobby', LobbyRoom)

async function start() {
  try {
    await db.connect()
  } catch (err) {
    // Keep serving (file storage) rather than crash-looping the pod.
    console.error('[db] Mongo connection failed, using local files', err.message)
  }
  await gameServer.listen(PORT)
  console.log(`Server listening on port ${PORT} (REST /api, lobbies over WebSocket)`)
}
start()

// On a deploy or scale-down Legion sends SIGTERM and waits: let lobbies close
// cleanly (players reconnect to the fresh pod) instead of dropping everyone at once.
let stopping = false
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    if (stopping) return
    stopping = true
    console.log(`[server] ${signal}: draining`)
    try {
      await gameServer.gracefullyShutdown(false)
    } catch (err) {
      console.error('[server] shutdown error', err)
    }
    process.exit(0)
  })
}
