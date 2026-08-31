import mongoose from 'mongoose'

const studentMovementSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  eventId: { type: String, required: true, unique: true, trim: true, maxlength: 160, index: true },
  faceAccessEvent: { type: mongoose.Schema.Types.ObjectId, ref: 'FaceAccessEvent', default: null, index: true },
  deviceEvent: { type: mongoose.Schema.Types.ObjectId, ref: 'FaceDeviceEvent', default: null, index: true },
  device: { type: mongoose.Schema.Types.ObjectId, ref: 'FaceDevice', default: null, index: true },
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentStaySession', default: null, index: true },
  direction: { type: String, enum: ['IN', 'OUT'], required: true, index: true },
  occurredAt: { type: Date, required: true, index: true },
  transition: {
    type: String,
    enum: ['entered', 'exited', 'reentered', 'duplicate', 'stale', 'orphan_exit'],
    required: true,
    index: true,
  },
  applied: { type: Boolean, default: false, index: true },
  source: { type: String, enum: ['faceid', 'backfill'], default: 'faceid' },
  note: { type: String, trim: true, maxlength: 300, default: '' },
}, { timestamps: true })

studentMovementSchema.index({ student: 1, occurredAt: -1 })
studentMovementSchema.index({ direction: 1, occurredAt: -1 })
studentMovementSchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
  },
})

export const StudentMovement = mongoose.model('StudentMovement', studentMovementSchema)
