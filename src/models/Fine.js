import mongoose from 'mongoose'

const fineSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    amount: { type: Number, required: true, min: 1 },
    paidAmount: { type: Number, default: 0, min: 0 },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  },
  { timestamps: true },
)

fineSchema.index({ student: 1, createdAt: -1 })
fineSchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
  },
})

export const Fine = mongoose.model('Fine', fineSchema)
