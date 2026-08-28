import mongoose from 'mongoose'

const buildingBlockSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true, maxlength: 80 },
  },
  { timestamps: true },
)

buildingBlockSchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
    return result
  },
})

export const BuildingBlock = mongoose.model('BuildingBlock', buildingBlockSchema)
