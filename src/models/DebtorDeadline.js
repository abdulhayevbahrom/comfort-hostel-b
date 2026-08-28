import mongoose from 'mongoose'

const debtorDeadlineSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  periodKey: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/, index: true },
  deadline: { type: Date, required: true, index: true },
  setBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
}, { timestamps: true })

debtorDeadlineSchema.index({ student: 1, periodKey: 1 }, { unique: true })
debtorDeadlineSchema.set('toJSON', { transform(_document, result) { result.id = result._id.toString(); delete result._id; delete result.__v } })

export const DebtorDeadline = mongoose.model('DebtorDeadline', debtorDeadlineSchema)
