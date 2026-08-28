import mongoose from 'mongoose'

const blacklistEntrySchema = new mongoose.Schema(
  {
    jshr: { type: String, required: true, unique: true, match: /^\d{14}$/ },
    passportSeries: { type: String, required: true, uppercase: true, match: /^[A-Z]{2}$/ },
    passportNumber: { type: String, required: true, match: /^\d{7}$/ },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    sourceStudent: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', default: null },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
)

blacklistEntrySchema.index({ passportSeries: 1, passportNumber: 1 }, { unique: true })

export const BlacklistEntry = mongoose.model('BlacklistEntry', blacklistEntrySchema)
