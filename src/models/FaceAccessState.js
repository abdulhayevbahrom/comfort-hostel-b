import mongoose from 'mongoose'

const faceAccessStateSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, unique: true, index: true },
  debtCycle: { type: Number, default: 0, min: 0 },
  activeDebt: { type: Boolean, default: false, index: true },
  warningCount: { type: Number, default: 0, min: 0, max: 3 },
  blocked: { type: Boolean, default: false, index: true },
  lastDebtAmount: { type: Number, default: 0, min: 0 },
  debtStartedAt: { type: Date, default: null },
  lastWarningAt: { type: Date, default: null },
  clearedAt: { type: Date, default: null },
}, { timestamps: true })

faceAccessStateSchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
  },
})

export const FaceAccessState = mongoose.model('FaceAccessState', faceAccessStateSchema)
