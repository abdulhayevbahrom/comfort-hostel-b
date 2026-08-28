import mongoose from 'mongoose'

const universitySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true, maxlength: 150 },
    shortName: { type: String, trim: true, maxlength: 30, default: '' },
  },
  { timestamps: true },
)

universitySchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
    return result
  },
})

export const University = mongoose.model('University', universitySchema)
