import mongoose from 'mongoose'

const debtorSmsSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  periodKey: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/, index: true },
  destination: { type: String, required: true, match: /^\+998\d{9}$/ },
  content: { type: String, required: true, maxlength: 500 },
  sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  source: { type: String, enum: ['manual', 'faceid'], default: 'manual', index: true },
  faceAccessEvent: { type: mongoose.Schema.Types.ObjectId, ref: 'FaceAccessEvent', default: null },
}, { timestamps: true })

debtorSmsSchema.index({ student: 1, periodKey: 1, createdAt: -1 })
debtorSmsSchema.set('toJSON', { transform(_document, result) { result.id = result._id.toString(); delete result._id; delete result.__v } })

export const DebtorSms = mongoose.model('DebtorSms', debtorSmsSchema)
