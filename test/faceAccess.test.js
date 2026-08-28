import assert from 'node:assert/strict'
import test from 'node:test'
import { signFaceIdRequest } from '../src/middleware/faceIdIntegration.js'
import { accessDecision, localDateKey } from '../src/utils/faceAccess.js'

test('qarzsiz faol talaba kiradi', () => {
  assert.deepEqual(accessDecision({ hasActiveContract: true, accessEnabled: true, debtAmount: 0, warningCount: 0 }), {
    allowed: true,
    decision: 'granted',
  })
})

test('qarzdor talaba uchinchi ogohlantirishgacha kiradi, keyin bloklanadi', () => {
  assert.equal(accessDecision({ hasActiveContract: true, accessEnabled: true, debtAmount: 1000, warningCount: 2 }).allowed, true)
  assert.deepEqual(accessDecision({ hasActiveContract: true, accessEnabled: true, debtAmount: 1000, warningCount: 3 }), {
    allowed: false,
    decision: 'denied_debt_limit',
  })
})

test('faol shartnoma va qo‘lda ruxsat tekshiriladi', () => {
  assert.equal(accessDecision({ hasActiveContract: false, accessEnabled: true, debtAmount: 0, warningCount: 0 }).decision, 'denied_inactive')
  assert.equal(accessDecision({ hasActiveContract: true, accessEnabled: false, debtAmount: 0, warningCount: 0 }).decision, 'denied_disabled')
})

test('HMAC imzo deterministik', () => {
  const request = { secret: 'x'.repeat(32), timestamp: 123, method: 'POST', path: '/api/integrations/faceid/access-check', body: { faceIdCode: 'STU-1' } }
  assert.equal(signFaceIdRequest(request), signFaceIdRequest(request))
  assert.notEqual(signFaceIdRequest(request), signFaceIdRequest({ ...request, body: { faceIdCode: 'STU-2' } }))
})

test('davomat sanasi lokal sana bilan olinadi', () => {
  assert.match(localDateKey(new Date(2026, 7, 28, 10, 30)), /^2026-08-28$/)
})

test('Contabo UTC vaqti Toshkent sanasiga aylantiriladi', () => {
  assert.equal(localDateKey(new Date('2026-08-27T20:30:00.000Z')), '2026-08-28')
})
