const { MongoClient } = require('mongodb')

/**
 * Managed Mongo on Bloxity Legion (MONGODB_URI is injected per game + channel).
 * Without it (local dev) this stays null and the stores fall back to JSON files.
 */

let db = null

async function connect() {
  const uri = process.env.MONGODB_URI
  if (!uri) return null
  const client = new MongoClient(uri, { maxPoolSize: 10 })
  await client.connect()
  // The URI names the database; fall back to a fixed name if it doesn't.
  db = client.db()
  await db.collection('leaderboard').createIndex({ wins: -1 })
  await db.collection('leaderboard').createIndex({ speed: -1 })
  console.log('[db] connected to Mongo')
  return client
}

const getDb = () => db

module.exports = { connect, getDb }
