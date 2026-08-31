import { Attendance } from '../models/Attendance.js'
import { ContractInstallment } from '../models/ContractInstallment.js'
import { DebtorSms } from '../models/DebtorSms.js'
import { FaceAccessEvent } from '../models/FaceAccessEvent.js'
import { FaceAccessState } from '../models/FaceAccessState.js'
import { GeneralSetting } from '../models/GeneralSetting.js'
import { Student } from '../models/Student.js'
import { StudentContract } from '../models/StudentContract.js'
import { accessDecision, FACE_WARNING_LIMIT, localDateKey, shouldQueueDebtSms } from '../utils/faceAccess.js'
import { renderDebtorSms, sendTextUpSms } from '../utils/textup.js'

const DUPLICATE_SCAN_MS = Math.max(5, Number(process.env.FACEID_RESCAN_SECONDS || 300)) * 1000
const SMS_MAX_ATTEMPTS = Math.max(1, Number(process.env.FACEID_SMS_MAX_ATTEMPTS || 8))
const SMS_WORKER_INTERVAL_MS = Math.max(5, Number(process.env.FACEID_SMS_WORKER_SECONDS || 30)) * 1000
const uzbekMonths = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']
const studentLocks = new Map()
let smsWorkerTimer = null
let smsWorkerRunning = false

const formatSmsPeriod = (periodKey) => `${uzbekMonths[Number(String(periodKey).slice(5, 7)) - 1] || periodKey} oyi`
const resultFromEvent = (event) => ({
  eventId: event.eventId,
  // Qurilma eshik qarorini lokal beradi. Backend hech qachon kirishni rad etmaydi.
  allowed: true,
  decision: event.decision,
  reason: event.reason,
  debtAmount: event.debtAmount,
  warningCount: event.warningCount,
  warningLimit: FACE_WARNING_LIMIT,
  smsStatus: event.smsStatus,
  studentId: event.student?.toString?.() || event.student || null,
})

async function withStudentLock(studentId, task) {
  const key = String(studentId)
  const previous = studentLocks.get(key) || Promise.resolve()
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const queued = previous.catch(() => {}).then(() => gate)
  studentLocks.set(key, queued)
  await previous.catch(() => {})
  try { return await task() }
  finally {
    release()
    if (studentLocks.get(key) === queued) studentLocks.delete(key)
  }
}

async function recordAttendance(student, occurredAt, accessEvent) {
  const attendanceDate = localDateKey(occurredAt)
  await Attendance.findOneAndUpdate(
    { student: student._id, attendanceDate },
    {
      $set: { status: 'present', source: 'faceid', markedAt: occurredAt, lastSeenAt: occurredAt, faceAccessEvent: accessEvent._id },
      $setOnInsert: { firstEntry: occurredAt, markedBy: null, note: '' },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  accessEvent.attendanceRecorded = true
  await accessEvent.save()
}

async function activeContractAndDebt(studentId, occurredAt) {
  const start = new Date(occurredAt); start.setHours(0, 0, 0, 0)
  const end = new Date(occurredAt); end.setHours(23, 59, 59, 999)
  const contracts = await StudentContract.find({ student: studentId, status: 'active', startDate: { $lte: end }, endDate: { $gte: start } }).select('_id')
  if (!contracts.length) return { hasActiveContract: false, debtAmount: 0, installments: [] }
  const installments = await ContractInstallment.find({
    student: studentId,
    contract: { $in: contracts.map((item) => item._id) },
    dueDate: { $lte: end },
    $expr: { $lt: ['$paidAmount', '$amount'] },
  }).sort({ dueDate: 1 })
  return {
    hasActiveContract: true,
    debtAmount: installments.reduce((sum, item) => sum + Math.max(0, item.amount - item.paidAmount), 0),
    installments,
  }
}

async function ensureDebtState(studentId, debtAmount, occurredAt) {
  let state = await FaceAccessState.findOne({ student: studentId })
  if (!state) return FaceAccessState.create({ student: studentId, debtCycle: 1, activeDebt: true, warningCount: 0, blocked: false, lastDebtAmount: debtAmount, debtStartedAt: occurredAt })
  if (!state.activeDebt) {
    state.debtCycle += 1
    state.activeDebt = true
    state.warningCount = 0
    state.blocked = false
    state.debtStartedAt = occurredAt
    state.clearedAt = null
  }
  state.lastDebtAmount = debtAmount
  state.blocked = false
  await state.save()
  return state
}

const saveObservedEvent = (values) => FaceAccessEvent.create({
  eventId: values.eventId,
  faceIdCode: values.faceIdCode,
  student: values.student?._id || null,
  deviceKey: values.deviceKey,
  direction: values.direction,
  occurredAt: values.occurredAt,
  decision: values.decision,
  reason: values.reason,
  debtAmount: values.debtAmount || 0,
  warningCount: values.warningCount || 0,
  smsStatus: 'not_required',
})

const retryDelayMs = (attempt) => Math.min(60 * 60 * 1000, 15_000 * (2 ** Math.max(0, attempt - 1)))

export async function deliverFaceAccessSms(eventId, { io } = {}) {
  const now = new Date()
  const event = await FaceAccessEvent.findOneAndUpdate(
    {
      _id: eventId,
      smsStatus: { $in: ['queued', 'failed'] },
      smsAttempts: { $lt: SMS_MAX_ATTEMPTS },
      $or: [{ smsNextAttemptAt: null }, { smsNextAttemptAt: { $lte: now } }],
    },
    { $set: { smsStatus: 'sending', smsError: '' }, $inc: { smsAttempts: 1 } },
    { new: true },
  )
  if (!event) return null

  try {
    const destination = await sendTextUpSms({ destination: event.smsDestination, content: event.smsContent })
    const existing = await DebtorSms.findOne({ faceAccessEvent: event._id })
    if (!existing) {
      await DebtorSms.create({
        student: event.student,
        periodKey: event.smsPeriodKey,
        destination,
        content: event.smsContent,
        sentBy: null,
        source: 'faceid',
        faceAccessEvent: event._id,
      })
    }
    event.smsStatus = 'sent'
    event.smsDestination = destination
    event.smsSentAt = new Date()
    event.smsNextAttemptAt = null
    event.smsError = ''
    await event.save()
    io?.emit('face-access:changed', { eventId: event.eventId, studentId: event.student?.toString(), decision: event.decision, warningCount: event.warningCount, smsStatus: 'sent' })
    return event
  } catch (error) {
    event.smsStatus = 'failed'
    event.smsError = String(error.message || error).slice(0, 500)
    event.smsNextAttemptAt = event.smsAttempts < SMS_MAX_ATTEMPTS ? new Date(Date.now() + retryDelayMs(event.smsAttempts)) : null
    await event.save()
    console.error(`FaceID SMS yuborilmadi (${event.eventId}, urinish ${event.smsAttempts}/${SMS_MAX_ATTEMPTS}): ${event.smsError}`)
    io?.emit('face-access:changed', { eventId: event.eventId, studentId: event.student?.toString(), decision: event.decision, warningCount: event.warningCount, smsStatus: 'failed' })
    return event
  }
}

export const scheduleFaceAccessSms = (eventId, options = {}) => {
  setImmediate(() => deliverFaceAccessSms(eventId, options).catch((error) => console.error(`FaceID SMS navbati xatosi: ${error.message}`)))
}

export async function processPendingFaceAccessSms({ io, limit = 10 } = {}) {
  if (smsWorkerRunning) return 0
  smsWorkerRunning = true
  try {
    const now = new Date()
    const events = await FaceAccessEvent.find({
      smsStatus: { $in: ['queued', 'failed'] },
      smsAttempts: { $lt: SMS_MAX_ATTEMPTS },
      $or: [{ smsNextAttemptAt: null }, { smsNextAttemptAt: { $lte: now } }],
    }).select('_id').sort({ occurredAt: 1 }).limit(limit)
    for (const event of events) await deliverFaceAccessSms(event._id, { io })
    return events.length
  } finally { smsWorkerRunning = false }
}

export async function startFaceAccessSmsWorker({ io } = {}) {
  // Eski remote-access rejimidan qolgan bloklarni yangi attendance-only rejimida bekor qilamiz.
  await FaceAccessState.updateMany({ blocked: true }, { $set: { blocked: false } })
  await FaceAccessEvent.updateMany({ smsStatus: 'sending' }, { $set: { smsStatus: 'queued', smsNextAttemptAt: new Date() } })
  await processPendingFaceAccessSms({ io })
  if (!smsWorkerTimer) {
    smsWorkerTimer = setInterval(() => processPendingFaceAccessSms({ io }).catch((error) => console.error(`FaceID SMS worker xatosi: ${error.message}`)), SMS_WORKER_INTERVAL_MS)
    smsWorkerTimer.unref?.()
  }
}

async function evaluateKnownStudent(student, values, { io } = {}) {
  const { faceIdCode, eventId, deviceKey, direction, occurredAt } = values
  const existing = await FaceAccessEvent.findOne({ eventId })
  if (existing) return resultFromEvent(existing)

  const { debtAmount, installments } = await activeContractAndDebt(student._id, occurredAt)

  if (debtAmount <= 0) {
    await FaceAccessState.findOneAndUpdate({ student: student._id, activeDebt: true }, { $set: { activeDebt: false, warningCount: 0, blocked: false, lastDebtAmount: 0, clearedAt: occurredAt } })
    const event = await FaceAccessEvent.create({ eventId, faceIdCode, student: student._id, deviceKey, direction, occurredAt, decision: 'granted', reason: 'Qarzdorlik mavjud emas', debtAmount: 0, warningCount: 0, smsStatus: 'not_required' })
    await recordAttendance(student, occurredAt, event)
    io?.emit('face-access:changed', { eventId, studentId: student.id, decision: event.decision })
    return resultFromEvent(event)
  }

  const state = await ensureDebtState(student._id, debtAmount, occurredAt)
  const policy = accessDecision({ debtAmount })

  const lastEvent = await FaceAccessEvent.findOne({
    student: student._id,
    deviceKey,
    occurredAt: { $gte: new Date(occurredAt.getTime() - DUPLICATE_SCAN_MS), $lte: occurredAt },
    decision: { $in: ['granted', 'granted_warning'] },
  }).sort({ occurredAt: -1 })
  if (lastEvent) {
    const event = await FaceAccessEvent.create({ eventId, faceIdCode, student: student._id, deviceKey, direction, occurredAt, decision: lastEvent.decision, reason: 'Takroriy FaceID skani', debtAmount, warningCount: state.warningCount, smsStatus: 'duplicate' })
    await recordAttendance(student, occurredAt, event)
    return resultFromEvent(event)
  }

  if (!shouldQueueDebtSms({ debtAmount, warningCount: state.warningCount })) {
    const event = await FaceAccessEvent.create({
      eventId,
      faceIdCode,
      student: student._id,
      deviceKey,
      direction,
      occurredAt,
      decision: policy.decision,
      reason: `${FACE_WARNING_LIMIT}/${FACE_WARNING_LIMIT} SMS ogohlantirish yuborilgan; yangi SMS yuborilmadi`,
      debtAmount,
      warningCount: state.warningCount,
      smsStatus: 'limit_reached',
    })
    await recordAttendance(student, occurredAt, event)
    io?.emit('face-access:changed', { eventId, studentId: student.id, decision: event.decision, warningCount: event.warningCount, smsStatus: event.smsStatus })
    return resultFromEvent(event)
  }

  const settings = await GeneralSetting.findOneAndUpdate({ key: 'general' }, { $setOnInsert: { key: 'general' } }, { new: true, upsert: true, setDefaultsOnInsert: true })
  const periodKey = installments[0].periodKey
  const content = renderDebtorSms(settings.debtorSmsTemplate, {
    studentName: student.fullName,
    debtAmount: Number(debtAmount).toLocaleString('uz-UZ'),
    period: formatSmsPeriod(periodKey),
    hostelName: settings.hostelName,
  })
  state.warningCount = Math.min(FACE_WARNING_LIMIT, state.warningCount + 1)
  state.lastWarningAt = occurredAt
  state.blocked = false
  await state.save()
  const event = await FaceAccessEvent.create({
    eventId,
    faceIdCode,
    student: student._id,
    deviceKey,
    direction,
    occurredAt,
    decision: 'granted_warning',
    reason: `${state.warningCount}/${FACE_WARNING_LIMIT} SMS ogohlantirish navbatga qo‘yildi`,
    debtAmount,
    warningCount: state.warningCount,
    smsStatus: 'queued',
    smsPeriodKey: periodKey,
    smsContent: content,
    smsDestination: student.phone,
    smsNextAttemptAt: new Date(),
  })
  await recordAttendance(student, occurredAt, event)
  io?.emit('face-access:changed', { eventId, studentId: student.id, decision: event.decision, warningCount: event.warningCount, smsStatus: 'queued' })
  scheduleFaceAccessSms(event._id, { io })
  return resultFromEvent(event)
}

export async function evaluateStudentFaceAccess(payload, { io } = {}) {
  const faceIdCode = String(payload.faceIdCode || '').trim().toUpperCase()
  const eventId = String(payload.eventId || '').trim()
  const deviceKey = String(payload.deviceKey || '').trim()
  const direction = ['IN', 'OUT', 'BOTH'].includes(payload.direction) ? payload.direction : 'IN'
  const occurredAt = new Date(payload.occurredAt)
  if (!faceIdCode || !eventId || Number.isNaN(occurredAt.getTime())) throw Object.assign(new Error('faceIdCode, eventId va occurredAt majburiy'), { status: 400 })

  const existing = await FaceAccessEvent.findOne({ eventId })
  if (existing) return resultFromEvent(existing)
  const student = await Student.findOne({ faceIdCode })
  if (!student) return resultFromEvent(await saveObservedEvent({ eventId, faceIdCode, deviceKey, direction, occurredAt, decision: 'observed_unknown', reason: 'FaceID kodi bazadagi talabaga biriktirilmagan' }))
  return withStudentLock(student._id, () => evaluateKnownStudent(student, { faceIdCode, eventId, deviceKey, direction, occurredAt }, { io }))
}
