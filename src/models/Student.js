import mongoose from 'mongoose'

const photoSchema = new mongoose.Schema(
  { url: String, displayUrl: String, thumbnailUrl: String, deleteUrl: String },
  { _id: false },
)

const privateImageSchema = new mongoose.Schema(
  { path: String, originalName: String, mimetype: String, size: Number },
  { _id: false },
)

const depositAuditSchema = new mongoose.Schema({
  action: { type: String, enum: ['created', 'updated', 'cancelled'], required: true },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  performedAt: { type: Date, default: Date.now },
  before: { amount: Number, method: String, note: String },
  after: { amount: Number, method: String, note: String },
}, { _id: true })

const depositPaymentSchema = new mongoose.Schema({
  paymentGroup: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  amount: { type: Number, required: true, min: 1 },
  method: { type: String, enum: ['cash', 'online', 'card', 'bank'], required: true },
  receiptImage: { type: String, trim: true, default: '' },
  paidAt: { type: Date, required: true },
  receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  cashSession: { type: mongoose.Schema.Types.ObjectId, ref: 'CashSession', default: null, index: true },
  status: { type: String, enum: ['active', 'cancelled'], default: 'active', index: true },
  cancelledAt: { type: Date, default: null },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  auditHistory: { type: [depositAuditSchema], default: [] },
}, { timestamps: true })

const auditChangeSchema = new mongoose.Schema({
  field: { type: String, required: true },
  label: { type: String, required: true },
  before: { type: mongoose.Schema.Types.Mixed, default: null },
  after: { type: mongoose.Schema.Types.Mixed, default: null },
}, { _id: false })

const studentAuditSchema = new mongoose.Schema({
  scope: { type: String, enum: ['student', 'contract'], required: true, index: true },
  action: { type: String, enum: ['created', 'updated', 'cancelled'], default: 'updated', index: true },
  title: { type: String, required: true },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  performedAt: { type: Date, default: Date.now, index: true },
  contract: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentContract', default: null },
  changes: { type: [auditChangeSchema], default: [] },
}, { _id: true })

const studentSchema = new mongoose.Schema(
  {
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
    fullName: { type: String, required: true, trim: true, maxlength: 150 },
    phone: { type: String, required: true, trim: true, match: /^\d{9}$/ },
    gender: { type: String, enum: ['male', 'female', 'family', 'guest'], required: true },
    fatherPhone: { type: String, trim: true, default: '', validate: { validator: (value) => !value || /^\d{9}$/.test(value), message: 'Otasi yoki bobosi telefoni 9 ta raqamdan iborat bo‘lishi kerak' } },
    motherPhone: { type: String, trim: true, default: '', validate: { validator: (value) => !value || /^\d{9}$/.test(value), message: 'Onasi yoki buvisi telefoni 9 ta raqamdan iborat bo‘lishi kerak' } },
    depositType: { type: String, enum: ['none', 'money', 'passport'], default: 'none' },
    depositAmount: { type: Number, min: 0, default: 0 },
    depositPaymentMethod: { type: String, enum: ['', 'cash', 'online', 'card', 'bank'], default: '' },
    depositReceivedAt: { type: Date, default: null },
    depositPayments: { type: [depositPaymentSchema], default: [] },
    depositReturnedAt: { type: Date, default: null },
    depositReturnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    university: { type: mongoose.Schema.Types.ObjectId, ref: 'University', default: null, index: true },
    faculty: { type: mongoose.Schema.Types.ObjectId, ref: 'Faculty', default: null, index: true },
    address: { type: String, trim: true, maxlength: 300, default: '' },
    course: { type: Number, required: true, min: 1, max: 6 },
    educationType: { type: String, enum: ['daytime', 'evening', 'extramural', 'employed'], default: 'daytime', index: true },
    hasTemporaryRegistration: { type: Boolean, default: false, index: true },
    temporaryRegistrationMonths: { type: Number, min: 1, max: 12, default: null },
    studentStatus: { type: String, enum: ['green', 'warning', 'red'], default: 'green', index: true },
    plannedDepartureDate: { type: Date, default: null },
    hasTaxContract: { type: Boolean, default: false, index: true },
    taxContractType: { type: String, enum: ['', 'student_contract', 'standard_contract'], default: '' },
    disciplinaryStatus: { type: String, enum: ['clear', 'monitoring', 'blacklisted'], default: 'clear' },
    disciplinaryNote: { type: String, trim: true, maxlength: 1000, default: '' },
    disabilityStatus: { type: String, enum: ['none', 'has_disability'], default: 'none' },
    photo: { type: photoSchema, default: null },
    marriageCertificate: { type: photoSchema, default: null },
    passportImages: {
      front: { type: privateImageSchema, default: null },
      back: { type: privateImageSchema, default: null },
    },
    zaksSeries: { type: String, trim: true, uppercase: true, match: /^[A-Z]{2}$/ },
    zaksNumber: { type: String, trim: true, match: /^\d{7}$/ },
    jshr: { type: String, trim: true, match: /^\d{14}$/ },
    passportSeries: { type: String, trim: true, uppercase: true, match: /^[A-Z]{2}$/ },
    passportNumber: { type: String, trim: true, match: /^\d{7}$/ },
    auditHistory: { type: [studentAuditSchema], default: [] },
  },
  { timestamps: true },
)

studentSchema.pre('validate', function ensureFaceIdCode() {
  if (!this.faceIdCode && this._id) this.faceIdCode = `STU${this._id.toString().slice(-12).toUpperCase()}`
})

studentSchema.index({ jshr: 1 }, { unique: true, partialFilterExpression: { jshr: { $type: 'string' } } })
studentSchema.index({ 'depositPayments.paidAt': -1 })
studentSchema.index({ depositReturnedAt: 1, depositType: 1 })
studentSchema.index(
  { passportSeries: 1, passportNumber: 1 },
  { unique: true, partialFilterExpression: { passportSeries: { $type: 'string' }, passportNumber: { $type: 'string' } } },
)
studentSchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
  },
})

export const Student = mongoose.model('Student', studentSchema)
