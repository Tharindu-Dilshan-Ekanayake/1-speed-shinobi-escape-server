const { Room } = require('@colyseus/core')

/**
 * One lobby of up to 8 players. `joinOrCreate('lobby')` fills an open lobby first
 * and opens a new one when every lobby is full, so the 9th player lands in a fresh
 * room. Each player runs their own course; the room only shares where everyone is.
 *
 * No synced schema state: the server keeps a plain map and broadcasts a compact
 * position snapshot 20 times a second.
 */

// 20 snapshots a second. Each is stamped with the server time, and each row with how
// long ago that player's update arrived, so clients can interpolate smoothly.
const SNAPSHOT_MS = 50
const AVATAR_KEYS = [
  'hatId', 'backId', 'skinId', 'headId', 'armLId', 'armRId', 'legLId', 'legRId', 'torsoId',
  'hairId', 'maskId', 'neckId', 'chestId', 'waistId', 'handId', 'shoesId', 'faceId', 'pantsId', 'shirtId',
]

const num = (v, lim = 1e5) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < lim ? v : 0)
const cleanName = (n) => String(n || 'Player').replace(/[^\w .-]/g, '').slice(0, 20) || 'Player'
const cleanChar = (c) => (typeof c === 'string' && /^[a-z0-9]{1,24}$/.test(c) ? c : 'bloxity')
const cleanAura = (a) => (typeof a === 'string' && /^[a-z0-9]{1,24}$/.test(a) ? a : 'none')

function cleanAvatar(a) {
  if (!a || typeof a !== 'object') return null
  const out = {}
  for (const k of AVATAR_KEYS) {
    if (typeof a[k] === 'string' && a[k].length <= 64) out[k] = a[k]
  }
  return out
}

function cleanColor(c) {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#5fd0ff'
}

class LobbyRoom extends Room {
  maxClients = 8

  onCreate() {
    /** sessionId -> player */
    this.players = new Map()

    this.onMessage('move', (client, m) => {
      const p = this.players.get(client.sessionId)
      if (!p || !m) return
      p.x = num(m.x)
      p.y = num(m.y)
      p.z = num(m.z)
      p.yaw = num(m.yaw, 100)
      p.spd = num(m.spd, 200)
      p.gr = m.gr ? 1 : 0
      p.wr = m.wr === 1 || m.wr === -1 ? m.wr : 0
      p.at = Date.now()
    })

    this.onMessage('look', (client, m) => {
      const p = this.players.get(client.sessionId)
      if (!p || !m) return
      p.char = cleanChar(m.char)
      p.aura = cleanAura(m.aura)
      p.color = cleanColor(m.color)
      if (m.avatar !== undefined) p.avatar = cleanAvatar(m.avatar)
      if (m.name) p.name = cleanName(m.name)
      this.broadcast('look', this.info(p), { except: client })
    })

    this.clock.setInterval(() => {
      if (this.players.size < 2) return
      const t = Date.now()
      const rows = []
      for (const p of this.players.values()) {
        rows.push([p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(2), +p.spd.toFixed(1), p.gr, p.wr, t - p.at])
      }
      this.broadcast('snap', { t, p: rows })
    }, SNAPSHOT_MS)
  }

  info(p) {
    return { id: p.id, name: p.name, char: p.char, aura: p.aura, color: p.color, avatar: p.avatar }
  }

  onJoin(client, options = {}) {
    const p = {
      id: client.sessionId,
      name: cleanName(options.name),
      char: cleanChar(options.char),
      aura: cleanAura(options.aura),
      color: cleanColor(options.color),
      avatar: cleanAvatar(options.avatar),
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      spd: 0,
      gr: 1,
      wr: 0,
      at: Date.now(),
    }
    this.players.set(client.sessionId, p)
    client.send('roster', { you: p.id, players: [...this.players.values()].map((q) => this.info(q)) })
    this.broadcast('join', this.info(p), { except: client })
  }

  onLeave(client) {
    this.players.delete(client.sessionId)
    this.broadcast('leave', client.sessionId)
  }
}

module.exports = { LobbyRoom }
