import { Employee } from '../models/Employee.js'
import { Student } from '../models/Student.js'

export const FACE_ID_CODE_PATTERN = /^[A-Z0-9]{1,32}$/

export const normalizeFaceIdCode = (value) => String(value || '').trim().toUpperCase()

export const isValidFaceIdCode = (value) => FACE_ID_CODE_PATTERN.test(normalizeFaceIdCode(value))

export const faceIdCodeExists = async (faceIdCode, { studentId, employeeId } = {}) => {
  const code = normalizeFaceIdCode(faceIdCode)
  if (!code) return false

  const studentFilter = { faceIdCode: code }
  if (studentId) studentFilter._id = { $ne: studentId }
  const employeeFilter = { faceIdCode: code }
  if (employeeId) employeeFilter._id = { $ne: employeeId }

  const [studentExists, employeeExists] = await Promise.all([
    Student.exists(studentFilter),
    Employee.exists(employeeFilter),
  ])
  return Boolean(studentExists || employeeExists)
}
