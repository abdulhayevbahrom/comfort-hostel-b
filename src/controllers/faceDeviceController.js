import crypto from 'node:crypto'
import mongoose from 'mongoose'
import { Employee } from '../models/Employee.js'
import { EmployeeAttendance } from '../models/EmployeeAttendance.js'
import { FaceDevice } from '../models/FaceDevice.js'
import { FaceDeviceEvent } from '../models/FaceDeviceEvent.js'
import { Student } from '../models/Student.js'
import { evaluateStudentFaceAccess } from '../services/studentFaceAccess.service.js'
import { previewStudentDirection, recordStudentMovement } from '../services/studentPresence.service.js'
import { resolveEmployeeAttendanceDate } from '../utils/faceTime.js'
import { getEmployeeAttendanceSettings } from '../utils/employeeSchedule.js'
import { extractHikvisionEvent, isHeartbeatEvent } from '../utils/hikvisionEvent.js'
import { ApiResponse } from '../utils/response.js'

const MIN_RESCAN_SECONDS = Math.max(5, Number(process.env.FACEID_RESCAN_SECONDS || 300))
const ONLINE_WINDOW_MS = Math.max(30, Number(process.env.HIKVISION_ONLINE_WINDOW_SECONDS || 180)) * 1000
const remoteIp = (req) => String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '')

const ipAllowed = (req, variableName) => {
  const allowed = String(process.env[variableName] || '').split(',').map((item) => item.trim()).filter(Boolean)
  return !allowed.length || allowed.includes(remoteIp(req))
}

async function recordEmployeeAttendance(employee, device, occurredAt, deviceEvent, schedule) {
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
  const openSession = () => { if (!attendance.firstEntry) attendance.firstEntry = occurredAt; attendance.currentEntry = occurredAt; attendance.exitSource = null }
  const closeSession = () => {
    if (!attendance.currentEntry) return false
    attendance.totalHours += Math.max(0, occurredAt - attendance.currentEntry) / 3_600_000
    attendance.lastExit = occurredAt
    attendance.exitSource = 'device'
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

const acknowledgeTerminal = (res) => res.status(200).end()

async function saveDeviceResult(device, deviceEvent, startedAt) {
  // Attendance-only: Contabo terminalga hech qanday eshik buyrug‘i yubormaydi.
  deviceEvent.doorAttempted = false
  deviceEvent.doorOpened = false
  deviceEvent.error = ''
  deviceEvent.processingMs = Date.now() - startedAt
  await deviceEvent.save()
  await FaceDevice.updateOne(
    { _id: device._id },
    { $set: { lastSeenAt: new Date(), lastEventAt: deviceEvent.occurredAt, lastError: '' } },
  )
}

class FaceDeviceController {
  handleEvent = async (req, res, next, device) => {
    const startedAt = Date.now()
    try {
      const payload = extractHikvisionEvent(req)
      await FaceDevice.updateOne({ _id: device._id }, { $set: { lastSeenAt: new Date() } })
      if (isHeartbeatEvent(payload) || !payload.faceCode) return acknowledgeTerminal(res)

      const occurredAt = new Date(payload.dateTime)
      if (Number.isNaN(occurredAt.getTime())) return ApiResponse.badRequest(res, 'Hikvision dateTime noto‘g‘ri')
      const age = Date.now() - occurredAt.getTime()
      if (age > 48 * 60 * 60 * 1000 || age < -5 * 60 * 1000) return acknowledgeTerminal(res)

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
        return acknowledgeTerminal(res)
      }

      const employee = await Employee.findOne({ faceIdCode: faceCode, isActive: true, faceAccessEnabled: true })
      if (employee) {
        deviceEvent.personType = 'employee'
        deviceEvent.personId = employee._id
        const attendanceSettings = await getEmployeeAttendanceSettings()
        if (!attendanceSettings.enabled) {
          deviceEvent.accessDecision = 'granted'
          await saveDeviceResult(device, deviceEvent, startedAt)
          return acknowledgeTerminal(res)
        }
        const attendance = await recordEmployeeAttendance(employee, device, occurredAt, deviceEvent, attendanceSettings.schedule)
        deviceEvent.accessDecision = 'granted'
        await saveDeviceResult(device, deviceEvent, startedAt)
        req.app.get('io')?.emit('employee-attendance:changed', { employeeId: employee.id, date: attendance.date, action: attendance.action })
        return acknowledgeTerminal(res)
      }

      const student = await Student.findOne({ faceIdCode: faceCode })
      const direction = student
        ? await previewStudentDirection(student._id, device.direction, occurredAt)
        : device.direction
      const access = await evaluateStudentFaceAccess({
        faceIdCode: faceCode,
        eventId,
        occurredAt: occurredAt.toISOString(),
        deviceKey: device.deviceKey,
        direction,
      }, { io: req.app.get('io'), student })
      deviceEvent.personType = access.studentId ? 'student' : 'unknown'
      deviceEvent.personId = access.studentId || null
      deviceEvent.accessDecision = access.decision
      if (access.studentId) {
        const movement = await recordStudentMovement({
          studentId: access.studentId,
          eventId,
          configuredDirection: direction,
          occurredAt,
          deviceId: device._id,
          deviceEventId: deviceEvent._id,
          faceAccessEventId: access.accessEventId,
        })
        deviceEvent.studentMovement = movement._id
        req.app.get('io')?.emit('student-presence:changed', {
          studentId: access.studentId,
          direction: movement.direction,
          transition: movement.transition,
          occurredAt,
        })
      }
      await saveDeviceResult(device, deviceEvent, startedAt)
      return acknowledgeTerminal(res)
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
      const device = await FaceDevice.create({
        name: String(req.body.name || '').trim(),
        model: req.body.model || 'DS-K1T341CMF',
        transport: 'http_listening',
        host: '',
        doorNo: Number(req.body.doorNo || 1),
        direction: ['IN', 'OUT', 'BOTH'].includes(req.body.direction) ? req.body.direction : 'IN',
        controlMode: 'attendance_only',
        doorControlEnabled: false,
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
      const fields = ['name', 'model', 'doorNo', 'direction', 'isActive', 'locationDescription']
      for (const field of fields) if (req.body[field] !== undefined) device[field] = req.body[field]
      device.transport = 'http_listening'
      device.host = ''
      device.isupDeviceId = undefined
      device.controlMode = 'attendance_only'
      device.doorControlEnabled = false
      await device.save()
      return ApiResponse.ok(res, { device }, 'FaceID qurilma yangilandi')
    } catch (error) { return next(error) }
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
