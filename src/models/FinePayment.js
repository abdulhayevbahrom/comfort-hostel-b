import mongoose from 'mongoose'

const finePaymentSchema = new mongoose.Schema(
  {
    fine: { type: mongoose.Schema.Types.ObjectId, ref: 'Fine', required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    amount: { type: Number, required: true, min: 1 },
    method: { type: String, enum: ['cash', 'card', 'click', 'bank'], required: true, default: 'cash' },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  },
  { timestamps: true },
)

finePaymentSchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
  },
})

export const FinePayment = mongoose.model('FinePayment', finePaymentSchema)
