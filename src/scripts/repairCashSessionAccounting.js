import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDatabase } from '../config/db.js'
import { CashSession } from '../models/CashSession.js'
import { Employee } from '../models/Employee.js'

const apply = process.argv.includes('--apply')
const methods = ['cash', 'card', 'online', 'bank']
const emptyBreakdown = () => ({ cash: 0, card: 0, online: 0, bank: 0 })
const totalBreakdown = (breakdown) => methods.reduce((sum, method) => sum + Number(breakdown?.[method] || 0), 0)

const contributorBreakdown = (contributors = []) => contributors.reduce((result, item) => {
  if (methods.includes(item.method)) result[item.method] += Number(item.amount || 0)
  return result
}, emptyBreakdown())

try {
  await connectDatabase()
  const sessions = await CashSession.find({
    status: 'approved',
    $or: [{ transferStage: 'head_to_owner' }, { transferStage: null }],
  }).populate('cashier', 'firstname lastname role').sort({ closedAt: 1, createdAt: 1 })

  const repaired = []
  for (const session of sessions) {
    const before = {
      id: session.id,
      cashier: session.cashier ? `${session.cashier.firstname || ''} ${session.cashier.lastname || ''}`.trim() : '—',
      stage: session.transferStage || 'old',
      expectedAmount: session.expectedAmount,
      receivedAmount: session.receivedAmount,
      closedAt: session.closedAt,
      reviewedAt: session.reviewedAt,
      breakdown: session.breakdown,
    }
    const changes = {}
    if (session.receivedAmount === null || session.receivedAmount === undefined || (Number(session.receivedAmount || 0) <= 0 && Number(session.expectedAmount || 0) > 0)) {
      session.receivedAmount = Number(session.expectedAmount || 0)
      changes.receivedAmount = session.receivedAmount
    }
    if (!session.reviewedAt) {
      session.reviewedAt = session.closedAt || session.updatedAt || session.createdAt || new Date()
      changes.reviewedAt = session.reviewedAt
    }
    if (totalBreakdown(session.breakdown) <= 0 && Number(session.receivedAmount || session.expectedAmount || 0) > 0) {
      const fromContributors = contributorBreakdown(session.contributors)
      session.breakdown = totalBreakdown(fromContributors) > 0
        ? fromContributors
        : { ...emptyBreakdown(), cash: Number(session.receivedAmount || session.expectedAmount || 0) }
      changes.breakdown = session.breakdown
    }
    if (!Object.keys(changes).length) continue
    if (apply) await session.save()
    repaired.push({ before, changes })
  }

  console.log(JSON.stringify({
    applied: apply,
    checked: sessions.length,
    repairedCount: repaired.length,
    repaired,
  }, null, 2))
} finally {
  await mongoose.disconnect()
}
