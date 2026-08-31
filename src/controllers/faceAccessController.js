import mongoose from 'mongoose'
import { FaceAccessEvent } from '../models/FaceAccessEvent.js'
import { FaceAccessState } from '../models/FaceAccessState.js'
import { StudentContract } from '../models/StudentContract.js'
import { StudentPresence } from '../models/StudentPresence.js'
import { StudentStaySession } from '../models/StudentStaySession.js'
import { evaluateStudentFaceAccess } from '../services/studentFaceAccess.service.js'
import { localDateKey } from '../utils/faceAccess.js'
import { ApiResponse } from '../utils/response.js'

const monthRange = (value) => {
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || '')) ? String(value) : localDateKey(new Date()).slice(0, 7)
  const [year, monthNumber] = month.split('-').map(Number)
  const nextYear = monthNumber === 12 ? year + 1 : year
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1
  return {
    month,
    start: new Date(`${month}-01T00:00:00+05:00`),
    end: new Date(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+05:00`),
  }
}

class FaceAccessController {
  check = async (req, res, next) => {
    try {
      const result = await evaluateStudentFaceAccess(req.body, { io: req.app.get('io') })
      return ApiResponse.ok(res, result)
    } catch (error) {
      if (error?.status === 400) return ApiResponse.badRequest(res, error.message)
      if (error?.code === 11000 && req.body?.eventId) {
        const existing = await FaceAccessEvent.findOne({ eventId: req.body.eventId })
        if (existing) return ApiResponse.ok(res, { allowed: true, decision: existing.decision, reason: existing.reason, debtAmount: existing.debtAmount, warningCount: existing.warningCount, smsStatus: existing.smsStatus })
      }
      return next(error)
    }
  }

  events = async (req, res, next) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100))
      const filter = {}
      if (req.query.decision) filter.decision = req.query.decision
      if (mongoose.isValidObjectId(req.query.studentId)) filter.student = req.query.studentId
      const events = await FaceAccessEvent.find(filter).populate('student', 'fullName phone faceIdCode photo').sort({ occurredAt: -1 }).limit(limit)
      return ApiResponse.ok(res, { events })
    } catch (error) { return next(error) }
  }

  states = async (_req, res, next) => {
    try {
      const states = await FaceAccessState.find({ activeDebt: true }).populate('student', 'fullName phone faceIdCode photo').sort({ warningCount: -1, updatedAt: -1 })
      return ApiResponse.ok(res, { states })
    } catch (error) { return next(error) }
  }

  presence = async (_req, res, next) => {
    try {
      const contracts = await StudentContract.find({ status: 'active' })
        .populate('student', 'fullName phone faceIdCode photo')
        .populate('room', 'roomNumber block floor')
        .sort({ startDate: -1 })
      const byStudent = new Map()
      for (const contract of contracts) {
        if (contract.student && !byStudent.has(String(contract.student._id))) byStudent.set(String(contract.student._id), contract)
      }
      const studentIds = [...byStudent.keys()]
      const presences = await StudentPresence.find({ student: { $in: studentIds } })
        .populate('lastDevice', 'name direction')
      const presenceByStudent = new Map(presences.map((item) => [String(item.student), item]))
      const rows = [...byStudent.entries()].map(([studentId, contract]) => {
        const presence = presenceByStudent.get(studentId)
        return {
          student: contract.student,
          room: contract.room,
          status: !presence ? 'unknown' : presence.isInside ? 'inside' : 'outside',
          isInside: presence?.isInside ?? null,
          currentSession: presence?.currentSession || null,
          lastEntryAt: presence?.lastEntryAt || null,
          lastExitAt: presence?.lastExitAt || null,
          lastEventAt: presence?.lastEventAt || null,
          lastDirection: presence?.lastDirection || null,
          lastDevice: presence?.lastDevice || null,
        }
      }).sort((a, b) => {
        const order = { inside: 0, outside: 1, unknown: 2 }
        return order[a.status] - order[b.status] || a.student.fullName.localeCompare(b.student.fullName)
      })
      const summary = rows.reduce((result, row) => {
        result.total += 1
        result[row.status] += 1
        return result
      }, { total: 0, inside: 0, outside: 0, unknown: 0 })
      return ApiResponse.ok(res, { rows, summary })
    } catch (error) { return next(error) }
  }

  sessions = async (req, res, next) => {
    try {
      const { month, start, end } = monthRange(req.query.month)
      const filter = { entryAt: { $gte: start, $lt: end } }
      if (mongoose.isValidObjectId(req.query.studentId)) filter.student = req.query.studentId
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 300))
      const sessions = await StudentStaySession.find(filter)
        .populate('student', 'fullName phone faceIdCode photo')
        .populate('entryDevice', 'name direction')
        .populate('exitDevice', 'name direction')
        .sort({ entryAt: -1 })
        .limit(limit)
      return ApiResponse.ok(res, { month, sessions })
    } catch (error) { return next(error) }
  }

  reset = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.studentId)) return ApiResponse.notFound(res, 'Talaba topilmadi')
      const state = await FaceAccessState.findOneAndUpdate(
        { student: req.params.studentId },
        { $set: { activeDebt: false, warningCount: 0, blocked: false, lastDebtAmount: 0, clearedAt: new Date() } },
        { new: true },
      )
      return ApiResponse.ok(res, { state }, 'FaceID SMS ogohlantirish hisoblagichi nollandi')
    } catch (error) { return next(error) }
  }
}

export const faceAccessController = new FaceAccessController()
