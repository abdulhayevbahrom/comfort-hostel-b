import mongoose from 'mongoose'

const expenseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 150 },
    category: { type: String, required: true, trim: true, maxlength: 80, index: true },
    amount: { type: Number, required: true, min: 1 },
    paymentType: { type: String, enum: ['cash', 'card', 'click', 'bank'], required: true, default: 'cash', index: true },
    spentAt: { type: Date, required: true, default: Date.now, index: true },
    note: { type: String, trim: true, maxlength: 1000, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  },
  { timestamps: true },
)

expenseSchema.index({ spentAt: -1, createdAt: -1 })
expenseSchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
  },
})

export const Expense = mongoose.model('Expense', expenseSchema)
