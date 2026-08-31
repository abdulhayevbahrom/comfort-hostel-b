import mongoose from 'mongoose'
import { FaceAccessEvent } from '../models/FaceAccessEvent.js'
import { FaceAccessState } from '../models/FaceAccessState.js'
import { evaluateStudentFaceAccess } from '../services/studentFaceAccess.service.js'
import { ApiResponse } from '../utils/response.js'

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
