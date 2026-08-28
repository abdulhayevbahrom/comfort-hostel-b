import mongoose from 'mongoose'

const bedLayoutSchema = new mongoose.Schema({
  number: { type: Number, required: true, min: 1, max: 99 },
  type: { type: String, enum: ['single', 'bunk'], required: true },
  slotNumbers: { type: [Number], default: [] },
}, { _id: false })

const roomSchema = new mongoose.Schema(
  {
    roomNumber: { type: String, required: true, trim: true, maxlength: 30 },
    block: { type: String, trim: true, maxlength: 80, default: '' },
    floor: { type: String, required: true, trim: true, maxlength: 30 },
    bunkBedCount: { type: Number, min: 1, max: 25, default: null },
    bedLayout: { type: [bedLayoutSchema], default: [] },
    capacity: { type: Number, required: true, min: 1, max: 50 },
    category: { type: String, enum: ['', 'standart', 'komfort', 'premium', 'maxsus'], default: '' },
    gender: { type: String, enum: ['male', 'female', 'family', 'guest'], required: true },
    status: { type: String, enum: ['available', 'maintenance'], default: 'available' },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    images: {
      type: [{ url: { type: String, required: true }, displayUrl: { type: String, default: '' }, thumbnailUrl: { type: String, default: '' } }],
      default: [],
    },
  },
  { timestamps: true },
)

roomSchema.index({ block: 1, floor: 1, roomNumber: 1 }, { unique: true })

roomSchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
    return result
  },
})

export const Room = mongoose.model('Room', roomSchema)
