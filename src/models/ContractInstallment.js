import mongoose from 'mongoose'

const contractInstallmentSchema = new mongoose.Schema(
  {
    contract: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentContract', required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    periodIndex: { type: Number, required: true, min: 1 },
    periodKey: { type: String, required: true, match: /^\d{4}-\d{2}$/, index: true },
    dueDate: { type: Date, required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['unpaid', 'partial', 'paid'], default: 'unpaid', index: true },
  },
  { timestamps: true },
)

contractInstallmentSchema.index({ contract: 1, periodIndex: 1 }, { unique: true })
contractInstallmentSchema.index({ periodKey: 1, status: 1 })

contractInstallmentSchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
  },
})

export const ContractInstallment = mongoose.model('ContractInstallment', contractInstallmentSchema)
