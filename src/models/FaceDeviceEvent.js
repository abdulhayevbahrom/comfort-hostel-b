import mongoose from 'mongoose'

const faceDeviceEventSchema = new mongoose.Schema({
  device: { type: mongoose.Schema.Types.ObjectId, ref: 'FaceDevice', required: true, index: true },
  eventId: { type: String, required: true, trim: true, maxlength: 160 },
  occurredAt: { type: Date, required: true, index: true },
  faceCode: { type: String, trim: true, uppercase: true, default: '' },
  transport: { type: String, enum: ['http_listening', 'isup_gateway', 'direct_isapi'], default: 'http_listening', index: true },
  sourceSerialNo: { type: String, trim: true, maxlength: 120, default: '' },
  rawEventType: { type: String, trim: true, maxlength: 120, default: '' },
  personType: { type: String, enum: ['employee', 'student', 'unknown'], default: 'unknown', index: true },
  personId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  accessDecision: { type: String, trim: true, default: 'processing', index: true },
  doorAttempted: { type: Boolean, default: false },
  doorOpened: { type: Boolean, default: false },
  processingMs: { type: Number, min: 0, default: 0 },
  error: { type: String, trim: true, maxlength: 500, default: '' },
}, { timestamps: true })

faceDeviceEventSchema.index({ device: 1, eventId: 1 }, { unique: true })
faceDeviceEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 })

export const FaceDeviceEvent = mongoose.model('FaceDeviceEvent', faceDeviceEventSchema)
