import mongoose from 'mongoose'

const attendanceSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    attendanceDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
    status: { type: String, enum: ['present', 'absent', 'late'], required: true, index: true },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    markedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    markedAt: { type: Date, default: Date.now },
    source: { type: String, enum: ['manual', 'faceid'], default: 'manual', index: true },
    firstEntry: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null },
    faceAccessEvent: { type: mongoose.Schema.Types.ObjectId, ref: 'FaceAccessEvent', default: null },
  },
  { timestamps: true },
)

attendanceSchema.index({ student: 1, attendanceDate: 1 }, { unique: true })
attendanceSchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
  },
})

export const Attendance = mongoose.model('Attendance', attendanceSchema)
