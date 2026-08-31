import mongoose from 'mongoose'

const studentPresenceSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, unique: true, index: true },
  isInside: { type: Boolean, default: false, index: true },
  currentSession: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentStaySession', default: null },
  lastEntryAt: { type: Date, default: null },
  lastExitAt: { type: Date, default: null },
  lastEventAt: { type: Date, default: null, index: true },
  lastTransitionAt: { type: Date, default: null },
  lastDirection: { type: String, enum: ['IN', 'OUT', null], default: null },
  lastDevice: { type: mongoose.Schema.Types.ObjectId, ref: 'FaceDevice', default: null },
  lastMovement: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentMovement', default: null },
}, { timestamps: true })

studentPresenceSchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
  },
})

export const StudentPresence = mongoose.model('StudentPresence', studentPresenceSchema)
