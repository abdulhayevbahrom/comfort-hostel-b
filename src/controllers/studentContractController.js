import mongoose from "mongoose";
import { Student } from "../models/Student.js";
import { StudentContract } from "../models/StudentContract.js";
import { ContractInstallment } from "../models/ContractInstallment.js";
import { Room } from "../models/Room.js";
import { ApiResponse } from "../utils/response.js";
import {
  buildContractInstallments,
  calculateContractPayment,
} from "../utils/contractPayment.js";

class StudentContractController {
  cleanPayload(body) {
    const payload = {
      student: body.student,
      room: body.room,
      bedNumber: Number(body.bedNumber),
      contractNumber: String(body.contractNumber || "").trim(),
      startDate: body.startDate,
      endDate: body.endDate,
      paymentType: body.paymentType || "monthly",
      paymentAmount: Number(body.paymentAmount),
      status: body.status || "active",
      note: String(body.note || "").trim(),
    };
    return {
      ...payload,
      ...calculateContractPayment(
        payload.startDate,
        payload.endDate,
        payload.paymentType,
        payload.paymentAmount,
      ),
    };
  }

  emitChange(req, action, contract) {
    req.app
      .get("io")
      ?.emit("student-contracts:changed", {
        action,
        studentId: contract?.student?.toString(),
        contractId: contract?.id || contract?._id?.toString(),
      });
    req.app
      .get("io")
      ?.emit("rooms:changed", {
        action: "occupancy-changed",
        roomId: contract?.room?.toString(),
        occurredAt: new Date().toISOString(),
      });
  }

  async syncInstallments(contract) {
    const paidInstallmentExists = await ContractInstallment.exists({
      contract: contract._id,
      paidAmount: { $gt: 0 },
    });
    if (paidInstallmentExists)
      throw Object.assign(
        new Error(
          "To‘lov qilingan shartnomaning sana yoki tarifini o‘zgartirib bo‘lmaydi",
        ),
        { status: 409 },
      );
    await ContractInstallment.deleteMany({ contract: contract._id });
    await ContractInstallment.insertMany(buildContractInstallments(contract));
  }

  async extendInstallments(contract) {
    const desiredInstallments = buildContractInstallments(contract);
    const existingInstallments = await ContractInstallment.find({
      contract: contract._id,
    });
    const existingByIndex = new Map(
      existingInstallments.map((item) => [item.periodIndex, item]),
    );
    const operations = desiredInstallments.map((desired) => {
      const existing = existingByIndex.get(desired.periodIndex);
      if (!existing) return { insertOne: { document: desired } };
      const paidAmount = existing.paidAmount || 0;
      return {
        updateOne: {
          filter: { _id: existing._id },
          update: {
            $set: {
              student: desired.student,
              periodKey: desired.periodKey,
              dueDate: desired.dueDate,
              amount: desired.amount,
              status:
                paidAmount <= 0
                  ? "unpaid"
                  : paidAmount >= desired.amount
                    ? "paid"
                    : "partial",
            },
          },
        },
      };
    });
    if (operations.length) await ContractInstallment.bulkWrite(operations);
  }

  async ensureInstallments(contract) {
    if (
      contract.totalAmount == null ||
      contract.billingQuantity == null ||
      contract.durationDays == null
    ) {
      Object.assign(
        contract,
        calculateContractPayment(
          contract.startDate,
          contract.endDate,
          contract.paymentType,
          contract.paymentAmount,
        ),
      );
      await contract.save();
    }
    if (!(await ContractInstallment.exists({ contract: contract._id }))) {
      await ContractInstallment.insertMany(buildContractInstallments(contract));
    }
  }

  async validateRoom(payload, res, excludeContractId = null) {
    if (!mongoose.isValidObjectId(payload.room))
      return ApiResponse.badRequest(res, "Xonani tanlang");
    const [student, room] = await Promise.all([
      Student.findById(payload.student),
      Room.findById(payload.room),
    ]);
    if (!student)
      return ApiResponse.badRequest(res, "Talabani to‘g‘ri tanlang");
    if (!room) return ApiResponse.badRequest(res, "Xona topilmadi");
    if (['male', 'female'].includes(room.gender) && room.gender !== student.gender)
      return ApiResponse.badRequest(res, "Xona talabaning jinsiga mos emas");
    if (payload.status === "active" && room.status === "maintenance")
      return ApiResponse.badRequest(
        res,
        "Ta’mirdagi xonaga talaba biriktirib bo‘lmaydi",
      );
    if (payload.status === "active") {
      const availableSlots = room.bedLayout?.length
        ? new Set(room.bedLayout.flatMap((bed) => bed.slotNumbers || []))
        : new Set(Array.from({ length: room.capacity }, (_, index) => index + 1));
      if (!Number.isFinite(payload.bedNumber) || payload.bedNumber < 1 || !availableSlots.has(payload.bedNumber))
        return ApiResponse.badRequest(res, "Xonadagi bo‘sh o‘rinni tanlang");
      const activeStudentContract = {
        student: student._id,
        status: "active",
        ...(excludeContractId ? { _id: { $ne: excludeContractId } } : {}),
      };
      if (await StudentContract.exists(activeStudentContract))
        return ApiResponse.conflict(
          res,
          "Talabaning boshqa aktiv shartnomasi mavjud",
        );
      const filter = {
        room: room._id,
        bedNumber: payload.bedNumber,
        status: "active",
        ...(excludeContractId ? { _id: { $ne: excludeContractId } } : {}),
      };
      if (await StudentContract.exists(filter))
        return ApiResponse.conflict(res, "Bu o‘rin allaqachon band");
      const roomFilter = {
        room: room._id,
        status: "active",
        ...(excludeContractId ? { _id: { $ne: excludeContractId } } : {}),
      };
      if ((await StudentContract.countDocuments(roomFilter)) >= room.capacity)
        return ApiResponse.conflict(res, "Bu xonada bo‘sh o‘rin qolmagan");
    }
    return null;
  }

  listByStudent = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.studentId))
        return ApiResponse.notFound(res, "Talaba topilmadi");
      const contracts = await StudentContract.find({
        student: req.params.studentId,
      })
        .populate("room", "roomNumber block floor")
        .sort({ startDate: -1, createdAt: -1 });
      await Promise.all(
        contracts.map((contract) => this.ensureInstallments(contract)),
      );
      return ApiResponse.ok(res, { contracts });
    } catch (error) {
      return next(error);
    }
  };

  listActive = async (req, res, next) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const filter = { status: "active", startDate: { $lt: tomorrow }, endDate: { $gte: today } };
      if (mongoose.isValidObjectId(req.query.room)) filter.room = req.query.room;
      if (["student_contract", "standard_contract"].includes(req.query.contractType)) {
        filter.student = { $in: await Student.distinct("_id", { hasTaxContract: true, taxContractType: req.query.contractType }) };
      }
      const currentPeriod = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;
      const summaryFilter = {
        ...(filter.student ? { student: filter.student } : {}),
        ...(filter.room ? { room: filter.room } : {}),
      };
      const summaryContracts = await StudentContract.find(summaryFilter).select("_id status").lean();
      const currentMonthRows = await ContractInstallment.aggregate([
        {
          $match: {
            periodKey: currentPeriod,
            contract: { $in: summaryContracts.map((contract) => contract._id) },
          },
        },
        { $group: { _id: null, amount: { $sum: "$amount" } } },
      ]);
      const summary = summaryContracts.reduce((result, contract) => {
        result.total += 1;
        if (Object.prototype.hasOwnProperty.call(result, contract.status)) result[contract.status] += 1;
        return result;
      }, { total: 0, active: 0, completed: 0, cancelled: 0, amount: 0 });
      summary.amount = currentMonthRows[0]?.amount || 0;
      const contracts = await StudentContract.find(filter)
        .populate({ path: "student", select: "fullName phone fatherPhone motherPhone photo university faculty course gender hasTaxContract taxContractType", populate: [{ path: "university", select: "name shortName" }, { path: "faculty", select: "name" }] })
        .populate("room", "roomNumber block floor")
        .sort({ createdAt: -1 });
      const search = String(req.query.search || "").trim().toLowerCase();
      let rows = contracts.filter((contract) => contract.student && contract.room);
      if (search) rows = rows.filter((contract) => `${contract.student.fullName} ${contract.student.phone} ${contract.contractNumber} ${contract.room.block} ${contract.room.roomNumber}`.toLowerCase().includes(search));
      const warningLimit = new Date(today);
      warningLimit.setDate(warningLimit.getDate() + 3);
      rows.sort((first, second) => {
        const firstEnd = new Date(first.endDate).getTime();
        const secondEnd = new Date(second.endDate).getTime();
        const firstWarning = firstEnd < warningLimit.getTime();
        const secondWarning = secondEnd < warningLimit.getTime();
        if (firstWarning !== secondWarning) return firstWarning ? -1 : 1;
        if (firstWarning && firstEnd !== secondEnd) return firstEnd - secondEnd;
        return new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime();
      });
      const total = rows.length;
      const limit = 25;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const page = Math.min(Math.max(1, Number.parseInt(req.query.page, 10) || 1), totalPages);
      rows = rows.slice((page - 1) * limit, page * limit);
      return ApiResponse.ok(res, { contracts: rows, summary, pagination: { page, limit, total, totalPages } });
    } catch (error) {
      return next(error);
    }
  };

  create = async (req, res, next) => {
    try {
      const payload = this.cleanPayload(req.body);
      payload.status = "active";
      if (!Number.isFinite(payload.paymentAmount) || payload.paymentAmount <= 0)
        return ApiResponse.badRequest(res, "To‘lov summasi 0 dan katta bo‘lishi kerak");
      if (!mongoose.isValidObjectId(payload.student))
        return ApiResponse.badRequest(res, "Talabani to‘g‘ri tanlang");
      if (await this.validateRoom(payload, res)) return undefined;
      if (new Date(payload.endDate) <= new Date(payload.startDate))
        return ApiResponse.badRequest(
          res,
          "Tugash sanasi boshlanish sanasidan keyin bo‘lishi kerak",
        );
      const contract = await StudentContract.create(payload);
      await this.syncInstallments(contract);
      await contract.populate("room", "roomNumber block floor");
      this.emitChange(req, "created", contract);
      return ApiResponse.created(res, { contract }, "Shartnoma tuzildi");
    } catch (error) {
      return next(error);
    }
  };

  update = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id))
        return ApiResponse.notFound(res, "Shartnoma topilmadi");
      const existing = await StudentContract.findById(req.params.id);
      if (!existing) return ApiResponse.notFound(res, "Shartnoma topilmadi");
      const payload = this.cleanPayload(req.body);
      if (!Number.isFinite(payload.paymentAmount) || payload.paymentAmount <= 0)
        return ApiResponse.badRequest(res, "To‘lov summasi 0 dan katta bo‘lishi kerak");
      if (existing.status === "completed")
        return ApiResponse.conflict(
          res,
          "Yakunlangan shartnomani o‘zgartirib bo‘lmaydi",
        );
      if (existing.status === "cancelled")
        return ApiResponse.conflict(
          res,
          "Bekor qilingan shartnomani o‘zgartirib bo‘lmaydi. Yangi shartnoma tuzing",
        );
      if (payload.status === "completed")
        return ApiResponse.badRequest(
          res,
          "Shartnoma faqat tugash sanasi kelganda avtomatik yakunlanadi. Muddatidan oldin faqat bekor qilish mumkin",
        );
      if (!mongoose.isValidObjectId(payload.student))
        return ApiResponse.badRequest(res, "Talabani to‘g‘ri tanlang");
      if (await this.validateRoom(payload, res, req.params.id))
        return undefined;
      if (new Date(payload.endDate) <= new Date(payload.startDate))
        return ApiResponse.badRequest(
          res,
          "Tugash sanasi boshlanish sanasidan keyin bo‘lishi kerak",
        );
      const baseFinancialChanged =
        existing.paymentType !== payload.paymentType ||
        existing.paymentAmount !== payload.paymentAmount ||
        new Date(existing.startDate).getTime() !==
          new Date(payload.startDate).getTime();
      const endDateChanged =
        new Date(existing.endDate).getTime() !==
        new Date(payload.endDate).getTime();
      const financialChanged = baseFinancialChanged || endDateChanged;
      const paidExists = await ContractInstallment.exists({
        contract: req.params.id,
        paidAmount: { $gt: 0 },
      });
      if (paidExists && baseFinancialChanged)
        return ApiResponse.conflict(
          res,
          "To‘lov qilingan shartnomaning boshlanish sanasi yoki tarifini o‘zgartirib bo‘lmaydi",
        );
      if (
        paidExists &&
        endDateChanged &&
        new Date(payload.endDate) < new Date(existing.endDate)
      )
        return ApiResponse.conflict(
          res,
          "To‘lov qilingan shartnomaning tugash sanasini faqat uzaytirish mumkin",
        );
      if (payload.status === "cancelled" && existing.status !== "cancelled") {
        const now = new Date();
        payload.cancelledAt = now;
      } else payload.cancelledAt = existing.cancelledAt;
      const contract = await StudentContract.findByIdAndUpdate(
        req.params.id,
        payload,
        { new: true, runValidators: true },
      ).populate("room", "roomNumber block floor");
      if (financialChanged) {
        if (paidExists) await this.extendInstallments(contract);
        else await this.syncInstallments(contract);
      }
      this.emitChange(req, "updated", contract);
      return ApiResponse.ok(res, { contract }, "Shartnoma yangilandi");
    } catch (error) {
      return next(error);
    }
  };

  remove = async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id))
        return ApiResponse.notFound(res, "Shartnoma topilmadi");
      const contract = await StudentContract.findById(req.params.id);
      if (!contract) return ApiResponse.notFound(res, "Shartnoma topilmadi");
      return ApiResponse.conflict(
        res,
        contract.status === "active"
          ? "Amaldagi shartnomani o‘chirib bo‘lmaydi. Muddatidan oldin faqat bekor qilish mumkin"
          : "Shartnoma tarixini saqlash uchun yakunlangan yoki bekor qilingan shartnoma o‘chirilmaydi",
      );
    } catch (error) {
      return next(error);
    }
  };
}

export const studentContractController = new StudentContractController();
