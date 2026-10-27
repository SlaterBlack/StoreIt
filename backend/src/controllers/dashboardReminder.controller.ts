import { DateTime } from 'luxon';
import { Request, Response } from 'express';
import { DashboardReminder } from '../models';
import type { DashboardReminderAttributes } from '../models/DashboardReminder';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';

interface DashboardReminderInput {
  text: string;
  startDate: string;
  frequencyUnit: 'days' | 'weeks';
  frequencyInterval: number;
  weekdays: number[];
  startTime: string;
  endTime: string;
  timezone: string;
  enabled: boolean;
}

const UUID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

export const listDashboardReminders = asyncHandler(
  async (_req: Request, res: Response) => {
    const reminders = await DashboardReminder.findAll({
      order: [['createdAt', 'ASC']],
    });
    res.json({ reminders });
  },
);

export const listActiveDashboardReminders = asyncHandler(
  async (_req: Request, res: Response) => {
    const now = new Date();
    const reminders = await DashboardReminder.findAll({
      where: { enabled: true },
    });
    res.json({
      reminders: reminders
        .filter((reminder) => isDashboardReminderActive(reminder, now))
        .map(({ id, text }) => ({ id, text })),
    });
  },
);

export const createDashboardReminder = asyncHandler(
  async (req: Request, res: Response) => {
    const input = validateReminderInput(req.body);
    const reminder = await DashboardReminder.create(input);
    res.status(201).json({ reminder });
  },
);

export const updateDashboardReminder = asyncHandler(
  async (req: Request, res: Response) => {
    if (!UUID_PATTERN.test(req.params.id)) {
      throw new ApiError(400, 'Reminder ID must be a valid UUID.');
    }
    const input = validateReminderInput(req.body);
    const reminder = await DashboardReminder.findByPk(req.params.id);
    if (!reminder) {
      throw new ApiError(404, 'Reminder not found.');
    }
    await reminder.update(input);
    res.json({ reminder });
  },
);

export const deleteDashboardReminder = asyncHandler(
  async (req: Request, res: Response) => {
    if (!UUID_PATTERN.test(req.params.id)) {
      throw new ApiError(400, 'Reminder ID must be a valid UUID.');
    }
    const deleted = await DashboardReminder.destroy({
      where: { id: req.params.id },
    });
    if (!deleted) {
      throw new ApiError(404, 'Reminder not found.');
    }
    res.status(204).send();
  },
);

function validateReminderInput(body: unknown): DashboardReminderInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'Invalid reminder settings.');
  }
  const input = body as Record<string, unknown>;
  const text = input['text'];
  const startDate = input['startDate'];
  const frequencyUnit = input['frequencyUnit'];
  const frequencyInterval = input['frequencyInterval'];
  const weekdays = input['weekdays'];
  const startTime = input['startTime'];
  const endTime = input['endTime'];
  const timezone = input['timezone'];
  const enabled = input['enabled'];

  if (
    typeof text !== 'string' ||
    !text.trim() ||
    text.trim().length > 500 ||
    typeof startDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    !DateTime.fromISO(startDate, { zone: 'UTC' }).isValid ||
    (frequencyUnit !== 'days' && frequencyUnit !== 'weeks') ||
    typeof frequencyInterval !== 'number' ||
    !Number.isInteger(frequencyInterval) ||
    frequencyInterval < 1 ||
    frequencyInterval > (frequencyUnit === 'weeks' ? 52 : 366) ||
    !Array.isArray(weekdays) ||
    !weekdays.every(
      (day): day is number =>
        typeof day === 'number' &&
        Number.isInteger(day) &&
        day >= 0 &&
        day <= 6,
    ) ||
    (frequencyUnit === 'weeks' && weekdays.length === 0) ||
    typeof startTime !== 'string' ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
    typeof endTime !== 'string' ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) ||
    startTime === endTime ||
    typeof timezone !== 'string' ||
    timezone.length > 64 ||
    !DateTime.now().setZone(timezone).isValid ||
    typeof enabled !== 'boolean'
  ) {
    throw new ApiError(
      400,
      'Enter reminder text, at least one day, a valid time range, and time zone.',
    );
  }

  return {
    text: text.trim(),
    startDate,
    frequencyUnit,
    frequencyInterval,
    weekdays: [...new Set(weekdays)].sort((a, b) => a - b),
    startTime,
    endTime,
    timezone,
    enabled,
  };
}

export function isDashboardReminderActive(
  reminder: Pick<
    DashboardReminderAttributes,
    | 'startDate'
    | 'frequencyUnit'
    | 'frequencyInterval'
    | 'weekdays'
    | 'startTime'
    | 'endTime'
    | 'timezone'
  >,
  currentDate: Date,
): boolean {
  const now = DateTime.fromJSDate(currentDate, { zone: reminder.timezone });
  if (!now.isValid) {
    return false;
  }
  const currentMinute = now.hour * 60 + now.minute;
  const startMinute = timeToMinutes(reminder.startTime);
  const endMinute = timeToMinutes(reminder.endTime);

  if (startMinute < endMinute) {
    return (
      isScheduledDate(reminder, now) &&
      currentMinute >= startMinute &&
      currentMinute < endMinute
    );
  }

  return (
    (isScheduledDate(reminder, now) && currentMinute >= startMinute) ||
    (isScheduledDate(reminder, now.minus({ days: 1 })) &&
      currentMinute < endMinute)
  );
}

function isScheduledDate(
  reminder: Pick<
    DashboardReminderAttributes,
    'startDate' | 'frequencyUnit' | 'frequencyInterval' | 'weekdays'
  >,
  date: DateTime,
): boolean {
  const anchorDate = DateTime.fromISO(reminder.startDate, { zone: 'UTC' });
  const currentDate = DateTime.fromObject(
    { year: date.year, month: date.month, day: date.day },
    { zone: 'UTC' },
  );
  const daysFromStart = currentDate.diff(anchorDate, 'days').days;
  if (!Number.isInteger(daysFromStart) || daysFromStart < 0) {
    return false;
  }

  if (reminder.frequencyUnit === 'days') {
    return daysFromStart % reminder.frequencyInterval === 0;
  }

  const weekIndex = Math.floor(daysFromStart / 7);
  return (
    weekIndex % reminder.frequencyInterval === 0 &&
    reminder.weekdays.includes(date.weekday % 7)
  );
}

function timeToMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}
