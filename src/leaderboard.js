const fs = require('fs')
const path = require('path')

const { getDb } = require('./db')

/**
 * One global leaderboard shared by every lobby: best wins and speed per player.
 * Stored in Mongo when the server has one (hosted), otherwise in a JSON file.
 */

const DATA_DIR = path.join(__dirname, '..', 'data')
const FILE = path.join(DATA_DIR, 'leaderboard.json')
const MAX_PLAYERS = 5000

/** id -> { name, wins, speed, updatedAt } (file mode only) */
let players = {}
try {
  players = JSON.parse(fs.readFileSync(FILE, 'utf8'))
} catch {
  players = {}
}

let saveTimer = null
function scheduleSave() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFile(FILE, JSON.stringify(players), (err) => {
      if (err) console.error('[leaderboard] save failed', err)
    })
  }, 2000)
}

const isCount = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0

async function submit({ id, name, wins, speed }) {
  if (typeof id !== 'string' || !id || id.length > 64) return false
  if (!isCount(wins) || !isCount(speed)) return false
  const cleanName = String(name || 'Player').replace(/[^\w .-]/g, '').slice(0, 20) || 'Player'
  const entry = { name: cleanName, wins, speed, updatedAt: Date.now() }

  const db = getDb()
  if (db) {
    await db.collection('leaderboard').updateOne({ _id: id }, { $set: entry }, { upsert: true })
    return true
  }
  if (!players[id] && Object.keys(players).length >= MAX_PLAYERS) return false
  players[id] = entry
  scheduleSave()
  return true
}

async function top(limit) {
  const db = getDb()
  if (db) {
    const col = db.collection('leaderboard')
    const rank = async (key) =>
      (await col.find({ [key]: { $gt: 0 } }).sort({ [key]: -1 }).limit(limit).toArray()).map((p) => ({
        id: p._id,
        name: p.name,
        value: p[key],
      }))
    return { wins: await rank('wins'), speed: await rank('speed') }
  }
  const list = Object.entries(players).map(([id, p]) => ({ id, ...p }))
  const rank = (key) =>
    list
      .filter((p) => p[key] > 0)
      .sort((a, b) => b[key] - a[key])
      .slice(0, limit)
      .map((p) => ({ id: p.id, name: p.name, value: p[key] }))
  return { wins: rank('wins'), speed: rank('speed') }
}

module.exports = { submit, top }
