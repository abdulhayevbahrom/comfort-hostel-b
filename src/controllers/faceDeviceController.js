import crypto from 'node:crypto'
import mongoose from 'mongoose'
import { Employee } from '../models/Employee.js'
import { EmployeeAttendance } from '../models/EmployeeAttendance.js'
import { FaceDevice } from '../models/FaceDevice.js'
import { FaceDeviceEvent } from '../models/FaceDeviceEvent.js'
import { evaluateStudentFaceAccess } from '../services/studentFaceAccess.service.js'
import { resolveEmployeeAttendanceDate } from '../utils/faceTime.js'
import { extractHikvisionEvent, isHeartbeatEvent } from '../utils/hikvisionEvent.js'
import { HIKVISION_TRANSPORTS, openHikvisionDoor, sendHikvisionRemoteCheck } from '../utils/hikvision.js'
import { ApiResponse } from '../utils/response.js'

const MIN_RESCAN_SECONDS = Math.max(5, Number(process.env.FACEID_RESCAN_SECONDS || 300))
const ONLINE_WINDOW_MS = Math.max(30, Number(process.env.HIKVISION_ONLINE_WINDOW_SECONDS || 180)) * 1000
const accessAllowed = (decision) => ['granted', 'granted_warning'].includes(decision)
const remoteIp = (req) => String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '')

const ipAllowed = (req, variableName) => {
  const allowed = String(process.env[variableName] || '').split(',').map((item) => item.trim()).filter(Boolean)
  return !allowed.length || allowed.includes(remoteIp(req))
}

const constantTimeEqual = (left, right) => {
  const first = Buffer.from(String(left || ''))
  const second = Buffer.from(String(right || ''))
  return first.length === second.length && crypto.timingSafeEqual(first, second)
}

const gatewaySecret = (req) => {
  const authorization = String(req.headers.authorization || '')
  if (/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, '').trim()
  return String(req.headers['x-hikvision-gateway-secret'] || req.query.secret || '')
}

const validateGatewayRequest = (req) => {
  const expected = String(process.env.HIKVISION_GATEWAY_WEBHOOK_SECRET || '')
  if (!expected) return { ok: false, status: 503, message: 'HIKVISION_GATEWAY_WEBHOOK_SECRET sozlanmagan' }
  if (!ipAllowed(req, 'HIKVISION_GATEWAY_ALLOWED_IPS')) return { ok: false, status: 403, message: 'ISUP gateway IP manziliga ruxsat berilmagan' }
  if (!constantTimeEqual(gatewaySecret(req), expected)) return { ok: false, status: 401, message: 'ISUP gateway kaliti noto‘g‘ri' }
  return { ok: true }
}

const safeApplyAccessDecision = async (device, payload, allowed, info) => {
  try {
    if (device.transport === 'isup_gateway' && process.env.HIKVISION_GATEWAY_DECISION_MODE === 'callback_response') {
      const enabled = device.doorControlEnabled ?? (process.env.HIKVISION_DOOR_CONTROL_ENABLED === 'true')
      if (!enabled) return { attempted: false, opened: false, reason: 'Door control o‘chirilgan', mode: 'callback_response', transport: 'isup_gateway' }
      return { attempted: true, opened: Boolean(allowed), mode: 'callback_response', transport: 'isup_gateway' }
    }
    if (device.controlMode === 'remote_check') return await sendHikvisionRemoteCheck(device, { serialNo: payload.serialNo, allowed, info })
    return allowed ? await openHikvisionDoor(device) : { attempted: false, opened: false, reason: 'Kirish rad etildi', mode: 'remote_open', transport: device.transport }
  } catch (error) {
    return { attempted: true, opened: false, error: error.message, mode: device.controlMode, transport: device.transport }
  }
}

async function recordEmployeeAttendance(employee, device, occurredAt, deviceEvent) {
  const schedule = employee.workSchedule || {}
  const date = resolveEmployeeAttendanceDate(schedule, device.direction, occurredAt)
  let attendance = await EmployeeAttendance.findOne({ employee: employee._id, date })
  if (!attendance) {
    if (device.direction === 'OUT') return { action: 'out_without_entry', date }
    try {
      attendance = await EmployeeAttendance.create({ employee: employee._id, date, firstEntry: occurredAt, currentEntry: occurredAt, lastDeviceEvent: deviceEvent._id })
    } catch (error) {
      if (error?.code !== 11000) throw error
      attendance = await EmployeeAttendance.findOne({ employee: employee._id, date })
    }
    return { action: 'check_in', date, attendance }
  }
  const lastMark = attendance.currentEntry || attendance.lastExit || attendance.firstEntry
  if (lastMark && (occurredAt - lastMark) / 1000 < MIN_RESCAN_SECONDS) return { action: 'duplicate', date, attendance }
  const openSession = () => { if (!attendance.firstEntry) attendance.firstEntry = occurredAt; attendance.currentEntry = occurredAt }
  const closeSession = () => {
    if (!attendance.currentEntry) return false
    attendance.totalHours += Math.max(0, occurredAt - attendance.currentEntry) / 3_600_000
    attendance.lastExit = occurredAt
    attendance.currentEntry = null
    return true
  }
  let action
  if (device.direction === 'IN') {
    action = attendance.currentEntry ? 'already_inside' : 'check_in'
    if (!attendance.currentEntry) openSession()
  } else if (device.direction === 'OUT') action = closeSession() ? 'check_out' : 'already_outside'
  else if (attendance.currentEntry) { closeSession(); action = 'check_out' }
  else { openSession(); action = 'check_in' }
  attendance.lastDeviceEvent = deviceEvent._id
  await attendance.save()
  return { action, date, attendance }
}

const deviceCommand = (device, payload, allowed) => ({
  enabled: Boolean(device.doorControlEnabled),
  transport: device.transport,
  type: device.controlMode,
  serialNo: payload.serialNo || null,
  checkResult: allowed ? 'success' : 'failed',
  doorNo: device.doorNo,
})

async function saveDeviceResult(device, deviceEvent, door, startedAt) {
  deviceEvent.doorAttempted = Boolean(door.attempted)
  deviceEvent.doorOpened = Boolean(door.opened)
  deviceEvent.error = door.error || ''
  deviceEvent.processingMs = Date.now() - startedAt
  await deviceEvent.save()
  await FaceDevice.updateOne(
    { _id: device._id },
    { $set: { lastSeenAt: new Date(), lastEventAt: deviceEvent.occurredAt, lastError: door.error || '' } },
  )
}

class FaceDeviceController {
  handleEvent = async (req, res, next, device) => {
    const startedAt = Date.now()
    try {
      const payload = extractHikvisionEvent(req)
      await FaceDevice.updateOne({ _id: device._id }, { $set: { lastSeenAt: new Date() } })
      if (isHeartbeatEvent(payload) || !payload.faceCode) return ApiResponse.ok(res, { acknowledged: true })

      const occurredAt = new Date(payload.dateTime)
      if (Number.isNaN(occurredAt.getTime())) return ApiResponse.badRequest(res, 'Hikvision dateTime noto‘g‘ri')
      const age = Date.now() - occurredAt.getTime()
      if (age > 48 * 60 * 60 * 1000 || age < -5 * 60 * 1000) return ApiResponse.ok(res, { ignored: true }, 'Event vaqti ruxsat etilgan oraliqdan tashqarida')

      const faceCode = String(payload.faceCode).trim().toUpperCase()
      const eventId = crypto.createHash('sha256').update([
        device.id,
        payload.sourceEventId || payload.serialNo || '',
        faceCode,
        occurredAt.toISOString(),
        payload.eventType || 'access',
      ].join(':')).digest('hex')
      let deviceEvent
      try {
        deviceEvent = await FaceDeviceEvent.create({
          device: device._id,
          eventId,
          occurredAt,
          faceCode,
          transport: device.transport,
          sourceSerialNo: payload.serialNo || '',
          rawEventType: payload.eventType || '',
        })
      } catch (error) {
        if (error?.code !== 11000) throw error
        const existing = await FaceDeviceEvent.findOne({ device: device._id, eventId })
        const allowed = accessAllowed(existing?.accessDecision)
        const door = existing?.accessDecision && existing.accessDecision !== 'processing'
          ? await safeApplyAccessDecision(device, payload, allowed, 'Replay decision')
          : { attempted: false, opened: false, reason: 'Event hali qayta ishlanmoqda', transport: device.transport }
        return ApiResponse.ok(res, { replayIgnored: true, access: { allowed, decision: existing?.accessDecision || 'processing' }, door, deviceCommand: deviceCommand(device, payload, allowed) })
      }

      const employee = await Employee.findOne({ faceIdCode: faceCode, isActive: true })
      if (employee) {
        deviceEvent.personType = 'employee'
        deviceEvent.personId = employee._id
        if (!employee.faceAccessEnabled) {
          const door = await safeApplyAccessDecision(device, payload, false, 'FaceID disabled')
          deviceEvent.accessDecision = 'denied_disabled'
          await saveDeviceResult(device, deviceEvent, door, startedAt)
          return ApiResponse.ok(res, { personType: 'employee', employeeId: employee.id, access: { allowed: false, decision: 'denied_disabled' }, door, deviceCommand: deviceCommand(device, payload, false) })
        }
        const attendance = await recordEmployeeAttendance(employee, device, occurredAt, deviceEvent)
        const door = await safeApplyAccessDecision(device, payload, true, 'Employee granted')
        deviceEvent.accessDecision = 'granted'
        await saveDeviceResult(device, deviceEvent, door, startedAt)
        req.app.get('io')?.emit('employee-attendance:changed', { employeeId: employee.id, date: attendance.date, action: attendance.action })
        return ApiResponse.ok(res, {
          personType: 'employee',
          employeeId: employee.id,
          attendance: { action: attendance.action, date: attendance.date },
          access: { allowed: true, decision: 'granted' },
          door,
          deviceCommand: deviceCommand(device, payload, true),
        })
      }

      const access = await evaluateStudentFaceAccess({
        faceIdCode: faceCode,
        eventId,
        occurredAt: occurredAt.toISOString(),
        deviceKey: device.deviceKey,
        direction: device.direction,
      }, { io: req.app.get('io') })
      const door = await safeApplyAccessDecision(device, payload, access.allowed, access.allowed ? 'Student granted' : 'Student denied')
      deviceEvent.personType = access.studentId ? 'student' : 'unknown'
      deviceEvent.personId = access.studentId || null
      deviceEvent.accessDecision = access.decision
      await saveDeviceResult(device, deviceEvent, door, startedAt)
      return ApiResponse.ok(res, { personType: deviceEvent.personType, access, door, deviceCommand: deviceCommand(device, payload, access.allowed) })
    } catch (error) {
      await FaceDevice.updateOne({ _id: device._id }, { $set: { lastSeenAt: new Date(), lastError: String(error.message || error).slice(0, 500) } }).catch(() => {})
      return next(error)
    }
  }

  event = async (req, res, next) => {
    try {
      const device = await FaceDevice.findOne({ deviceKey: req.params.key, isActive: true })
      if (!device) return ApiResponse.notFound(res, 'FaceID qurilma topilmadi')
      if (!ipAllowed(req, 'HIKVISION_EVENT_ALLOWED_IPS')) return ApiResponse.forbidden(res, 'Qurilma IP manziliga ruxsat berilmagan')
      return this.handleEvent(req, res, next, device)
    } catch (error) { return next(error) }
  }

  isupEvent = async (req, res, next) => {
    try {
      const auth = validateGatewayRequest(req)
      if (!auth.ok) return ApiResponse.send(res, auth.status, null, auth.message)
      const payload = extractHikvisionEvent(req)
      const isupDeviceId = String(payload.deviceId || req.headers['x-hikvision-device-id'] || '').trim()
      if (!isupDeviceId) return ApiResponse.badRequest(res, 'ISUP eventda deviceID kelmadi')
      const device = await FaceDevice.findOne({ isupDeviceId, transport: 'isup_gateway', isActive: true })
      if (!device) return ApiResponse.notFound(res, 'ISUP Device ID bilan FaceID qurilma topilmadi')
      return this.handleEvent(req, res, next, device)
    } catch (error) { return next(error) }
  }

  list = async (_req, res, next) => {
    try {
      const now = Date.now()
      const devices = (await FaceDevice.find().sort({ createdAt: -1 })).map((device) => ({
        ...device.toJSON(),
        online: Boolean(device.lastSeenAt && now - device.lastSeenAt.getTime() <= ONLINE_WINDOW_MS),
      }))
      return ApiResponse.ok(res, { devices })
    } catch (error) { return next(error) }
  }

  create = async (req, res, next) => {
    try {
      const transport = HIKVISION_TRANSPORTS.includes(req.body.transport) ? req.body.transport : 'isup_gateway'
      const isupDeviceId = String(req.body.isupDeviceId || '').trim()
      const host = String(req.body.host || '').trim()
      const controlMode = ['remote_check', 'remote_open'].includes(req.body.controlMode) ? req.body.controlMode : 'remote_check'
      if (transport === 'isup_gateway' && !isupDeviceId) return ApiResponse.badRequest(res, 'ISUP Device ID majburiy')
      if (transport === 'isup_gateway' && controlMode !== 'remote_check') return ApiResponse.badRequest(res, 'Qarzdorlik nazorati uchun ISUP qurilma remote_check rejimida bo‘lishi kerak')
      if (transport === 'direct_isapi' && !host) return ApiResponse.badRequest(res, 'Direct ISAPI uchun qurilma host manzili majburiy')
      const device = await FaceDevice.create({
        name: String(req.body.name || '').trim(),
        model: req.body.model || 'DS-K1T341AMF',
        transport,
        isupDeviceId: transport === 'isup_gateway' ? isupDeviceId : undefined,
        host: transport === 'direct_isapi' ? host : '',
        doorNo: Number(req.body.doorNo || 1),
        direction: ['IN', 'OUT', 'BOTH'].includes(req.body.direction) ? req.body.direction : 'IN',
        controlMode,
        doorControlEnabled: req.body.doorControlEnabled === true,
        locationDescription: String(req.body.locationDescription || '').trim(),
      })
      return ApiResponse.created(res, { device }, 'FaceID qurilma qo‘shildi')
    } catch (error) { return next(error) }
  }

  update = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'FaceID qurilma topilmadi')
      const device = await FaceDevice.findById(req.params.id)
      if (!device) return ApiResponse.notFound(res, 'FaceID qurilma topilmadi')
      const fields = ['name', 'model', 'transport', 'isupDeviceId', 'host', 'doorNo', 'direction', 'controlMode', 'doorControlEnabled', 'isActive', 'locationDescription']
      for (const field of fields) if (req.body[field] !== undefined) device[field] = req.body[field]
      if (!HIKVISION_TRANSPORTS.includes(device.transport)) return ApiResponse.badRequest(res, 'Hikvision transport turi noto‘g‘ri')
      if (device.transport === 'isup_gateway') {
        device.host = ''
        if (!String(device.isupDeviceId || '').trim()) return ApiResponse.badRequest(res, 'ISUP Device ID majburiy')
        if (device.controlMode !== 'remote_check') return ApiResponse.badRequest(res, 'Qarzdorlik nazorati uchun ISUP qurilma remote_check rejimida bo‘lishi kerak')
      } else if (!String(device.host || '').trim()) return ApiResponse.badRequest(res, 'Direct ISAPI uchun qurilma host manzili majburiy')
      await device.save()
      return ApiResponse.ok(res, { device }, 'FaceID qurilma yangilandi')
    } catch (error) { return next(error) }
  }

  testDoor = async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'FaceID qurilma topilmadi')
      const device = await FaceDevice.findById(req.params.id)
      if (!device) return ApiResponse.notFound(res, 'FaceID qurilma topilmadi')
      const result = await openHikvisionDoor(device, { force: true })
      return ApiResponse.ok(res, result, result.opened ? 'Eshik ochildi' : result.reason)
    } catch (error) { return ApiResponse.send(res, 502, null, error.message) }
  }

  events = async (req, res, next) => {
    try {
      const limit = Math.min(300, Math.max(1, Number(req.query.limit) || 100))
      const events = await FaceDeviceEvent.find().populate('device', 'name model transport isupDeviceId').sort({ occurredAt: -1 }).limit(limit)
      return ApiResponse.ok(res, { events })
    } catch (error) { return next(error) }
  }
}

export const faceDeviceController = new FaceDeviceController()
