import mongoose from 'mongoose'

const imageSchema = new mongoose.Schema(
  { url: String, displayUrl: String, thumbnailUrl: String },
  { _id: false },
)

const generalSettingSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: 'general' },
    hostelName: { type: String, required: true, trim: true, maxlength: 120, default: 'TizimPlus Hostel' },
    organizationPhone: { type: String, trim: true, match: /^\d{9}$/, default: '' },
    organizationAddress: { type: String, trim: true, maxlength: 300, default: '' },
    logo: { type: imageSchema, default: null },
    receiptThankYou: { type: String, trim: true, maxlength: 500, default: 'To‘lovingiz uchun rahmat!' },
    debtorSmsTemplate: { type: String, trim: true, maxlength: 500, default: "Hurmatli {studentName} sizda {period} uchun {debtAmount} so'm qarzdorlik mavjud. Qarzdorlikni to'lamasangiz binoga kirish taqiqlanadi. {hostelName}!" },
  },
  { timestamps: true },
)

generalSettingSchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
  },
})

export const GeneralSetting = mongoose.model('GeneralSetting', generalSettingSchema)
