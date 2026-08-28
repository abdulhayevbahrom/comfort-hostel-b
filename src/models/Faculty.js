import mongoose from 'mongoose'

const facultySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    university: { type: mongoose.Schema.Types.ObjectId, ref: 'University', required: true, index: true },
  },
  { timestamps: true },
)

facultySchema.index({ university: 1, name: 1 }, { unique: true })
facultySchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
    return result
  },
})

export const Faculty = mongoose.model('Faculty', facultySchema)
