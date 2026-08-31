import { EmployeeAttendance } from '../models/EmployeeAttendance.js'
import { FaceDevice } from '../models/FaceDevice.js'
import { GeneralSetting } from '../models/GeneralSetting.js'
import { shiftCrossesMidnight } from './faceTime.js'

export const DEFAULT_EMPLOYEE_SCHEDULE = Object.freeze({
  checkInTime: '09:00',
  checkOutTime: '18:00',
  workDays: [1, 2, 3, 4, 5, 6],
  lateAfterMinutes: 0,
  earlyLeaveMinutes: 0,
  useTimePenalty: false,
  penaltyPerMinute: 0,
  penaltyStartDate: new Date().toISOString().slice(0, 10),
})

export function normalizeEmployeeSchedule(schedule = {}) {
  const workDays = Array.isArray(schedule.workDays)
    ? [...new Set(schedule.workDays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b)
    : DEFAULT_EMPLOYEE_SCHEDULE.workDays
  return {
    checkInTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.checkInTime || '') ? schedule.checkInTime : DEFAULT_EMPLOYEE_SCHEDULE.checkInTime,
    checkOutTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.checkOutTime || '') ? schedule.checkOutTime : DEFAULT_EMPLOYEE_SCHEDULE.checkOutTime,
    workDays: workDays.length ? workDays : DEFAULT_EMPLOYEE_SCHEDULE.workDays,
    lateAfterMinutes: Math.max(0, Number(schedule.lateAfterMinutes || 0)),
    earlyLeaveMinutes: Math.max(0, Number(schedule.earlyLeaveMinutes || 0)),
    useTimePenalty: schedule.useTimePenalty === true,
    penaltyPerMinute: Math.max(0, Number(schedule.penaltyPerMinute || 0)),
    penaltyStartDate: /^\d{4}-\d{2}-\d{2}$/.test(schedule.penaltyStartDate || '') ? schedule.penaltyStartDate : DEFAULT_EMPLOYEE_SCHEDULE.penaltyStartDate,
  }
}

export async function getEmployeeAttendanceSettings() {
  const settings = await GeneralSetting.findOneAndUpdate(
    { key: 'general' },
    { $setOnInsert: { key: 'general' } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )
  return {
    enabled: settings.employeeFaceAttendanceEnabled !== false,
    schedule: normalizeEmployeeSchedule(settings.employeeWorkSchedule?.toObject?.() || settings.employeeWorkSchedule || {}),
  }
}

function scheduledExitAt(date, schedule) {
  const result = new Date(`${date}T${schedule.checkOutTime}:00+05:00`)
  if (shiftCrossesMidnight(schedule)) result.setUTCDate(result.getUTCDate() + 1)
  return result
}

export async function reconcileScheduledEmployeeExits(schedule, now = new Date()) {
  const hasOutDevice = Boolean(await FaceDevice.exists({ isActive: true, direction: { $in: ['OUT', 'BOTH'] } }))
  if (hasOutDevice) return { hasOutDevice, updated: 0 }
  const records = await EmployeeAttendance.find({ currentEntry: { $ne: null } })
  let updated = 0
  for (const attendance of records) {
    const plannedExit = scheduledExitAt(attendance.date, schedule)
    if (plannedExit > now) continue
    attendance.totalHours += Math.max(0, plannedExit - attendance.currentEntry) / 3_600_000
    attendance.lastExit = plannedExit
    attendance.currentEntry = null
    attendance.exitSource = 'schedule'
    await attendance.save()
    updated += 1
  }
  return { hasOutDevice, updated }
}

export function scheduleEmployeeExitReconciliation() {
  const run = async () => {
    try {
      const { enabled, schedule } = await getEmployeeAttendanceSettings()
      if (enabled) await reconcileScheduledEmployeeExits(schedule)
    } catch (error) {
      console.error(`Xodimlarning avtomatik chiqish vaqti yangilanmadi: ${error.message}`)
    }
  }
  const timer = setInterval(run, 60_000)
  timer.unref?.()
  run()
  return () => clearInterval(timer)
}
