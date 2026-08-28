import mongoose from 'mongoose'

const salaryPaymentSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    period: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/, index: true },
    amount: { type: Number, required: true, min: 1 },
    paymentType: { type: String, enum: ['cash', 'card', 'bank'], default: 'cash' },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  },
  { timestamps: true },
)

salaryPaymentSchema.index({ employee: 1, period: 1, createdAt: -1 })
salaryPaymentSchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
  },
})

export const SalaryPayment = mongoose.model('SalaryPayment', salaryPaymentSchema)
