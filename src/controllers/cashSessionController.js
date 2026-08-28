import mongoose from 'mongoose'
import { CashSession } from '../models/CashSession.js'
import { Notification } from '../models/Notification.js'
import { Payment } from '../models/Payment.js'
import { ApiResponse } from '../utils/response.js'

const methods = ['cash', 'card', 'online', 'bank']
const emptyBreakdown = () => ({ cash: 0, card: 0, online: 0, bank: 0 })
const totalBreakdown = (breakdown) => methods.reduce((sum, method) => sum + Number(breakdown?.[method] || 0), 0)

const sumPaymentsByMethod = async (match) => {
  const rows = await Payment.aggregate([
    { $match: { ...match, cancelledAt: null } },
    { $group: { _id: '$method', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
  ])
  const breakdown = emptyBreakdown()
  let count = 0
  rows.forEach((row) => { if (methods.includes(row._id)) breakdown[row._id] = row.amount; count += row.count })
  return { breakdown, amount: totalBreakdown(breakdown), count }
}

const transferredBreakdown = async (sourceSession) => {
  const transfers = await CashSession.find({ sourceSession, status: { $in: ['pending', 'approved'] } }).select('breakdown').lean()
  return transfers.reduce((result, transfer) => {
    methods.forEach((method) => { result[method] += Number(transfer.breakdown?.[method] || 0) })
    return result
  }, emptyBreakdown())
}

const openSessionBalance = async (session) => {
  if (!session) return { breakdown: emptyBreakdown(), balance: 0, paymentCount: 0 }
  const payments = await sumPaymentsByMethod({ cashSession: session._id, $or: [{ fundHolder: 'cashier' }, { fundHolder: { $exists: false } }] })
  const transferred = await transferredBreakdown(session._id)
  const breakdown = emptyBreakdown()
  methods.forEach((method) => { breakdown[method] = Math.max(0, payments.breakdown[method] - transferred[method]) })
  return { breakdown, balance: totalBreakdown(breakdown), paymentCount: payments.count }
}

class CashSessionController {
  emit(req, action, session) {
    req.app.get('io')?.emit('cash-sessions:changed', { action, sessionId: session?.id || session?._id?.toString() })
  }

  list = async (req, res, next) => {
    try {
      if (req.employee.role === 'cashier') {
        const openSession = await CashSession.findOne({ cashier: req.employee._id, status: 'open' })
        const open = await openSessionBalance(openSession)
        const sessions = await CashSession.find({ cashier: req.employee._id, status: { $ne: 'open' } })
          .populate('reviewedBy', 'firstname lastname').sort({ closedAt: -1 }).limit(30)
        const pendingAmount = sessions.filter((item) => item.status === 'pending').reduce((sum, item) => sum + item.expectedAmount, 0)
        return ApiResponse.ok(res, { role: 'cashier', open: { id: openSession?.id || null, ...open }, pendingAmount, sessions })
      }

      if (!['owner', 'admin'].includes(req.employee.role)) return ApiResponse.forbidden(res, 'Kassa faqat kassir va owner uchun ochiq')
      const [pendingSessions, recentSessions, organizationPayments, approvedTransfers, openSessions] = await Promise.all([
        CashSession.find({ status: 'pending' }).populate('cashier', 'firstname lastname position').sort({ closedAt: 1 }),
        CashSession.find({ status: { $in: ['approved', 'rejected'] } }).populate('cashier', 'firstname lastname position').populate('reviewedBy', 'firstname lastname').sort({ reviewedAt: -1 }).limit(30),
        sumPaymentsByMethod({ $or: [{ fundHolder: 'organization' }, { fundHolder: { $exists: false }, cashSession: null }] }),
        CashSession.find({ status: 'approved' }).select('sourceSession breakdown expectedAmount').lean(),
        CashSession.find({ status: 'open' }).populate('cashier', 'firstname lastname position'),
      ])
      const pendingAmount = pendingSessions.reduce((sum, item) => sum + item.expectedAmount, 0)
      const centralBreakdown = { ...organizationPayments.breakdown }
      approvedTransfers.forEach((transfer) => {
        if (!transfer.sourceSession) centralBreakdown.cash += Number(transfer.expectedAmount || 0)
        else methods.forEach((method) => { centralBreakdown[method] += Number(transfer.breakdown?.[method] || 0) })
      })
      const cashierBalances = (await Promise.all(openSessions.map(async (session) => ({ sessionId: session.id, cashier: session.cashier, ...(await openSessionBalance(session)) })))).filter((item) => item.balance > 0)
      return ApiResponse.ok(res, {
        role: req.employee.role,
        summary: { centralCash: totalBreakdown(centralBreakdown), breakdown: centralBreakdown, pendingAmount, pendingCount: pendingSessions.length, cashierAmount: cashierBalances.reduce((sum, item) => sum + item.balance, 0) },
        cashierBalances,
        pendingSessions,
        recentSessions,
      })
    } catch (error) { return next(error) }
  }

  close = async (req, res, next) => {
    try {
      if (req.employee.role !== 'cashier') return ApiResponse.forbidden(res, 'Kassani faqat kassir yopadi')
      const session = await CashSession.findOne({ cashier: req.employee._id, status: 'open' })
      if (!session) return ApiResponse.badRequest(res, 'Topshirish uchun kassada mablag‘ yo‘q')
      const available = await openSessionBalance(session)
      const breakdown = emptyBreakdown()
      for (const method of methods) {
        const amount = Number(req.body.breakdown?.[method] || 0)
        if (!Number.isFinite(amount) || amount < 0) return ApiResponse.badRequest(res, 'Topshiriladigan summalarni to‘g‘ri kiriting')
        if (amount > available.breakdown[method]) return ApiResponse.badRequest(res, `${method} bo‘yicha maksimal summa: ${available.breakdown[method].toLocaleString('uz-UZ')} so‘m`)
        breakdown[method] = amount
      }
      if (methods.filter((method) => breakdown[method] > 0).length !== 1) return ApiResponse.badRequest(res, 'Bir topshirishda faqat bitta to‘lov turini tanlang')
      const expectedAmount = totalBreakdown(breakdown)
      if (expectedAmount <= 0) return ApiResponse.badRequest(res, 'Topshiriladigan summani kiriting')
      const transfer = await CashSession.create({ cashier: req.employee._id, sourceSession: session._id, status: 'pending', expectedAmount, paymentCount: available.paymentCount, breakdown, closedAt: new Date(), note: String(req.body.note || '').trim() })
      const cashierName = `${req.employee.firstname} ${req.employee.lastname}`.trim()
      await Notification.create({
        eventKey: `cash-session:${transfer.id}`,
        type: 'cash_session', title: 'Kassa topshirildi',
        message: `${cashierName} ${expectedAmount.toLocaleString('uz-UZ')} so‘mni tasdiqlashga yubordi`,
        count: 1, targetPath: '/cash', targetRoles: ['owner', 'admin'],
      })
      this.emit(req, 'closed', transfer)
      req.app.get('io')?.emit('notifications:changed', { type: 'cash_session' })
      return ApiResponse.ok(res, { session: transfer }, 'Mablag‘ owner tasdig‘iga yuborildi')
    } catch (error) { return next(error) }
  }

  approve = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Kassa topilmadi')
      const session = await CashSession.findOne({ _id: req.params.id, status: 'pending' })
      if (!session) return ApiResponse.notFound(res, 'Tasdiqlanadigan kassa topilmadi')
      const receivedAmount = Number(req.body.receivedAmount)
      if (!Number.isFinite(receivedAmount) || receivedAmount < 0) return ApiResponse.badRequest(res, 'Olingan pul miqdorini kiriting')
      if (receivedAmount !== session.expectedAmount) {
        const difference = receivedAmount - session.expectedAmount
        return ApiResponse.badRequest(res, `Kassada ${Math.abs(difference).toLocaleString('uz-UZ')} so‘m ${difference < 0 ? 'kam' : 'ortiqcha'} chiqdi`)
      }
      session.status = 'approved'; session.receivedAmount = receivedAmount; session.reviewedAt = new Date()
      session.reviewedBy = req.employee._id; session.reviewNote = String(req.body.reviewNote || '').trim()
      await session.save(); this.emit(req, 'approved', session)
      return ApiResponse.ok(res, { session }, 'Kassa qabul qilindi va markaziy kassaga o‘tkazildi')
    } catch (error) { return next(error) }
  }
}

export const cashSessionController = new CashSessionController()
