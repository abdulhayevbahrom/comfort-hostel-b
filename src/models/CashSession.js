import mongoose from 'mongoose'

const contributorSchema = new mongoose.Schema({
  sourceKey: { type: String, required: true },
  sourceType: { type: String, enum: ['payment', 'deposit', 'transfer'], required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', default: null },
  studentName: { type: String, trim: true, default: '' },
  amount: { type: Number, required: true, min: 1 },
  method: { type: String, enum: ['cash', 'card', 'online', 'bank'], required: true },
  paidAt: { type: Date, default: null },
}, { _id: false })

const cashSessionSchema = new mongoose.Schema({
  cashier: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  status: { type: String, enum: ['open', 'pending', 'approved', 'rejected'], default: 'open', index: true },
  expectedAmount: { type: Number, default: 0, min: 0 },
  receivedAmount: { type: Number, default: null, min: 0 },
  paymentCount: { type: Number, default: 0, min: 0 },
  sourceSession: { type: mongoose.Schema.Types.ObjectId, ref: 'CashSession', default: null, index: true },
  destinationSession: { type: mongoose.Schema.Types.ObjectId, ref: 'CashSession', default: null, index: true },
  transferStage: { type: String, enum: ['cashier_to_head', 'head_to_owner'], default: null, index: true },
  breakdown: {
    cash: { type: Number, default: 0, min: 0 },
    card: { type: Number, default: 0, min: 0 },
    online: { type: Number, default: 0, min: 0 },
    bank: { type: Number, default: 0, min: 0 },
  },
  contributors: { type: [contributorSchema], default: [] },
  closedAt: { type: Date, default: null },
  reviewedAt: { type: Date, default: null },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  note: { type: String, trim: true, maxlength: 500, default: '' },
  reviewNote: { type: String, trim: true, maxlength: 500, default: '' },
}, { timestamps: true })

cashSessionSchema.index({ cashier: 1, status: 1 })
cashSessionSchema.index({ cashier: 1 }, { unique: true, partialFilterExpression: { status: 'open' } })
cashSessionSchema.set('toJSON', { transform(_document, result) { result.id = result._id.toString(); delete result._id; delete result.__v } })

export const CashSession = mongoose.model('CashSession', cashSessionSchema)
