import mongoose from 'mongoose'

const studentContractSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
    bedNumber: { type: Number, required: true, min: 1 },
    contractNumber: { type: String, required: true, trim: true, maxlength: 60 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    paymentType: { type: String, enum: ['daily', 'monthly'], default: 'monthly' },
    paymentAmount: { type: Number, required: true, min: 1 },
    durationDays: { type: Number, required: true, min: 0 },
    billingQuantity: { type: Number, required: true, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['active', 'completed', 'cancelled'], default: 'active' },
    cancelledAt: { type: Date, default: null },
    note: { type: String, trim: true, maxlength: 1000, default: '' },
  },
  { timestamps: true },
)

studentContractSchema.index(
  { room: 1, bedNumber: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
)

studentContractSchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
  },
})

export const StudentContract = mongoose.model('StudentContract', studentContractSchema)
