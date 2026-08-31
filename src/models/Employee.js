import mongoose from 'mongoose'

const normalizeWorkDays = (value) => {
  if (!Array.isArray(value)) return [1, 2, 3, 4, 5, 6]
  return [...new Set(value.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b)
}

const workScheduleSchema = new mongoose.Schema({
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

const employeeSchema = new mongoose.Schema(
  {
    businessUnit: { type: String, enum: ['hostel', 'shop'], default: 'hostel', index: true },
    faceIdCode: {
      type: String,
      trim: true,
      uppercase: true,
      // Hikvision Employee ID faqat harf va raqam qabul qiladi.
      match: [/^[A-Z0-9]{1,32}$/, 'FaceID kodi 1–32 ta harf va raqamdan iborat bo‘lishi kerak'],
      unique: true,
      sparse: true,
      index: true,
    },
    faceAccessEnabled: { type: Boolean, default: true, index: true },
    firstname: { type: String, required: true, trim: true, maxlength: 60 },
    lastname: { type: String, required: true, trim: true, maxlength: 60 },
    position: { type: String, required: true, trim: true, maxlength: 100 },
    salary: { type: Number, default: 0, min: 0 },
    payrollStartMonth: {
      type: String,
      match: /^\d{4}-(0[1-9]|1[0-2])$/,
      default: () => new Date().toISOString().slice(0, 7),
    },
    payrollOpeningBalance: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    canLogin: { type: Boolean, default: false },
    role: {
      type: String,
      enum: ['employee', 'manager', 'cashier', 'owner', 'admin'],
      default: 'employee',
    },
    login: {
      type: String,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 60,
      sparse: true,
      unique: true,
    },
    sections: [{ type: String, trim: true }],
    assignedRooms: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Room' }],
    passwordHash: { type: String, select: false, default: null },
    workSchedule: { type: workScheduleSchema, default: () => ({}) },
  },
  { timestamps: true },
)

employeeSchema.pre('validate', function ensureFaceIdCode() {
  if (!this.faceIdCode && this._id) this.faceIdCode = `EMP${this._id.toString().slice(-12).toUpperCase()}`
})

employeeSchema.set('toJSON', {
  transform(_document, result) {
    if (result._id != null) result.id = result._id.toString()
    delete result._id
    delete result.__v
    delete result.passwordHash
    return result
  },
})

employeeSchema.virtual('fullName').get(function fullName() {
  return `${this.firstname} ${this.lastname}`.trim()
})

export const Employee = mongoose.model('Employee', employeeSchema)
