import crypto from 'node:crypto'
import { ApiResponse } from '../utils/response.js'

const MAX_CLOCK_SKEW_SECONDS = 5 * 60

export function signFaceIdRequest({ secret, timestamp, method, path, body }) {
  const canonical = `${timestamp}\n${String(method).toUpperCase()}\n${path}\n${JSON.stringify(body ?? {})}`
  return crypto.createHmac('sha256', secret).update(canonical).digest('hex')
}

export function verifyFaceIdIntegration(req, res, next) {
  const secret = process.env.FACEID_INTEGRATION_SECRET
  if (!secret) return ApiResponse.internal(res, 'FACEID_INTEGRATION_SECRET sozlanmagan')

  const timestamp = Number(req.headers['x-faceid-timestamp'])
  const suppliedSignature = String(req.headers['x-faceid-signature'] || '')
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
    return ApiResponse.unauthorized(res, 'FaceID so‘rov vaqti yaroqsiz')
  }

  const expectedSignature = signFaceIdRequest({
    secret,
    timestamp,
    method: req.method,
    path: req.originalUrl,
    body: req.body,
  })
  const expected = Buffer.from(expectedSignature)
  const supplied = Buffer.from(suppliedSignature)
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
    return ApiResponse.unauthorized(res, 'FaceID imzosi noto‘g‘ri')
  }
  return next()
}
