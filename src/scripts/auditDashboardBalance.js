import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDatabase } from '../config/db.js'
import { CashSession } from '../models/CashSession.js'
import { Employee } from '../models/Employee.js'
import { Expense } from '../models/Expense.js'
import { FinePayment } from '../models/FinePayment.js'
import { Payment } from '../models/Payment.js'
import { SalaryPayment } from '../models/SalaryPayment.js'
import { Student } from '../models/Student.js'

const startKey = process.argv[2] || new Date().toISOString().slice(0, 7) + '-01'
const endKey = process.argv[3] || new Date().toISOString().slice(0, 10)
const start = new Date(`${startKey}T00:00:00`)
const end = new Date(`${endKey}T00:00:00`)
end.setDate(end.getDate() + 1)

const sum = async (Model, match, field = 'amount') => {
  const [row] = await Model.aggregate([
    { $match: match },
    { $group: { _id: null, amount: { $sum: `$${field}` }, count: { $sum: 1 } } },
  ])
  return row || { amount: 0, count: 0 }
}

try {
  await connectDatabase()
  const directPaymentFilter = { $or: [{ cashSession: null }, { cashSession: { $exists: false } }] }
  const [payments, fines, transfers, deposits, expenses, salaries, returnedDeposits] = await Promise.all([
    sum(Payment, { ...directPaymentFilter, createdAt: { $gte: start, $lt: end } }),
    sum(FinePayment, { createdAt: { $gte: start, $lt: end } }),
    sum(CashSession, { status: 'approved', $or: [{ transferStage: 'head_to_owner' }, { transferStage: null }], reviewedAt: { $gte: start, $lt: end } }, 'receivedAmount'),
    Student.aggregate([{ $unwind: '$depositPayments' }, { $match: { 'depositPayments.paidAt': { $gte: start, $lt: end }, $or: [{ 'depositPayments.cashSession': null }, { 'depositPayments.cashSession': { $exists: false } }] } }, { $group: { _id: null, amount: { $sum: '$depositPayments.amount' }, count: { $sum: 1 } } }]).then(([row]) => row || { amount: 0, count: 0 }),
    sum(Expense, { createdAt: { $gte: start, $lt: end } }),
    sum(SalaryPayment, { createdAt: { $gte: start, $lt: end } }),
    Student.aggregate([{ $match: { depositType: 'money', depositReturnedAt: { $gte: start, $lt: end } } }, { $unwind: '$depositPayments' }, { $group: { _id: null, amount: { $sum: '$depositPayments.amount' }, count: { $sum: 1 } } }]).then(([row]) => row || { amount: 0, count: 0 }),
  ])
  const income = Number(payments.amount) + Number(fines.amount) + Number(transfers.amount) + Number(deposits.amount)
  const outflow = Number(expenses.amount) + Number(salaries.amount) + Number(returnedDeposits.amount)
  const [transferDetails, depositStudents] = await Promise.all([
    CashSession.find({ status: 'approved', $or: [{ transferStage: 'head_to_owner' }, { transferStage: null }], reviewedAt: { $gte: start, $lt: end } }).populate('cashier', 'firstname lastname position').select('cashier sourceSession destinationSession transferStage expectedAmount receivedAmount reviewedAt breakdown').lean(),
    Student.find({ 'depositPayments.paidAt': { $gte: start, $lt: end } }).select('fullName depositPayments').populate('depositPayments.receivedBy', 'firstname lastname position').lean(),
  ])
  const directDepositDetails = depositStudents.flatMap((student) => (student.depositPayments || []).filter((payment) => payment.paidAt >= start && payment.paidAt < end && !payment.cashSession).map((payment) => ({ student: student.fullName, amount: payment.amount, method: payment.method, paidAt: payment.paidAt, receivedBy: payment.receivedBy ? `${payment.receivedBy.firstname} ${payment.receivedBy.lastname}` : '—' })))
  const headSessionIds = transferDetails.map((item) => item.sourceSession).filter(Boolean)
  const incomingToHead = headSessionIds.length
    ? await CashSession.find({ destinationSession: { $in: headSessionIds } }).populate('cashier', 'firstname lastname position').select('cashier sourceSession destinationSession transferStage receivedAmount breakdown reviewedAt').lean()
    : []
  const sourceSessionIds = [...headSessionIds, ...incomingToHead.map((item) => item.sourceSession).filter(Boolean)]
  const [sessionPayments, sessionDeposits] = await Promise.all([
    sourceSessionIds.length ? Payment.find({ cashSession: { $in: sourceSessionIds } }).select('amount method paidAt cashSession').lean() : [],
    sourceSessionIds.length ? Student.find({ 'depositPayments.cashSession': { $in: sourceSessionIds } }).select('fullName depositPayments').lean() : [],
  ])
  const sessionDepositDetails = sessionDeposits.flatMap((student) => (student.depositPayments || []).filter((payment) => payment.cashSession && sourceSessionIds.some((id) => id.equals(payment.cashSession))).map((payment) => ({ student: student.fullName, amount: payment.amount, method: payment.method, paidAt: payment.paidAt, cashSession: payment.cashSession })))
  console.log(JSON.stringify({ period: `${startKey} — ${endKey}`, payments, fines, ownerApprovedCashTransfers: transfers, directDeposits: deposits, expenses, salaries, returnedDeposits, income, outflow, balance: income - outflow, transferDetails: transferDetails.map((item) => ({ cashier: item.cashier ? `${item.cashier.firstname} ${item.cashier.lastname}` : '—', sourceSession: item.sourceSession, stage: item.transferStage || 'oldingi oqim', amount: item.receivedAmount, reviewedAt: item.reviewedAt, breakdown: item.breakdown })), cashierToHeadTransfers: incomingToHead.map((item) => ({ cashier: item.cashier ? `${item.cashier.firstname} ${item.cashier.lastname}` : '—', sourceSession: item.sourceSession, destinationSession: item.destinationSession, amount: item.receivedAmount, reviewedAt: item.reviewedAt, breakdown: item.breakdown })), sourceSessionPayments: sessionPayments, sourceSessionDeposits: sessionDepositDetails, directDepositDetails }, null, 2))
} finally {
  await mongoose.disconnect()
}
