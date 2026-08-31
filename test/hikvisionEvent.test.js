import assert from 'node:assert/strict'
import test from 'node:test'
import { extractHikvisionEvent, isHeartbeatEvent } from '../src/utils/hikvisionEvent.js'

test('Hikvision JSON eventidan FaceID va vaqt olinadi', () => {
  const payload = extractHikvisionEvent({
    body: {
      eventType: 'AccessControllerEvent',
      dateTime: '2026-08-31T09:30:00+05:00',
      AccessControllerEvent: { employeeNoString: 'STU000000001001', serialNo: 17 },
    },
    files: [],
  })
  assert.equal(payload.faceCode, 'STU000000001001')
  assert.equal(payload.serialNo, '17')
  assert.equal(payload.dateTime, '2026-08-31T09:30:00+05:00')
})

test('Hikvision XML eventidan FaceID olinadi', () => {
  const payload = extractHikvisionEvent({
    body: '<?xml version="1.0"?><EventNotificationAlert><eventType>AccessControllerEvent</eventType><dateTime>2026-08-31T09:30:00+05:00</dateTime><employeeNoString>EMP000000000201</employeeNoString></EventNotificationAlert>',
    files: [],
  })
  assert.equal(payload.faceCode, 'EMP000000000201')
  assert.equal(payload.eventType, 'AccessControllerEvent')
})

test('heartbeat eventi shaxs davomati sifatida olinmaydi', () => {
  assert.equal(isHeartbeatEvent({ eventType: 'heartbeat' }), true)
  assert.equal(isHeartbeatEvent({ eventType: 'AccessControllerEvent' }), false)
})
