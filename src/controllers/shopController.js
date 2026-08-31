import mongoose from 'mongoose'
import { SalaryPayment } from '../models/SalaryPayment.js'
import { ShopTransaction } from '../models/ShopTransaction.js'
import { ApiResponse } from '../utils/response.js'
import { dateKeyInTimeZone } from '../utils/faceTime.js'
import { calculateShopBalance, shopPeriodRange } from '../utils/shopFinance.js'

const paymentTypes = ['cash', 'card', 'click', 'bank']
const periodPattern = /^\d{4}-(0[1-9]|1[0-2])$/

class ShopController {
  emitChange(req, action, transaction) {
    req.app.get('io')?.emit('shop:changed', { action, transactionId: transaction?.id || transaction?._id?.toString(), occurredAt: new Date().toISOString() })
  }

  overview = async (req, res, next) => {
    try {
      const fallback = dateKeyInTimeZone(new Date()).slice(0, 7)
      const period = periodPattern.test(String(req.query.period || '')) ? String(req.query.period) : fallback
      const { start, end } = shopPeriodRange(period)
      const [allIncomeRows, allExpenseRows, allSalaryRows, monthIncomeRows, monthExpenseRows, monthSalaryRows, categories] = await Promise.all([
        ShopTransaction.aggregate([{ $match: { type: 'income' } }, { $group: { _id: '$paymentType', amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
        ShopTransaction.aggregate([{ $match: { type: 'expense' } }, { $group: { _id: '$paymentType', amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
        SalaryPayment.aggregate([{ $match: { businessUnit: 'shop' } }, { $group: { _id: '$paymentType', amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
        ShopTransaction.aggregate([{ $match: { type: 'income', occurredAt: { $gte: start, $lt: end } } }, { $group: { _id: '$paymentType', amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
        ShopTransaction.aggregate([{ $match: { type: 'expense', occurredAt: { $gte: start, $lt: end } } }, { $group: { _id: '$paymentType', amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
        SalaryPayment.aggregate([{ $match: { businessUnit: 'shop', createdAt: { $gte: start, $lt: end } } }, { $group: { _id: '$paymentType', amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
        ShopTransaction.distinct('category', { type: 'expense', category: { $ne: '' } }),
      ])
      return ApiResponse.ok(res, {
        period,
        allTime: calculateShopBalance(allIncomeRows, allExpenseRows, allSalaryRows),
        month: calculateShopBalance(monthIncomeRows, monthExpenseRows, monthSalaryRows),
        categories: categories.sort((a, b) => a.localeCompare(b)),
      })
    } catch (error) { return next(error) }
  }

  list = async (req, res, next) => {
    try {
      const filter = {}
      if (['income', 'expense'].includes(req.query.type)) filter.type = req.query.type
      if (req.query.category) filter.category = String(req.query.category)
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200))
      const transactions = await ShopTransaction.find(filter)
        .populate('createdBy', 'firstname lastname position')
        .populate('updatedBy', 'firstname lastname position')
        .sort({ occurredAt: -1, createdAt: -1 })
        .limit(limit)
      return ApiResponse.ok(res, { transactions })
    } catch (error) { return next(error) }
  }

  payload(body, existingType) {
    const type = ['income', 'expense'].includes(body.type) ? body.type : existingType
    const amount = Number(body.amount)
    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date()
    return {
      type,
      title: String(body.title || '').trim() || (type === 'income' ? 'Do‘kon kirimi' : ''),
      amount,
      paymentType: paymentTypes.includes(body.paymentType) ? body.paymentType : 'cash',
      category: type === 'expense' ? String(body.category || '').trim() : '',
      occurredAt,
      note: String(body.note || '').trim(),
    }
  }

  validate(res, payload) {
    if (!payload.type) { ApiResponse.badRequest(res, 'Kirim yoki chiqim turini tanlang'); return false }
    if (!Number.isFinite(payload.amount) || payload.amount < 1) { ApiResponse.badRequest(res, 'Summani to‘g‘ri kiriting'); return false }
    if (Number.isNaN(payload.occurredAt.getTime())) { ApiResponse.badRequest(res, 'Sana noto‘g‘ri'); return false }
    if (payload.type === 'expense' && !payload.title) { ApiResponse.badRequest(res, 'Xarajat nomini kiriting'); return false }
    if (payload.type === 'expense' && !payload.category) { ApiResponse.badRequest(res, 'Xarajat kategoriyasini kiriting'); return false }
    return true
  }

  create = async (req, res, next) => {
    try {
      const payload = this.payload(req.body)
      if (!this.validate(res, payload)) return undefined
      const transaction = await ShopTransaction.create({ ...payload, createdBy: req.employee._id })
      await transaction.populate('createdBy', 'firstname lastname position')
      this.emitChange(req, 'created', transaction)
      return ApiResponse.created(res, { transaction }, payload.type === 'income' ? 'Do‘kon kirimi saqlandi' : 'Do‘kon chiqimi saqlandi')
    } catch (error) { return next(error) }
  }

  update = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Operatsiya topilmadi')
      const transaction = await ShopTransaction.findById(req.params.id)
      if (!transaction) return ApiResponse.notFound(res, 'Operatsiya topilmadi')
      const payload = this.payload(req.body, transaction.type)
      if (!this.validate(res, payload)) return undefined
      Object.assign(transaction, payload, { updatedBy: req.employee._id })
      await transaction.save()
      await transaction.populate([{ path: 'createdBy', select: 'firstname lastname position' }, { path: 'updatedBy', select: 'firstname lastname position' }])
      this.emitChange(req, 'updated', transaction)
      return ApiResponse.ok(res, { transaction }, 'Do‘kon operatsiyasi yangilandi')
    } catch (error) { return next(error) }
  }

  remove = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return ApiResponse.notFound(res, 'Operatsiya topilmadi')
      const transaction = await ShopTransaction.findByIdAndDelete(req.params.id)
      if (!transaction) return ApiResponse.notFound(res, 'Operatsiya topilmadi')
      this.emitChange(req, 'deleted', transaction)
      return ApiResponse.ok(res, { transactionId: transaction.id }, 'Do‘kon operatsiyasi o‘chirildi')
    } catch (error) { return next(error) }
  }
}

export const shopController = new ShopController()
