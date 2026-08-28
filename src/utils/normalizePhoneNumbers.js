import { GeneralSetting } from '../models/GeneralSetting.js'
import { Student } from '../models/Student.js'

export async function normalizeStoredPhoneNumbers() {
  await Promise.all([
    Student.updateMany(
      { phone: /^\+998\d{9}$/ },
      [{ $set: { phone: { $substrBytes: ['$phone', 4, 9] } } }],
    ),
    Student.updateMany(
      { parentPhone: /^\+998\d{9}$/ },
      [{ $set: { parentPhone: { $substrBytes: ['$parentPhone', 4, 9] } } }],
    ),
    GeneralSetting.updateMany(
      { organizationPhone: /^\+998\d{9}$/ },
      [{ $set: { organizationPhone: { $substrBytes: ['$organizationPhone', 4, 9] } } }],
    ),
  ])
  await Student.syncIndexes()
}
