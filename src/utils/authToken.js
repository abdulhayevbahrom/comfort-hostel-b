import crypto from 'crypto'

const secret = () => process.env.AUTH_SECRET || 'tizimplus-hostel-change-this-secret'
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

export function createAuthToken(employee) {
  const payload = encode({ id: employee.id, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })
  const signature = crypto.createHmac('sha256', secret()).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

export function verifyAuthToken(token) {
  const [payload, signature] = String(token || '').split('.')
  if (!payload || !signature) return null
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url')
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
  const value = JSON.parse(Buffer.from(payload, 'base64url').toString())
  return value.exp > Date.now() ? value : null
}
