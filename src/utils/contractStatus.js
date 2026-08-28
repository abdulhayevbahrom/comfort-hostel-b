import { StudentContract } from '../models/StudentContract.js'
import { Notification } from '../models/Notification.js'
import { DebtorDeadline } from '../models/DebtorDeadline.js'
import { ContractInstallment } from '../models/ContractInstallment.js'

export async function createDebtorDeadlineNotification(io) {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const deadlines = await DebtorDeadline.find({ deadline: { $gte: todayStart, $lt: tomorrowStart } }).select('student periodKey').lean()
  if (!deadlines.length) return
  const dueStudentIds = new Set()
  for (const item of deadlines) {
    const hasDebt = await ContractInstallment.exists({ student: item.student, periodKey: item.periodKey, $expr: { $lt: ['$paidAmount', '$amount'] } })
    if (hasDebt) dueStudentIds.add(item.student.toString())
  }
  const count = dueStudentIds.size
  if (!count) return
  const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const result = await Notification.updateOne(
    { eventKey: `debtor-deadline:${dateKey}` },
    { $setOnInsert: { type: 'debtor_deadline', title: 'To‘lov deadline’i keldi', message: `${count} nafar qarzdor talabaning to‘lov deadline’i bugun`, count, targetPath: '/debtors', targetRoles: ['owner', 'admin'] } },
    { upsert: true },
  )
  if (result.upsertedCount) io.emit('notifications:changed', { action: 'created', type: 'debtor_deadline', occurredAt: new Date().toISOString() })
}

export async function createContractExpiryNotification(io) {
  const now = new Date()
  const targetStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const targetEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3)
  const count = await StudentContract.countDocuments({ status: 'active', endDate: { $gte: targetStart, $lt: targetEnd } })
  if (!count) return
  const notificationKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const result = await Notification.updateOne(
    { eventKey: `contract-expiry:${notificationKey}` },
    { $setOnInsert: { type: 'contract_expiry', title: 'Shartnoma muddati tugamoqda', message: `${count} nafar talabaning shartnomasi tugashiga 2 kun yoki undan kam qoldi`, count, targetPath: '/contracts' } },
    { upsert: true },
  )
  if (result.upsertedCount) io.emit('notifications:changed', { action: 'created', occurredAt: new Date().toISOString() })
}

export async function syncContractStatuses({ includeToday = false } = {}) {
  const now = new Date()
  const threshold = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (includeToday ? 1 : 0))
  const [completed, restored] = await Promise.all([
    StudentContract.updateMany({ status: 'active', endDate: { $lt: threshold } }, { $set: { status: 'completed' } }),
    StudentContract.updateMany({ status: 'completed', endDate: { $gte: threshold }, cancelledAt: null }, { $set: { status: 'active' } }),
  ])
  return { changed: (completed.modifiedCount || 0) + (restored.modifiedCount || 0) }
}

export function scheduleDailyContractSync(io) {
  const scheduleNext = () => {
    const now = new Date()
    const next = new Date(now)
    next.setHours(23, 55, 0, 0)
    if (next <= now) next.setDate(next.getDate() + 1)
    setTimeout(async () => {
      try {
        const result = await syncContractStatuses({ includeToday: true })
        if (result.changed) io.emit('student-contracts:changed', { action: 'statuses-synced', occurredAt: new Date().toISOString() })
        await createContractExpiryNotification(io)
        await createDebtorDeadlineNotification(io)
      } catch (error) { console.error(`Shartnoma statuslarini yangilashda xatolik: ${error.message}`) }
      scheduleNext()
    }, next.getTime() - now.getTime())
  }
  scheduleNext()
}
