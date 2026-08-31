import mongoose from 'mongoose'

const shopTransactionSchema = new mongoose.Schema({
  type: { type: String, enum: ['income', 'expense'], required: true, index: true },
  title: { type: String, trim: true, maxlength: 180, default: '' },
  amount: { type: Number, required: true, min: 1 },
  paymentType: { type: String, enum: ['cash', 'card', 'click', 'bank'], required: true, default: 'cash', index: true },
  category: { type: String, trim: true, maxlength: 100, default: '', index: true },
  occurredAt: { type: Date, required: true, default: Date.now, index: true },
  note: { type: String, trim: true, maxlength: 1000, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
}, { timestamps: true })

shopTransactionSchema.index({ type: 1, occurredAt: -1 })
shopTransactionSchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
  },
})

export const ShopTransaction = mongoose.model('ShopTransaction', shopTransactionSchema)
