import { Student } from '../models/Student.js'
import { Employee } from '../models/Employee.js'

export async function backfillFaceIdCodes() {
  const students = await Student.find({
    $or: [
      { faceIdCode: { $exists: false } },
      { faceIdCode: null },
      { faceIdCode: '' },
      { faceIdCode: { $not: /^STU[A-F0-9]{12}$/ } },
    ],
  }).select('_id')
  const studentOperations = students.map((student) => ({
    updateOne: {
      filter: { _id: student._id },
      update: { $set: { faceIdCode: `STU${student._id.toString().slice(-12).toUpperCase()}` } },
    },
  }))
  const employees = await Employee.find({
    $or: [
      { faceIdCode: { $exists: false } },
      { faceIdCode: null },
      { faceIdCode: '' },
      { faceIdCode: { $not: /^EMP[A-F0-9]{12}$/ } },
    ],
  }).select('_id')
  const employeeOperations = employees.map((employee) => ({
    updateOne: {
      filter: { _id: employee._id },
      update: { $set: { faceIdCode: `EMP${employee._id.toString().slice(-12).toUpperCase()}` } },
    },
  }))
  const [studentResult, employeeResult] = await Promise.all([
    studentOperations.length ? Student.bulkWrite(studentOperations, { ordered: false }) : null,
    employeeOperations.length ? Employee.bulkWrite(employeeOperations, { ordered: false }) : null,
  ])
  return {
    studentsUpdated: studentResult?.modifiedCount || 0,
    employeesUpdated: employeeResult?.modifiedCount || 0,
    updated: (studentResult?.modifiedCount || 0) + (employeeResult?.modifiedCount || 0),
  }
}
