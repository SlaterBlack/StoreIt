import { Request, Response } from 'express';
import { DateTime } from 'luxon';
import { Op } from 'sequelize';
import {
  ClockItToilPolicy,
  ClockItToilUsage,
  ClockItUserToilContract,
  ScheduledReportConfig,
  User,
} from '../models';
import { sequelize } from '../config/database';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';

const POLICY_ID = 'default';
const UUID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const MAX_HOURS_PER_CYCLE = 8784;

export const getToilSettings = asyncHandler(async (req: Request, res: Response) => {
  const { startDate, endDate } = parseDateRange(req.query['startDate'], req.query['endDate']);
  const [policy, schedule, users, contracts, usages] = await Promise.all([
    ClockItToilPolicy.findByPk(POLICY_ID),
    ScheduledReportConfig.findByPk('fortnightly'),
    User.findAll({
      attributes: ['id', 'name', 'email', 'role'],
      order: [['name', 'ASC']],
    }),
    ClockItUserToilContract.findAll(),
    ClockItToilUsage.findAll({
      where: {
        ...(startDate && endDate
          ? { usageDate: { [Op.gte]: startDate, [Op.lte]: endDate } }
          : {}),
      },
      include: [{ model: User, as: 'user', attributes: ['id', 'name'], required: true }],
      order: [
        ['usageDate', 'DESC'],
        ['createdAt', 'DESC'],
      ],
    }),
  ]);
  const contractsByUserId = new Map(
    contracts.map((contract) => [
      contract.userId,
      Number(contract.contractedHoursPerCycle),
    ]),
  );
  res.json({
    accrualMultiplier: Number(policy?.accrualMultiplier ?? 1),
    payCycle: {
      startDate: schedule?.startDate ?? null,
      periodDays: schedule?.reportPeriodDays ?? 14,
    },
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      contractedHoursPerCycle: contractsByUserId.get(user.id) ?? null,
    })),
    usages: usages.map((usage) => ({
      id: usage.id,
      userId: usage.userId,
      userName: usage.user?.name ?? '',
      usageDate: usage.usageDate,
      hours: Number(usage.hours),
      reason: usage.reason,
      recordedBy: usage.recordedBy,
      createdAt: usage.createdAt,
    })),
  });
});

export const updateToilSettings = asyncHandler(async (req: Request, res: Response) => {
  const rawBody: unknown = req.body;
  if (typeof rawBody !== 'object' || rawBody === null || Array.isArray(rawBody)) {
    throw new ApiError(400, 'Invalid TOIL settings.');
  }
  const body = rawBody as Record<string, unknown>;
  const multiplier = body['accrualMultiplier'];
  const rawUsers = body['users'];
  if (
    typeof multiplier !== 'number' ||
    !Number.isFinite(multiplier) ||
    multiplier <= 0 ||
    multiplier > 10 ||
    Math.round(multiplier * 10000) !== multiplier * 10000 ||
    !Array.isArray(rawUsers)
  ) {
    throw new ApiError(400, 'Enter a valid accrual multiplier and user hours.');
  }

  const userSettings = rawUsers.map((value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new ApiError(400, 'Invalid user contracted hours.');
    }
    const item = value as Record<string, unknown>;
    const userId = item['userId'];
    const hours = item['contractedHoursPerCycle'];
    if (
      typeof userId !== 'string' ||
      !UUID_PATTERN.test(userId) ||
      (hours !== null &&
        (typeof hours !== 'number' ||
          !Number.isFinite(hours) ||
          hours < 0 ||
          hours > MAX_HOURS_PER_CYCLE ||
          Math.round(hours * 100) !== hours * 100))
    ) {
      throw new ApiError(400, 'Enter valid contracted hours for each user.');
    }
    return { userId, hours };
  });
  if (new Set(userSettings.map(({ userId }) => userId)).size !== userSettings.length) {
    throw new ApiError(400, 'Each user may only appear once in TOIL settings.');
  }

  const users = await User.findAll({
    attributes: ['id'],
    where: { id: userSettings.map(({ userId }) => userId) },
  });
  if (users.length !== userSettings.length) {
    throw new ApiError(400, 'One or more selected users no longer exist.');
  }

  const transaction = await sequelize.transaction();
  try {
    const [policy] = await ClockItToilPolicy.findOrCreate({
      where: { id: POLICY_ID },
      defaults: { id: POLICY_ID, accrualMultiplier: 1 },
      transaction,
    });
    await policy.update({ accrualMultiplier: multiplier }, { transaction });
    for (const { userId, hours } of userSettings) {
      if (hours === null) {
        await ClockItUserToilContract.destroy({ where: { userId }, transaction });
      } else {
        await ClockItUserToilContract.upsert(
          { userId, contractedHoursPerCycle: hours },
          { transaction },
        );
      }
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  res.json({ message: 'TOIL settings saved.' });
});

export const createToilUsage = asyncHandler(async (req: Request, res: Response) => {
  const rawBody: unknown = req.body;
  if (typeof rawBody !== 'object' || rawBody === null || Array.isArray(rawBody)) {
    throw new ApiError(400, 'Invalid TOIL usage record.');
  }
  const body = rawBody as Record<string, unknown>;
  const userId = body['userId'];
  const usageDate = body['usageDate'];
  const hours = body['hours'];
  const reason = body['reason'] ?? '';
  if (
    typeof userId !== 'string' ||
    !UUID_PATTERN.test(userId) ||
    typeof usageDate !== 'string' ||
    !isDate(usageDate) ||
    typeof hours !== 'number' ||
    !Number.isFinite(hours) ||
    hours <= 0 ||
    hours > MAX_HOURS_PER_CYCLE ||
    Math.round(hours * 100) !== hours * 100 ||
    typeof reason !== 'string' ||
    reason.length > 500
  ) {
    throw new ApiError(400, 'Enter a user, valid date, and TOIL hours greater than zero.');
  }
  const user = await User.findByPk(userId, { attributes: ['id', 'name'] });
  if (!user) {
    throw new ApiError(404, 'User not found.');
  }
  const usage = await ClockItToilUsage.create({
    userId,
    usageDate,
    hours,
    reason: reason.trim() || null,
    recordedBy: req.user!.id,
  });
  res.status(201).json({
    usage: {
      id: usage.id,
      userId,
      userName: user.name,
      usageDate,
      hours: Number(usage.hours),
      reason: usage.reason,
      recordedBy: usage.recordedBy,
      createdAt: usage.createdAt,
    },
  });
});

export const deleteToilUsage = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params['id'];
  if (!id || !UUID_PATTERN.test(id)) {
    throw new ApiError(400, 'Invalid TOIL usage ID.');
  }
  const usage = await ClockItToilUsage.findByPk(id);
  if (!usage) {
    throw new ApiError(404, 'TOIL usage record not found.');
  }
  await usage.destroy();
  res.status(204).end();
});

function parseDateRange(
  rawStart: unknown,
  rawEnd: unknown,
): { startDate: string | null; endDate: string | null } {
  if (rawStart === undefined && rawEnd === undefined) {
    return { startDate: null, endDate: null };
  }
  if (
    typeof rawStart !== 'string' ||
    typeof rawEnd !== 'string' ||
    !isDate(rawStart) ||
    !isDate(rawEnd)
  ) {
    throw new ApiError(400, 'TOIL report dates must be valid YYYY-MM-DD values.');
  }
  if (rawStart > rawEnd) {
    throw new ApiError(400, 'TOIL report start date must be before its end date.');
  }
  return { startDate: rawStart, endDate: rawEnd };
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && DateTime.fromISO(value, { zone: 'UTC' }).isValid;
}
