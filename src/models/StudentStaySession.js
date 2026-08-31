import mongoose from 'mongoose'

const studentStaySessionSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  entryAt: { type: Date, required: true, index: true },
  exitAt: { type: Date, default: null, index: true },
  incompleteAt: { type: Date, default: null },
  entryDevice: { type: mongoose.Schema.Types.ObjectId, ref: 'FaceDevice', default: null },
  exitDevice: { type: mongoose.Schema.Types.ObjectId, ref: 'FaceDevice', default: null },
  entryMovement: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentMovement', default: null },
  exitMovement: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentMovement', default: null },
  status: { type: String, enum: ['open', 'closed', 'incomplete'], default: 'open', index: true },
  durationMinutes: { type: Number, min: 0, default: null },
}, { timestamps: true })

studentStaySessionSchema.index({ student: 1, entryAt: -1 })
studentStaySessionSchema.index(
  { student: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'open' } },
)
studentStaySessionSchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
  },
})

export const StudentStaySession = mongoose.model('StudentStaySession', studentStaySessionSchema)
