import { FaceAccessEvent } from '../models/FaceAccessEvent.js'
import { FaceDevice } from '../models/FaceDevice.js'
import { FaceDeviceEvent } from '../models/FaceDeviceEvent.js'
import { StudentMovement } from '../models/StudentMovement.js'
import { recordStudentMovement } from '../services/studentPresence.service.js'

export async function backfillStudentMovements() {
  const events = await FaceAccessEvent.find({
    student: { $ne: null },
    decision: { $in: ['granted', 'granted_warning'] },
  }).select('_id eventId student deviceKey direction occurredAt').sort({ occurredAt: 1 })
  if (!events.length) return { updated: 0 }

  const existingIds = new Set((await StudentMovement.find({ eventId: { $in: events.map((item) => item.eventId) } }).select('eventId')).map((item) => item.eventId))
  const devices = await FaceDevice.find({ deviceKey: { $in: [...new Set(events.map((item) => item.deviceKey).filter(Boolean))] } }).select('_id deviceKey')
  const deviceByKey = new Map(devices.map((item) => [item.deviceKey, item]))
  let updated = 0
  for (const event of events) {
    if (existingIds.has(event.eventId)) continue
    const device = deviceByKey.get(event.deviceKey)
    const deviceEvent = await FaceDeviceEvent.findOne({ eventId: event.eventId }).select('_id')
    await recordStudentMovement({
      studentId: event.student,
      eventId: event.eventId,
      configuredDirection: event.direction,
      occurredAt: event.occurredAt,
      deviceId: device?._id || null,
      deviceEventId: deviceEvent?._id || null,
      faceAccessEventId: event._id,
      source: 'backfill',
    })
    updated += 1
  }
  return { updated }
}
