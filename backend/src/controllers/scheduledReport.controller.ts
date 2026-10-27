import { DateTime } from 'luxon';
import { Request, Response } from 'express';
import { User, ScheduledReportConfig, ScheduledReportDelivery } from '../models';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import {
  DEFAULT_REPORT_TIME,
  DEFAULT_REPORT_TIMEZONE,
  DEFAULT_REPORT_WEEKDAY,
  DEFAULT_FREQUENCY_INTERVAL,
  DEFAULT_FREQUENCY_UNIT,
  DEFAULT_REPORT_PERIOD_DAYS,
  reportPeriod,
  sendScheduledReportEmail,
  smtpConfigured,
} from '../services/scheduledReportEmail';

const CONFIG_ID = 'fortnightly';
const UUID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

export const getScheduledReportSettings = asyncHandler(async (_req: Request, res: Response) => {
  const config = await ScheduledReportConfig.findByPk(CONFIG_ID);
  const latestDelivery = await ScheduledReportDelivery.findOne({
    order: [['createdAt', 'DESC']],
  });
  const users = await User.findAll({
    attributes: ['id', 'name', 'email', 'role'],
    order: [['name', 'ASC']],
  });
  res.json({
    config: config
      ? {
          startDate: config.startDate,
          frequencyUnit: config.frequencyUnit,
          frequencyInterval: config.frequencyInterval,
          reportPeriodDays: config.reportPeriodDays,
          sendWeekday: config.sendWeekday,
          sendTime: config.sendTime,
          timezone: config.timezone,
          includeAllUsers: config.includeAllUsers,
          includedUserIds: config.includedUserIds,
          recipientUserIds: config.recipientUserIds,
          enabled: config.enabled,
        }
      : {
          startDate: null,
          frequencyUnit: DEFAULT_FREQUENCY_UNIT,
          frequencyInterval: DEFAULT_FREQUENCY_INTERVAL,
          reportPeriodDays: DEFAULT_REPORT_PERIOD_DAYS,
          sendWeekday: DEFAULT_REPORT_WEEKDAY,
          sendTime: DEFAULT_REPORT_TIME,
          timezone: DEFAULT_REPORT_TIMEZONE,
          includeAllUsers: true,
          includedUserIds: [],
          recipientUserIds: [],
          enabled: false,
        },
    users,
    smtpConfigured: smtpConfigured(),
    latestDelivery: latestDelivery
      ? {
          status: latestDelivery.status,
          periodStart: latestDelivery.periodStart,
          sentAt: latestDelivery.sentAt,
          errorMessage: latestDelivery.errorMessage,
        }
      : null,
  });
});

export const updateScheduledReportSettings = asyncHandler(
  async (req: Request, res: Response) => {
    const rawBody: unknown = req.body;
    if (typeof rawBody !== 'object' || rawBody === null || Array.isArray(rawBody)) {
      throw new ApiError(400, 'Invalid scheduled report settings.');
    }
    const body = rawBody as Record<string, unknown>;
    const startDate = body['startDate'];
    const frequencyUnit = body['frequencyUnit'];
    const frequencyInterval = body['frequencyInterval'];
    const reportPeriodDays = body['reportPeriodDays'];
    const sendWeekday = body['sendWeekday'];
    const sendTime = body['sendTime'];
    const timezone = body['timezone'];
    const includeAllUsers = body['includeAllUsers'];
    const includedUserIds = body['includedUserIds'];
    const recipientUserIds = body['recipientUserIds'];
    const enabled = body['enabled'];
    const validIncludedUserIds = Array.isArray(includedUserIds)
      ? includedUserIds.filter(
          (id): id is string => typeof id === 'string' && UUID_PATTERN.test(id),
        )
      : [];
    const includedUserIdsAreValid =
      Array.isArray(includedUserIds) && validIncludedUserIds.length === includedUserIds.length;

    if (
      (startDate !== null &&
        (typeof startDate !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
          !DateTime.fromISO(startDate, { zone: 'UTC' }).isValid)) ||
      (frequencyUnit !== 'days' && frequencyUnit !== 'weeks') ||
      typeof frequencyInterval !== 'number' ||
      !Number.isInteger(frequencyInterval) ||
      frequencyInterval < 1 ||
      frequencyInterval > (frequencyUnit === 'weeks' ? 52 : 366) ||
      typeof reportPeriodDays !== 'number' ||
      !Number.isInteger(reportPeriodDays) ||
      reportPeriodDays < 1 ||
      reportPeriodDays > 366 ||
      typeof sendWeekday !== 'number' ||
      !Number.isInteger(sendWeekday) ||
      sendWeekday < 0 ||
      sendWeekday > 6 ||
      typeof sendTime !== 'string' ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(sendTime) ||
      typeof timezone !== 'string' ||
      timezone.length > 64 ||
      !DateTime.now().setZone(timezone).isValid ||
      typeof includeAllUsers !== 'boolean' ||
      !Array.isArray(includedUserIds) ||
      (includeAllUsers === false && !includedUserIdsAreValid) ||
      !Array.isArray(recipientUserIds) ||
      !recipientUserIds.every((id): id is string => typeof id === 'string' && UUID_PATTERN.test(id)) ||
      typeof enabled !== 'boolean'
    ) {
      throw new ApiError(400, 'Invalid scheduled report settings.');
    }
    if (enabled && (!startDate || !recipientUserIds.length)) {
      throw new ApiError(400, 'Set a report start date and at least one recipient before enabling.');
    }
    if (enabled && !includeAllUsers && !includedUserIds.length) {
      throw new ApiError(400, 'Select at least one user to include in the report.');
    }
    if (enabled && !smtpConfigured()) {
      throw new ApiError(400, 'Configure SMTP in StoreIt backend/.env before enabling email delivery.');
    }

    const uniqueRecipientIds = [...new Set(recipientUserIds)];
    const uniqueIncludedIds = includeAllUsers ? [] : [...new Set(validIncludedUserIds)];
    const userIdsToValidate = [...new Set([...uniqueRecipientIds, ...uniqueIncludedIds])];
    const matchingUsers = await User.findAll({
      attributes: ['id'],
      where: { id: userIdsToValidate },
    });
    if (matchingUsers.length !== userIdsToValidate.length) {
      throw new ApiError(400, 'One or more selected users no longer exist.');
    }

    const [config] = await ScheduledReportConfig.findOrCreate({
      where: { id: CONFIG_ID },
      defaults: {
        id: CONFIG_ID,
        startDate: null,
        frequencyUnit: DEFAULT_FREQUENCY_UNIT,
        frequencyInterval: DEFAULT_FREQUENCY_INTERVAL,
        reportPeriodDays: DEFAULT_REPORT_PERIOD_DAYS,
        sendWeekday: DEFAULT_REPORT_WEEKDAY,
        sendTime: DEFAULT_REPORT_TIME,
        timezone: DEFAULT_REPORT_TIMEZONE,
        includeAllUsers: true,
        includedUserIds: [],
        recipientUserIds: [],
        enabled: false,
      },
    });
    await config.update({
      startDate: startDate as string | null,
      frequencyUnit,
      frequencyInterval,
      reportPeriodDays,
      sendWeekday,
      sendTime,
      timezone,
      includeAllUsers,
      includedUserIds: uniqueIncludedIds,
      recipientUserIds: uniqueRecipientIds,
      enabled,
    });
    res.json({
      config: {
        startDate: config.startDate,
        frequencyUnit: config.frequencyUnit,
        frequencyInterval: config.frequencyInterval,
        reportPeriodDays: config.reportPeriodDays,
        sendWeekday: config.sendWeekday,
        sendTime: config.sendTime,
        timezone: config.timezone,
        includeAllUsers: config.includeAllUsers,
        includedUserIds: config.includedUserIds,
        recipientUserIds: config.recipientUserIds,
        enabled: config.enabled,
      },
      smtpConfigured: smtpConfigured(),
    });
  },
);

export const sendScheduledReportTest = asyncHandler(async (_req: Request, res: Response) => {
  const config = await ScheduledReportConfig.findByPk(CONFIG_ID);
  if (!config?.startDate) {
    throw new ApiError(400, 'Save a report start date before sending a test workbook.');
  }
  if (!smtpConfigured()) {
    throw new ApiError(400, 'Configure SMTP in StoreIt backend/.env before sending test email.');
  }
  const recipients = await User.findAll({
    attributes: ['id', 'name', 'email'],
    where: { id: config.recipientUserIds },
    order: [['name', 'ASC']],
  });
  if (!recipients.length) {
    throw new ApiError(400, 'Select at least one recipient before sending a test email.');
  }

  const period = reportPeriod(config.startDate, config.reportPeriodDays, config.timezone);
  await sendScheduledReportEmail(
    period,
    config.timezone,
    recipients,
    config.includeAllUsers ? null : config.includedUserIds,
    true,
  );
  res.json({ message: `Test workbook sent to ${recipients.length} recipient(s).` });
});
