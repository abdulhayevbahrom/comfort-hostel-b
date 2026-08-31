import { StudentMovement } from '../models/StudentMovement.js'
import { StudentPresence } from '../models/StudentPresence.js'
import { StudentStaySession } from '../models/StudentStaySession.js'
import { planStudentMovement } from '../utils/studentPresence.js'

const DUPLICATE_SCAN_MS = Math.max(5, Number(process.env.FACEID_RESCAN_SECONDS || 300)) * 1000
const presenceLocks = new Map()

async function withPresenceLock(studentId, task) {
  const key = String(studentId)
  const previous = presenceLocks.get(key) || Promise.resolve()
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const queued = previous.catch(() => {}).then(() => gate)
  presenceLocks.set(key, queued)
  await previous.catch(() => {})
  try { return await task() }
  finally {
    release()
    if (presenceLocks.get(key) === queued) presenceLocks.delete(key)
  }
}

const movementNote = {
  entered: 'Talaba binoga kirdi',
  exited: 'Talaba binodan chiqdi',
  reentered: 'Oldingi chiqish qaydi yo‘q; yangi kirish qayd etildi',
  duplicate: 'Takroriy FaceID skani',
  stale: 'Eski event joriy holatni o‘zgartirmadi',
  orphan_exit: 'Kirish qaydisiz chiqish eventi olindi',
}

export async function previewStudentDirection(studentId, configuredDirection, occurredAt) {
  if (configuredDirection !== 'BOTH') return configuredDirection
  const presence = await StudentPresence.findOne({ student: studentId }).select('isInside lastEventAt lastDirection')
  return planStudentMovement({
    configuredDirection,
    isInside: presence?.isInside || false,
    lastEventAt: presence?.lastEventAt || null,
    lastDirection: presence?.lastDirection || null,
    occurredAt,
    duplicateWindowMs: DUPLICATE_SCAN_MS,
  }).direction
}

export async function recordStudentMovement({
  studentId,
  eventId,
  configuredDirection,
  occurredAt,
  deviceId = null,
  deviceEventId = null,
  faceAccessEventId = null,
  source = 'faceid',
}) {
  const existing = await StudentMovement.findOne({ eventId })
  if (existing) return existing

  return withPresenceLock(studentId, async () => {
    const duplicate = await StudentMovement.findOne({ eventId })
    if (duplicate) return duplicate

    let presence = await StudentPresence.findOne({ student: studentId })
    if (!presence) presence = new StudentPresence({ student: studentId })
    const plan = planStudentMovement({
      configuredDirection,
      isInside: presence.isInside,
      lastEventAt: presence.lastEventAt,
      lastDirection: presence.lastDirection,
      occurredAt,
      duplicateWindowMs: DUPLICATE_SCAN_MS,
    })
    const movement = await StudentMovement.create({
      student: studentId,
      eventId,
      faceAccessEvent: faceAccessEventId,
      deviceEvent: deviceEventId,
      device: deviceId,
      direction: plan.direction,
      occurredAt,
      transition: plan.transition,
      applied: plan.applied,
      source,
      note: movementNote[plan.transition],
    })

    let session = presence.currentSession ? await StudentStaySession.findById(presence.currentSession) : null
    if (!session && presence.isInside) session = await StudentStaySession.findOne({ student: studentId, status: 'open' })

    if (plan.transition === 'entered' || plan.transition === 'reentered') {
      if (session?.status === 'open') {
        session.status = 'incomplete'
        session.incompleteAt = occurredAt
        await session.save()
      }
      session = await StudentStaySession.create({
        student: studentId,
        entryAt: occurredAt,
        entryDevice: deviceId,
        entryMovement: movement._id,
        status: 'open',
      })
      movement.session = session._id
      presence.isInside = true
      presence.currentSession = session._id
      presence.lastEntryAt = occurredAt
      presence.lastTransitionAt = occurredAt
    } else if (plan.transition === 'exited') {
      if (session?.status === 'open') {
        session.exitAt = occurredAt
        session.exitDevice = deviceId
        session.exitMovement = movement._id
        session.durationMinutes = Math.max(0, Math.round((new Date(occurredAt) - session.entryAt) / 60_000))
        session.status = 'closed'
        await session.save()
        movement.session = session._id
      }
      presence.isInside = false
      presence.currentSession = null
      presence.lastExitAt = occurredAt
      presence.lastTransitionAt = occurredAt
    } else if (plan.transition === 'orphan_exit') {
      presence.isInside = false
      presence.currentSession = null
      presence.lastExitAt = occurredAt
      presence.lastTransitionAt = occurredAt
    }

    if (plan.transition !== 'stale') {
      presence.lastEventAt = occurredAt
      presence.lastDirection = plan.direction
      presence.lastDevice = deviceId
      presence.lastMovement = movement._id
    }
    await movement.save()
    await presence.save()
    return movement
  })
}
