import crypto from 'node:crypto'
import mongoose from 'mongoose'

const faceDeviceSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  deviceKey: { type: String, required: true, unique: true, default: () => crypto.randomBytes(24).toString('hex') },
  model: { type: String, trim: true, default: 'DS-K1T341CMF' },
  transport: { type: String, enum: ['http_listening', 'isup_gateway', 'direct_isapi'], default: 'http_listening', index: true },
  isupDeviceId: {
    type: String,
    trim: true,
    maxlength: 64,
    set: (value) => String(value || '').trim() || undefined,
  },
  host: { type: String, trim: true, default: '' },
  doorNo: { type: Number, min: 1, default: 1 },
  direction: { type: String, enum: ['IN', 'OUT', 'BOTH'], default: 'BOTH' },
  controlMode: { type: String, enum: ['attendance_only', 'remote_check', 'remote_open'], default: 'attendance_only' },
  doorControlEnabled: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true, index: true },
  locationDescription: { type: String, trim: true, maxlength: 300, default: '' },
  lastSeenAt: { type: Date, default: null, index: true },
  lastEventAt: { type: Date, default: null },
  lastError: { type: String, trim: true, maxlength: 500, default: '' },
}, { timestamps: true })

faceDeviceSchema.index(
  { isupDeviceId: 1 },
  { unique: true, partialFilterExpression: { isupDeviceId: { $type: 'string' } } },
)

faceDeviceSchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
  },
})

export const FaceDevice = mongoose.model('FaceDevice', faceDeviceSchema)
