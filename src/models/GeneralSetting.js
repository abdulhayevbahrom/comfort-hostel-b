import mongoose from 'mongoose'

const imageSchema = new mongoose.Schema(
  { url: String, displayUrl: String, thumbnailUrl: String },
  { _id: false },
)

const normalizeWorkDays = (value) => {
  if (!Array.isArray(value)) return [1, 2, 3, 4, 5, 6]
  return [...new Set(value.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b)
}

const employeeWorkScheduleSchema = new mongoose.Schema({
  checkInTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, default: '09:00' },
  checkOutTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, default: '18:00' },
  workDays: {
    type: [Number],
    default: [1, 2, 3, 4, 5, 6],
    set: normalizeWorkDays,
    validate: { validator: (days) => days.length > 0, message: 'Kamida bitta ish kuni tanlanishi kerak' },
  },
  lateAfterMinutes: { type: Number, min: 0, default: 0 },
  earlyLeaveMinutes: { type: Number, min: 0, default: 0 },
  useTimePenalty: { type: Boolean, default: false },
  penaltyPerMinute: { type: Number, min: 0, default: 0 },
  penaltyStartDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/, default: () => new Date().toISOString().slice(0, 10) },
}, { _id: false })

const generalSettingSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: 'general' },
    hostelName: { type: String, required: true, trim: true, maxlength: 120, default: 'TizimPlus Hostel' },
    organizationPhone: { type: String, trim: true, match: /^\d{9}$/, default: '' },
    organizationAddress: { type: String, trim: true, maxlength: 300, default: '' },
    logo: { type: imageSchema, default: null },
    receiptThankYou: { type: String, trim: true, maxlength: 500, default: 'To‘lovingiz uchun rahmat!' },
    debtorSmsTemplate: { type: String, trim: true, maxlength: 500, default: "Hurmatli {studentName} sizda {period} uchun {debtAmount} so'm qarzdorlik mavjud. Qarzdorlikni to'lamasangiz binoga kirish taqiqlanadi. {hostelName}!" },
    employeeFaceAttendanceEnabled: { type: Boolean, default: true },
    employeeWorkSchedule: { type: employeeWorkScheduleSchema, default: () => ({}) },
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
