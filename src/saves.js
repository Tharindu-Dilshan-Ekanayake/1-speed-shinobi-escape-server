const fs = require('fs')
const path = require('path')

const { getDb } = require('./db')

/**
 * Per-account progress, keyed by the verified Bloxity user id. Stored in Mongo when
 * the server has one (hosted), otherwise in a JSON file (local dev).
 */

const DATA_DIR = path.join(__dirname, '..', 'data')
const FILE = path.join(DATA_DIR, 'saves.json')
const MAX_BYTES = 32 * 1024

/** userId -> { data, updatedAt } (file mode only) */
let saves = {}
try {
  saves = JSON.parse(fs.readFileSync(FILE, 'utf8'))
} catch {
  saves = {}
}

let saveTimer = null
function scheduleWrite() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFile(FILE, JSON.stringify(saves), (err) => {
      if (err) console.error('[saves] write failed', err)
    })
  }, 1500)
}

const isCount = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < 1e15

/** Keeps only well-formed progress; returns null if the core numbers are bad. */
function clean(data) {
  if (!data || typeof data !== 'object') return null
  for (const key of ['speed', 'wins', 'totalWins', 'rebirths', 'level', 'xp']) {
    if (data[key] !== undefined && !isCount(data[key])) return null
  }
  const json = JSON.stringify(data)
  if (json.length > MAX_BYTES) return null
  return JSON.parse(json)
}

async function get(userId) {
  const db = getDb()
  if (db) {
    const doc = await db.collection('saves').findOne({ _id: userId })
    return doc ? { data: doc.data, updatedAt: doc.updatedAt } : null
  }
  return saves[userId] || null
}

async function put(userId, data) {
  const cleaned = clean(data)
  if (!cleaned) return false
  const updatedAt = Date.now()
  const db = getDb()
  if (db) {
    await db.collection('saves').updateOne({ _id: userId }, { $set: { data: cleaned, updatedAt } }, { upsert: true })
    return true
  }
  saves[userId] = { data: cleaned, updatedAt }
  scheduleWrite()
  return true
}

module.exports = { get, put }
