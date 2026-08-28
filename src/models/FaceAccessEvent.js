import mongoose from 'mongoose'

const faceAccessEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true, trim: true, maxlength: 160, index: true },
  faceIdCode: { type: String, required: true, trim: true, uppercase: true, index: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', default: null, index: true },
  deviceKey: { type: String, trim: true, maxlength: 120, default: '' },
  direction: { type: String, enum: ['IN', 'OUT', 'BOTH'], default: 'IN' },
  occurredAt: { type: Date, required: true, index: true },
  decision: {
    type: String,
    enum: ['granted', 'granted_warning', 'denied_unknown', 'denied_inactive', 'denied_disabled', 'denied_debt_limit', 'error'],
    required: true,
    index: true,
  },
  reason: { type: String, trim: true, maxlength: 500, default: '' },
  debtAmount: { type: Number, default: 0, min: 0 },
  warningCount: { type: Number, default: 0, min: 0, max: 3 },
  smsStatus: { type: String, enum: ['not_required', 'queued', 'sending', 'sent', 'failed', 'duplicate'], default: 'not_required', index: true },
  smsError: { type: String, trim: true, maxlength: 500, default: '' },
  smsPeriodKey: { type: String, trim: true, match: /^$|^\d{4}-(0[1-9]|1[0-2])$/, default: '' },
  smsContent: { type: String, trim: true, maxlength: 500, default: '' },
  smsDestination: { type: String, trim: true, maxlength: 20, default: '' },
  smsAttempts: { type: Number, min: 0, default: 0 },
  smsNextAttemptAt: { type: Date, default: null, index: true },
  smsSentAt: { type: Date, default: null },
  attendanceRecorded: { type: Boolean, default: false },
}, { timestamps: true })

faceAccessEventSchema.index({ student: 1, occurredAt: -1 })
faceAccessEventSchema.index({ decision: 1, occurredAt: -1 })
faceAccessEventSchema.index({ smsStatus: 1, smsNextAttemptAt: 1 })
faceAccessEventSchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
  },
})

export const FaceAccessEvent = mongoose.model('FaceAccessEvent', faceAccessEventSchema)
