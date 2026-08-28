import assert from 'node:assert/strict'
import test from 'node:test'
import { extractHikvisionEvent, isHeartbeatEvent } from '../src/utils/hikvisionEvent.js'

test('ISUP JSON eventdan device va shaxs maydonlari olinadi', () => {
  const event = extractHikvisionEvent({
    body: {
      deviceID: 'HOSTEL-DOOR-01',
      dateTime: '2026-08-28T09:30:00+05:00',
      serialNo: 73,
      AccessControllerEvent: { employeeNoString: 'STU-ABCDEF123456' },
    },
    files: [],
  })
  assert.equal(event.deviceId, 'HOSTEL-DOOR-01')
  assert.equal(event.faceCode, 'STU-ABCDEF123456')
  assert.equal(event.serialNo, '73')
})

test('XML heartbeat aniqlanadi', () => {
  const event = extractHikvisionEvent({ body: '<EventNotificationAlert><eventType>heartbeat</eventType><deviceID>D1</deviceID></EventNotificationAlert>', files: [] })
  assert.equal(event.deviceId, 'D1')
  assert.equal(isHeartbeatEvent(event), true)
})
