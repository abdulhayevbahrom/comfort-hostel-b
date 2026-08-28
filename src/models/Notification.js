import mongoose from 'mongoose'

const notificationSchema = new mongoose.Schema(
  {
    eventKey: { type: String, required: true, unique: true, index: true },
    type: { type: String, enum: ['contract_expiry', 'cash_session', 'payment_change', 'debtor_deadline'], required: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    message: { type: String, required: true, trim: true, maxlength: 500 },
    count: { type: Number, required: true, min: 1 },
    targetPath: { type: String, required: true, default: '/contracts' },
    targetRoles: [{ type: String, enum: ['employee', 'manager', 'cashier', 'owner', 'admin'] }],
    targetEmployees: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  },
  { timestamps: true },
)

notificationSchema.set('toJSON', {
  transform(_document, result) {
    result.id = result._id.toString()
    delete result._id
    delete result.__v
  },
})

export const Notification = mongoose.model('Notification', notificationSchema)
