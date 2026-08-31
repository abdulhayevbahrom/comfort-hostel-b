import assert from 'node:assert/strict'
import test from 'node:test'
import { signFaceIdRequest } from '../src/middleware/faceIdIntegration.js'
import { accessDecision, localDateKey, shouldQueueDebtSms } from '../src/utils/faceAccess.js'
import { planStudentMovement } from '../src/utils/studentPresence.js'

test('qarzsiz faol talaba kiradi', () => {
  assert.deepEqual(accessDecision({ hasActiveContract: true, accessEnabled: true, debtAmount: 0, warningCount: 0 }), {
    allowed: true,
    decision: 'granted',
  })
})

test('qarzdor talaba SMS limitidan keyin ham bloklanmaydi', () => {
  assert.equal(accessDecision({ hasActiveContract: true, accessEnabled: true, debtAmount: 1000, warningCount: 2 }).allowed, true)
  assert.deepEqual(accessDecision({ hasActiveContract: true, accessEnabled: true, debtAmount: 1000, warningCount: 3 }), {
    allowed: true,
    decision: 'granted_warning',
  })
})

test('backend shartnoma yoki eski access bayrog‘i sabab eshikni rad etmaydi', () => {
  assert.equal(accessDecision({ hasActiveContract: false, accessEnabled: false, debtAmount: 0, warningCount: 0 }).allowed, true)
})

test('qarzdorlik SMSi faqat uch marta navbatga qo‘yiladi', () => {
  assert.equal(shouldQueueDebtSms({ debtAmount: 1000, warningCount: 0 }), true)
  assert.equal(shouldQueueDebtSms({ debtAmount: 1000, warningCount: 2 }), true)
  assert.equal(shouldQueueDebtSms({ debtAmount: 1000, warningCount: 3 }), false)
  assert.equal(shouldQueueDebtSms({ debtAmount: 0, warningCount: 0 }), false)
})

test('HMAC imzo deterministik', () => {
  const request = { secret: 'x'.repeat(32), timestamp: 123, method: 'POST', path: '/api/integrations/faceid/access-check', body: { faceIdCode: 'STU000000000001' } }
  assert.equal(signFaceIdRequest(request), signFaceIdRequest(request))
  assert.notEqual(signFaceIdRequest(request), signFaceIdRequest({ ...request, body: { faceIdCode: 'STU000000000002' } }))
})

test('davomat sanasi lokal sana bilan olinadi', () => {
  assert.match(localDateKey(new Date(2026, 7, 28, 10, 30)), /^2026-08-28$/)
})

test('Contabo UTC vaqti Toshkent sanasiga aylantiriladi', () => {
  assert.equal(localDateKey(new Date('2026-08-27T20:30:00.000Z')), '2026-08-28')
})

test('birinchi IN eventi talabani binoda deb belgilaydi', () => {
  assert.deepEqual(planStudentMovement({ configuredDirection: 'IN', isInside: false, occurredAt: '2026-08-31T05:00:00.000Z' }), {
    direction: 'IN',
    transition: 'entered',
    applied: true,
  })
})

test('OUT eventi ochiq kirish sessiyasini yopadi', () => {
  assert.deepEqual(planStudentMovement({ configuredDirection: 'OUT', isInside: true, lastDirection: 'IN', lastEventAt: '2026-08-31T05:00:00.000Z', occurredAt: '2026-08-31T08:15:00.000Z' }), {
    direction: 'OUT',
    transition: 'exited',
    applied: true,
  })
})

test('qisqa vaqtdagi takroriy IN yangi sessiya ochmaydi', () => {
  assert.deepEqual(planStudentMovement({ configuredDirection: 'IN', isInside: true, lastDirection: 'IN', lastEventAt: '2026-08-31T05:00:00.000Z', occurredAt: '2026-08-31T05:01:00.000Z', duplicateWindowMs: 300_000 }), {
    direction: 'IN',
    transition: 'duplicate',
    applied: false,
  })
})

test('chiqish qaydisiz keyingi IN eski sessiyani to‘liqsiz deb ajratadi', () => {
  assert.deepEqual(planStudentMovement({ configuredDirection: 'IN', isInside: true, lastDirection: 'IN', lastEventAt: '2026-08-31T05:00:00.000Z', occurredAt: '2026-08-31T06:00:00.000Z', duplicateWindowMs: 300_000 }), {
    direction: 'IN',
    transition: 'reentered',
    applied: true,
  })
})
