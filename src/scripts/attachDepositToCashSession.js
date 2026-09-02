import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDatabase } from '../config/db.js'
import { CashSession } from '../models/CashSession.js'
import { Employee } from '../models/Employee.js'
import { Student } from '../models/Student.js'

const apply = process.argv.includes('--apply')
const nameIndex = process.argv.indexOf('--student')
const studentName = nameIndex >= 0 ? String(process.argv[nameIndex + 1] || '').trim() : ''

if (!studentName) throw new Error('Talabani --student "F.I.Sh." bilan kiriting')

try {
  await connectDatabase()
  const student = await Student.findOne({ fullName: { $regex: `^${studentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } })
  if (!student) throw new Error('Talaba topilmadi')

  const orphanPayments = (student.depositPayments || []).filter((payment) => !payment.cashSession && payment.amount > 0)
  const orphanAmount = orphanPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  if (!orphanPayments.length) throw new Error('Bog‘lanmagan depozit to‘lovi yo‘q')

  const candidates = await CashSession.find({ status: 'approved', transferStage: 'head_to_owner' })
    .populate('cashier', 'role firstname lastname')
    .select('cashier sourceSession receivedAmount reviewedAt')
    .lean()
  const bySource = new Map()
  candidates.forEach((transfer) => {
    if (!transfer.sourceSession || transfer.cashier?.role !== 'head_cashier') return
    const key = transfer.sourceSession.toString()
    const current = bySource.get(key) || { amount: 0, cashier: transfer.cashier, sessionId: transfer.sourceSession }
    current.amount += Number(transfer.receivedAmount || 0)
    bySource.set(key, current)
  })
  const target = [...bySource.values()].find((item) => item.amount === orphanAmount)
  if (!target) throw new Error(`Depozit (${orphanAmount.toLocaleString('uz-UZ')} so‘m) bilan teng owner-tasdiqlagan bosh kassir o‘tkazmasi topilmadi`)

  const summary = {
    student: student.fullName,
    amount: orphanAmount,
    parts: orphanPayments.map((payment) => ({ id: payment._id, method: payment.method, amount: payment.amount, paidAt: payment.paidAt })),
    targetSession: target.sessionId,
    receivedBy: `${target.cashier.firstname} ${target.cashier.lastname}`,
    applied: apply,
  }
  if (apply) {
    for (const payment of orphanPayments) {
      await Student.updateOne(
        { _id: student._id, 'depositPayments._id': payment._id },
        { $set: { 'depositPayments.$.cashSession': target.sessionId, 'depositPayments.$.receivedBy': target.cashier._id } },
      )
    }
  }
  console.log(JSON.stringify(summary, null, 2))
} finally {
  await mongoose.disconnect()
}
