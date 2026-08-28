import mongoose from 'mongoose'
import { ContractInstallment } from '../models/ContractInstallment.js'
import { Payment } from '../models/Payment.js'
import { DebtorDeadline } from '../models/DebtorDeadline.js'
import { DebtorSms } from '../models/DebtorSms.js'
import { GeneralSetting } from '../models/GeneralSetting.js'
import { ApiResponse } from '../utils/response.js'
import { renderDebtorSms, sendTextUpSms } from '../utils/textup.js'

const uzbekMonths = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']

function formatSmsPeriod(periodKey) {
  const month = Number(String(periodKey).slice(5, 7))
  return `${uzbekMonths[month - 1] || periodKey} oyi`
}

class DebtorController {
  list = async (req, res, next) => {
    try {
      const now = new Date()
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
      const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      const requestedPeriod = /^\d{4}-\d{2}$/.test(String(req.query.period || '')) ? String(req.query.period) : currentKey
      const isFuturePeriod = requestedPeriod > currentKey
      const allInstallments = await ContractInstallment.find({ periodKey: requestedPeriod })
        .populate({ path: 'student', select: 'fullName phone parentPhone photo university faculty course', populate: [{ path: 'university', select: 'name' }, { path: 'faculty', select: 'name' }] })
        .populate({ path: 'contract', select: 'contractNumber status room startDate endDate paymentType', populate: { path: 'room', select: 'roomNumber block floor' } })
        .sort({ dueDate: 1 })
      const installments = allInstallments.filter((item) => item.paidAmount < item.amount)

      const deadlines = await DebtorDeadline.find({ periodKey: requestedPeriod, student: { $in: installments.map((item) => item.student?._id).filter(Boolean) } }).populate('setBy', 'firstname lastname role')
      const deadlinesByStudent = new Map(deadlines.map((item) => [item.student.toString(), item]))

      const smsRows = await DebtorSms.aggregate([
        { $match: { periodKey: requestedPeriod } },
        { $group: { _id: '$student', count: { $sum: 1 }, lastSentAt: { $max: '$createdAt' } } },
      ])
      const smsByStudent = new Map(smsRows.map((item) => [item._id.toString(), { count: item.count, lastSentAt: item.lastSentAt }]))

      const studentIds = [...new Set(installments.map((item) => item.student?._id?.toString()).filter(Boolean))]
      const paymentRows = await Payment.find({ student: { $in: studentIds.map((id) => new mongoose.Types.ObjectId(id)) } })
        .select('student contract amount method note allocations createdAt')
        .populate('contract', 'contractNumber')
        .populate('allocations.installment', 'periodKey')
        .sort({ createdAt: -1 })
      const paymentsByStudent = new Map()
      paymentRows.forEach((payment) => { const key = payment.student.toString(); if (!paymentsByStudent.has(key)) paymentsByStudent.set(key, []); paymentsByStudent.get(key).push(payment) })
      const grouped = new Map()
      for (const item of installments) {
        if (!item.student || !item.contract) continue
        const key = item.student._id.toString()
        if (!grouped.has(key)) grouped.set(key, { student: item.student, contracts: new Map(), periods: [], totalDebt: 0, waitingAmount: 0, overdueDebt: 0, currentDebt: 0, paidTowardsDebt: 0 })
        const debtor = grouped.get(key)
        const debt = Math.max(0, item.amount - item.paidAmount)
        const isUpcoming = new Date(item.dueDate) > todayEnd
        debtor.periods.push({ id: item.id, contractId: item.contract.id, contractNumber: item.contract.contractNumber, periodKey: item.periodKey, dueDate: item.dueDate, amount: item.amount, paidAmount: item.paidAmount, debt, status: item.status, isUpcoming, room: item.contract.room })
        debtor.contracts.set(item.contract.id, item.contract)
        if (isUpcoming) debtor.waitingAmount += debt
        else debtor.totalDebt += debt
        debtor.paidTowardsDebt += item.paidAmount
        if (!isUpcoming && item.periodKey < currentKey) debtor.overdueDebt += debt
        else if (!isUpcoming) debtor.currentDebt += debt
      }
      const debtors = [...grouped.values()].filter((item) => isFuturePeriod ? item.waitingAmount > 0 : item.totalDebt > 0).map((item) => {
        const paymentHistory = paymentsByStudent.get(item.student.id) || []
        const lastPayment = paymentHistory[0]
        const deadline = deadlinesByStudent.get(item.student.id)
        const sms = smsByStudent.get(item.student.id) || { count: 0, lastSentAt: null }
        return { ...item, contracts: [...item.contracts.values()], periodCount: item.periods.length, oldestDueDate: item.periods[0]?.dueDate, lastPaymentAt: lastPayment?.createdAt || null, lastPaymentAmount: lastPayment?.amount || 0, paymentHistory, debtStatus: item.paidTowardsDebt > 0 ? 'partial' : 'unpaid', paymentDeadline: deadline?.deadline || null, deadlineSetBy: deadline?.setBy || null, isDeadlineReached: Boolean(deadline && new Date(deadline.deadline) <= todayEnd), smsSentCount: sms.count, lastSmsSentAt: sms.lastSentAt }
      }).sort((a, b) => b.totalDebt - a.totalDebt)
      const scheduledAmount = allInstallments.reduce((sum, item) => sum + item.amount, 0)
      const paidAmount = allInstallments.reduce((sum, item) => sum + item.paidAmount, 0)
      const outstanding = debtors.reduce((sum, item) => sum + item.totalDebt, 0)
      const waitingAmount = [...grouped.values()].reduce((sum, item) => sum + item.waitingAmount, 0)
      const paidByStudent = new Map()
      allInstallments.forEach((item) => { if (item.student) paidByStudent.set(item.student.id, (paidByStudent.get(item.student.id) || 0) + item.paidAmount) })
      const paidStudentCount = [...paidByStudent.values()].filter((amount) => amount > 0).length
      const noPaymentStudentCount = [...paidByStudent.values()].filter((amount) => amount <= 0).length
      const summary = { debtorCount: isFuturePeriod ? 0 : debtors.length, waitingCount: isFuturePeriod ? debtors.length : 0, totalDebt: isFuturePeriod ? 0 : outstanding, waitingAmount, scheduledAmount, paidAmount, paidStudentCount, noPaymentStudentCount, overdueDebt: debtors.reduce((sum, item) => sum + item.overdueDebt, 0), partialCount: debtors.filter((item) => item.debtStatus === 'partial').length, unpaidCount: debtors.filter((item) => item.debtStatus === 'unpaid').length }
      return ApiResponse.ok(res, { debtors, summary, selectedPeriod: requestedPeriod, currentPeriod: currentKey, isFuturePeriod })
    } catch (error) { return next(error) }
  }

  setDeadline = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.studentId)) return ApiResponse.notFound(res, 'Talaba topilmadi')
      const periodKey = String(req.body.periodKey || '')
      if (!/^\d{4}-\d{2}$/.test(periodKey)) return ApiResponse.badRequest(res, 'Qarzdorlik oyini tanlang')
      const deadline = new Date(`${req.body.deadline}T23:59:59.999`)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.body.deadline || '')) || Number.isNaN(deadline.getTime())) return ApiResponse.badRequest(res, 'Deadline sanasini kiriting')
      const hasDebt = await ContractInstallment.exists({ student: req.params.studentId, periodKey, $expr: { $lt: ['$paidAmount', '$amount'] } })
      if (!hasDebt) return ApiResponse.badRequest(res, 'Tanlangan oy uchun qarzdorlik topilmadi')
      const saved = await DebtorDeadline.findOneAndUpdate(
        { student: req.params.studentId, periodKey },
        { deadline, setBy: req.employee._id },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).populate('setBy', 'firstname lastname role')
      req.app.get('io')?.emit('debtors:changed', { action: 'deadline-updated', studentId: req.params.studentId, periodKey })
      return ApiResponse.ok(res, { deadline: saved }, 'To‘lov deadline’i saqlandi')
    } catch (error) { return next(error) }
  }

  sendSms = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.studentId)) return ApiResponse.notFound(res, 'Talaba topilmadi')
      const periodKey = String(req.body.periodKey || '')
      if (!/^\d{4}-\d{2}$/.test(periodKey)) return ApiResponse.badRequest(res, 'Qarzdorlik oyini tanlang')
      const installments = await ContractInstallment.find({ student: req.params.studentId, periodKey, $expr: { $lt: ['$paidAmount', '$amount'] } }).populate('student', 'fullName phone')
      if (!installments.length) return ApiResponse.badRequest(res, 'Tanlangan oy uchun qarzdorlik topilmadi')
      const sentCount = await DebtorSms.countDocuments({
        student: req.params.studentId,
        periodKey,
        $or: [{ source: 'manual' }, { source: { $exists: false } }],
      })
      if (sentCount >= 3) return ApiResponse.badRequest(res, 'Bu talabaga ushbu oy uchun SMS 3 marta yuborilgan')
      const student = installments[0].student
      const debtAmount = installments.reduce((sum, item) => sum + Math.max(0, item.amount - item.paidAmount), 0)
      const settings = await GeneralSetting.findOneAndUpdate({ key: 'general' }, { $setOnInsert: { key: 'general' } }, { new: true, upsert: true, setDefaultsOnInsert: true })
      const content = renderDebtorSms(settings.debtorSmsTemplate, { studentName: student.fullName, debtAmount: Number(debtAmount).toLocaleString('uz-UZ'), period: formatSmsPeriod(periodKey), hostelName: settings.hostelName })
      if (!content.trim()) return ApiResponse.badRequest(res, 'SMS matni sozlamalarda kiritilmagan')
      const destination = await sendTextUpSms({ destination: student.phone, content })
      const sms = await DebtorSms.create({ student: student._id, periodKey, destination, content, sentBy: req.employee._id, source: 'manual' })
      req.app.get('io')?.emit('debtors:changed', { action: 'sms-sent', studentId: req.params.studentId, periodKey })
      return ApiResponse.ok(res, { sms, sentCount: sentCount + 1 }, 'Qarzdorlik SMSi yuborildi')
    } catch (error) { return next(error) }
  }
}

export const debtorController = new DebtorController()
