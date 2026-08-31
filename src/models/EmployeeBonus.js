import mongoose from 'mongoose'

const employeeBonusSchema = new mongoose.Schema({
  businessUnit: { type: String, enum: ['hostel', 'shop'], default: 'hostel', index: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  period: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/, index: true },
  amount: { type: Number, required: true, min: 1 },
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
}, { timestamps: true })

employeeBonusSchema.index({ employee: 1, period: 1, createdAt: -1 })
employeeBonusSchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
  },
})

export const EmployeeBonus = mongoose.model('EmployeeBonus', employeeBonusSchema)
