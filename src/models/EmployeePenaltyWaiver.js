import mongoose from 'mongoose'

const employeePenaltyWaiverSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  latePenalty: { type: Number, min: 0, default: 0 },
  earlyLeavePenalty: { type: Number, min: 0, default: 0 },
  absencePenalty: { type: Number, min: 0, default: 0 },
  totalAmount: { type: Number, min: 0, default: 0 },
  waivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
}, { timestamps: true })

employeePenaltyWaiverSchema.index({ employee: 1, date: 1 }, { unique: true })
employeePenaltyWaiverSchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
  },
})

export const EmployeePenaltyWaiver = mongoose.model('EmployeePenaltyWaiver', employeePenaltyWaiverSchema)
