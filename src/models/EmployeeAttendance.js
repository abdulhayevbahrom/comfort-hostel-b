import mongoose from 'mongoose'

const employeeAttendanceSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
  firstEntry: { type: Date, required: true },
  currentEntry: { type: Date, default: null },
  lastExit: { type: Date, default: null },
  totalHours: { type: Number, min: 0, default: 0 },
  lastDeviceEvent: { type: mongoose.Schema.Types.ObjectId, ref: 'FaceDeviceEvent', default: null },
}, { timestamps: true })

employeeAttendanceSchema.index({ employee: 1, date: 1 }, { unique: true })
employeeAttendanceSchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
  },
})

export const EmployeeAttendance = mongoose.model('EmployeeAttendance', employeeAttendanceSchema)
