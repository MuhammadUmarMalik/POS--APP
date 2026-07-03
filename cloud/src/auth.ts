// Stateless admin sessions: HMAC-signed token in an Authorization header.
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { Request, Response, NextFunction } from 'express'
import { getDb } from './db.js'

const TOKEN_SECRET = process.env.POS_TOKEN_SECRET ?? crypto.randomBytes(32).toString('hex')
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000

function sign(payload: string): string {
  return crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex')
}

export function login(username: string, password: string): string | null {
  const row = getDb()
    .prepare('SELECT password_hash FROM admins WHERE username = ?')
    .get(username.toLowerCase()) as { password_hash: string } | undefined
  if (!row || !bcrypt.compareSync(password, row.password_hash)) return null
  const payload = `${username.toLowerCase()}|${Date.now() + TOKEN_TTL_MS}`
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`
}

export function verifyToken(token: string): string | null {
  const [b64, sig] = token.split('.')
  if (!b64 || !sig) return null
  const payload = Buffer.from(b64, 'base64url').toString()
  const expected = sign(payload)
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  const [username, exp] = payload.split('|')
  if (!username || Number(exp) < Date.now()) return null
  return username
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const username = token ? verifyToken(token) : null
  if (!username) {
    res.status(401).json({ error: 'Not logged in' })
    return
  }
  ;(req as Request & { admin: string }).admin = username
  next()
}
