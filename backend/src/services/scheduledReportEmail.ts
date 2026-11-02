import { strToU8, zipSync } from 'fflate';
import { DateTime } from 'luxon';
import nodemailer from 'nodemailer';
import { Op } from 'sequelize';
import { env } from '../config/env';
import {
  ClockItToilPolicy,
  ClockItToilUsage,
  ClockItUserToilContract,
  Project,
  ScheduledReportConfig,
  Task,
  TimeEntry,
  User,
} from '../models';
import type { PayType } from '../models/Task';

export const DEFAULT_REPORT_TIMEZONE = 'Australia/Brisbane';
export const DEFAULT_REPORT_WEEKDAY = 2;
export const DEFAULT_REPORT_TIME = '13:00';
export const DEFAULT_FREQUENCY_UNIT = 'weeks' as const;
export const DEFAULT_FREQUENCY_INTERVAL = 2;
export const DEFAULT_REPORT_PERIOD_DAYS = 14;
export const PAY_TYPE_LABELS: Record<PayType, string> = {
  hourly: 'Hourly Wage',
  'public-holiday': 'Public Holiday',
  'annual-leave': 'Annual Leave',
  'sick-leave': 'Sick Leave',
  unpaid: 'Unpaid',
};
const PAY_TYPE_ORDER: PayType[] = [
  'hourly',
  'public-holiday',
  'annual-leave',
  'sick-leave',
  'unpaid',
];

interface ToilReportSettings {
  accrualMultiplier: number;
  payCycle: { startDate: string | null; periodDays: number };
  users: { id: string; name: string; contractedHoursPerCycle: number | null }[];
  usages: { userId: string; usageDate: string; hours: number }[];
}

export interface ReportEmailRecipient {
  id: string;
  name: string;
  email: string;
}

export interface ScheduledReportPeriod {
  startDate: string;
  endDate: string;
  start: Date;
  endExclusive: Date;
}

export function smtpConfigured(): boolean {
  return Boolean(
    env.smtp.host &&
      env.smtp.port > 0 &&
      env.smtp.user &&
      env.smtp.password &&
      env.smtp.from,
  );
}

export function reportPeriod(
  startDate: string,
  periodDays: number,
  timezone: string,
): ScheduledReportPeriod {
  if (!Number.isInteger(periodDays) || periodDays < 1) {
    throw new Error(`Report period must be a positive number of days: ${periodDays}`);
  }
  const start = DateTime.fromISO(startDate, { zone: timezone }).startOf('day');
  if (!start.isValid) {
    throw new Error(`Invalid report start date or timezone: ${startDate}, ${timezone}`);
  }
  const endExclusive = start.plus({ days: periodDays });
  return {
    startDate: start.toISODate()!,
    endDate: endExclusive.minus({ days: 1 }).toISODate()!,
    start: start.toUTC().toJSDate(),
    endExclusive: endExclusive.toUTC().toJSDate(),
  };
}

export function scheduledDeliveryDate(
  periodStart: string,
  periodDays: number,
  weekday: number,
  time: string,
  timezone: string,
): DateTime {
  const periodEnd = DateTime.fromISO(periodStart, { zone: timezone })
    .startOf('day')
    .plus({ days: periodDays - 1 });
  const dayAfterPeriod = periodEnd.plus({ days: 1 });
  const daysUntilDelivery = (weekday - (dayAfterPeriod.weekday % 7) + 7) % 7;
  const [hour, minute] = time.split(':').map(Number);
  return dayAfterPeriod.plus({ days: daysUntilDelivery }).set({ hour, minute, second: 0, millisecond: 0 });
}

export async function loadPeriodEntries(
  period: ScheduledReportPeriod,
  includedUserIds: string[] | null,
) {
  return TimeEntry.findAll({
    where: {
      startTime: {
        [Op.gte]: period.start,
        [Op.lt]: period.endExclusive,
      },
      ...(includedUserIds === null ? {} : { userId: { [Op.in]: includedUserIds } }),
    },
    include: [
      { model: User, as: 'user', attributes: ['id', 'name'], required: true },
      { model: Task, as: 'task', attributes: ['id', 'name', 'payType'], required: false },
      {
        model: Project,
        as: 'project',
        attributes: ['id', 'name', 'projectNumber'],
        required: false,
      },
    ],
    order: [['startTime', 'ASC']],
  });
}

export async function sendScheduledReportEmail(
  period: ScheduledReportPeriod,
  timezone: string,
  recipients: ReportEmailRecipient[],
  includedUserIds: string[] | null,
  isTest = false,
): Promise<void> {
  if (!smtpConfigured()) {
    throw new Error('SMTP is not configured. Set the SMTP_* variables in StoreIt backend/.env.');
  }
  if (!recipients.length) {
    throw new Error('At least one report recipient is required.');
  }

  const entries = await loadPeriodEntries(period, includedUserIds);
  const toilSettings = await loadToilReportSettings(period, includedUserIds);
  const workbook = await buildReportWorkbook(entries, period, timezone, toilSettings);
  const transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    auth: { user: env.smtp.user, pass: env.smtp.password },
  });
  const label = isTest ? 'TEST - ' : '';
  await transporter.sendMail({
    from: env.smtp.from,
    to: 'undisclosed-recipients:;',
    bcc: recipients.map((recipient) => recipient.email),
    subject: `${label}ClockIt scheduled report: ${period.startDate} to ${period.endDate}`,
    text:
      `${isTest ? 'This is a test email. ' : ''}` +
      `Attached is the ClockIt report for ${period.startDate} to ${period.endDate}.`,
    attachments: [
      {
        filename: `clockit-report_${period.startDate}_to_${period.endDate}.xlsx`,
        content: workbook,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    ],
  });
}

export async function buildReportWorkbook(
  entries: TimeEntry[],
  period: ScheduledReportPeriod,
  timezone: string,
  toilSettings?: ToilReportSettings,
): Promise<Buffer> {
  const userTotals = new Map<
    string,
    { id: string; name: string; seconds: Record<PayType, number> }
  >();
  const now = Date.now();
  for (const entry of entries) {
    const userName = entry.user?.name ?? '';
    const user = userTotals.get(entry.userId) ?? {
      id: entry.userId,
      name: userName,
      seconds: Object.fromEntries(PAY_TYPE_ORDER.map((type) => [type, 0])) as Record<
        PayType,
        number
      >,
    };
    const payType = isPayType(entry.task?.payType) ? entry.task.payType : 'hourly';
    user.seconds[payType] += durationSeconds(entry, now);
    userTotals.set(entry.userId, user);
  }

  if (toilSettings) {
    for (const usage of toilSettings.usages) {
      if (userTotals.has(usage.userId)) {
        continue;
      }
      const user = toilSettings.users.find((item) => item.id === usage.userId);
      if (user) {
        userTotals.set(user.id, {
          id: user.id,
          name: user.name,
          seconds: Object.fromEntries(PAY_TYPE_ORDER.map((type) => [type, 0])) as Record<
            PayType,
            number
          >,
        });
      }
    }
  }
  const sortedUsers = [...userTotals.values()].sort((a, b) => a.name.localeCompare(b.name));
  const totals = Object.fromEntries(PAY_TYPE_ORDER.map((type) => [type, 0])) as Record<
    PayType,
    number
  >;
  for (const user of sortedUsers) {
    for (const payType of PAY_TYPE_ORDER) {
      totals[payType] += user.seconds[payType];
    }
  }
  const paidTypes: PayType[] = ['hourly', 'public-holiday', 'annual-leave', 'sick-leave'];
  const toilTotals = toilSettings
    ? calculateToilTotals(entries, userTotals, period, timezone, toilSettings, now)
    : null;
  const summaryRows: (string | number)[][] = [
    ['Report period', period.startDate, period.endDate],
    [],
    [
      'Name',
      'Total Paid Hours',
      'TOIL Accrued',
      'TOIL Used',
      ...PAY_TYPE_ORDER.map((type) => PAY_TYPE_LABELS[type]),
    ],
  ];
  for (const user of sortedUsers) {
    summaryRows.push([
      safeText(user.name),
      paidTypes.reduce((sum, type) => sum + user.seconds[type], 0) / 3600,
      ...(toilTotals
        ? [toilTotals.accruedHours.get(user.id) ?? 0, toilTotals.usedHours.get(user.id) ?? 0]
        : ['', '']),
      ...PAY_TYPE_ORDER.map((type) => user.seconds[type] / 3600),
    ]);
  }
  summaryRows.push([
    'All users',
    paidTypes.reduce((sum, type) => sum + totals[type], 0) / 3600,
    ...(toilTotals
      ? [
          [...toilTotals.accruedHours.values()].reduce((sum, hours) => sum + hours, 0),
          [...toilTotals.usedHours.values()].reduce((sum, hours) => sum + hours, 0),
        ]
      : ['', '']),
    ...PAY_TYPE_ORDER.map((type) => totals[type] / 3600),
  ]);

  const detailRows: (string | number)[][] = [[
    'Date',
    'Start time',
    'End time',
    'Start timestamp (ISO)',
    'End timestamp (ISO)',
    'User',
    'Project number',
    'Project',
    'Task',
    'Description',
    'Billable',
    'Duration (hh:mm:ss)',
    'Duration (hours)',
  ]];
  for (const entry of entries) {
    const seconds = durationSeconds(entry, now);
    const startDateTime = DateTime.fromJSDate(entry.startTime).setZone(timezone);
    const endDateTime = entry.endTime
      ? DateTime.fromJSDate(entry.endTime).setZone(timezone)
      : null;
    detailRows.push([
      startDateTime.toISODate() ?? '',
      startDateTime.toFormat('HH:mm'),
      endDateTime?.toFormat('HH:mm') ?? '',
      entry.startTime.toISOString(),
      entry.endTime?.toISOString() ?? '',
      safeText(entry.user?.name ?? ''),
      safeText(entry.project?.projectNumber ?? ''),
      safeText(entry.project?.name ?? ''),
      safeText(entry.task?.name ?? ''),
      safeText(entry.description ?? ''),
      entry.isBillable ? 'Yes' : 'No',
      formatDuration(seconds),
      seconds / 3600,
    ]);
  }

  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '</Types>',
      ),
      '_rels/.rels': strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>',
      ),
      'xl/workbook.xml': strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets><sheet name="Page 1 - User Summary" sheetId="1" r:id="rId1"/>' +
          '<sheet name="Page 2 - Entry Details" sheetId="2" r:id="rId2"/></sheets></workbook>',
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
          '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          '</Relationships>',
      ),
      'xl/styles.xml': strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
          '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.00"/></numFmts>' +
          '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
          '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
          '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
          '<fill><patternFill patternType="gray125"/></fill></fills>' +
          '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
          '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
          '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
          '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
          '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/>' +
          '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
          '</styleSheet>',
      ),
      'xl/worksheets/sheet1.xml': strToU8(
        worksheetXml(summaryRows, [1], [summaryRows.length - 1], 2),
      ),
      'xl/worksheets/sheet2.xml': strToU8(worksheetXml(detailRows)),
    }),
  );
}

async function loadToilReportSettings(
  period: ScheduledReportPeriod,
  includedUserIds: string[] | null,
): Promise<ToilReportSettings> {
  const [policy, schedule, contracts, usageRows, users] = await Promise.all([
    ClockItToilPolicy.findByPk('default'),
    ScheduledReportConfig.findByPk('fortnightly'),
    ClockItUserToilContract.findAll(),
    ClockItToilUsage.findAll({
      where: {
        usageDate: { [Op.gte]: period.startDate, [Op.lte]: period.endDate },
        ...(includedUserIds === null ? {} : { userId: { [Op.in]: includedUserIds } }),
      },
    }),
    User.findAll({
      attributes: ['id', 'name'],
      ...(includedUserIds === null ? {} : { where: { id: { [Op.in]: includedUserIds } } }),
    }),
  ]);
  if (!schedule?.startDate) {
    throw new Error(
      'TOIL cannot be calculated for the scheduled report: set the first reporting date in ClockIt Notifications.',
    );
  }
  const contractsByUserId = new Map(
    contracts.map((contract) => [
      contract.userId,
      Number(contract.contractedHoursPerCycle),
    ]),
  );
  return {
    accrualMultiplier: Number(policy?.accrualMultiplier ?? 1),
    payCycle: {
      startDate: schedule.startDate,
      periodDays: schedule.reportPeriodDays,
    },
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      contractedHoursPerCycle: contractsByUserId.get(user.id) ?? null,
    })),
    usages: usageRows.map((usage) => ({
      userId: usage.userId,
      usageDate: usage.usageDate,
      hours: Number(usage.hours),
    })),
  };
}

function calculateToilTotals(
  entries: TimeEntry[],
  users: Map<string, { id: string; name: string; seconds: Record<PayType, number> }>,
  period: ScheduledReportPeriod,
  timezone: string,
  settings: ToilReportSettings,
  now: number,
): { accruedHours: Map<string, number>; usedHours: Map<string, number> } {
  const anchor = settings.payCycle.startDate;
  const cycleDays = settings.payCycle.periodDays;
  if (!anchor || !Number.isInteger(cycleDays) || cycleDays < 1) {
    throw new Error('TOIL cannot be calculated: the reporting cycle settings are incomplete.');
  }
  const contracts = new Map(
    settings.users.map((user) => [user.id, user.contractedHoursPerCycle]),
  );
  const hoursByUserDate = new Map<string, number>();
  for (const entry of entries) {
    if (isPayType(entry.task?.payType) && entry.task?.payType !== 'hourly') {
      continue;
    }
    const date = DateTime.fromJSDate(entry.startTime).setZone(timezone).toISODate();
    if (!date) {
      continue;
    }
    const key = `${entry.userId}:${date}`;
    hoursByUserDate.set(key, (hoursByUserDate.get(key) ?? 0) + durationSeconds(entry, now) / 3600);
  }

  const accruedHours = new Map<string, number>();
  const usedHours = new Map<string, number>();
  for (const [userId, user] of users) {
    if (user.seconds.hourly > 0 && contracts.get(userId) == null) {
      throw new Error(
        `TOIL cannot be calculated: set contracted hours for ${user.name} in ClockIt Admin Settings.`,
      );
    }
    let accrued = 0;
    const contract = contracts.get(userId);
    if (contract !== null && contract !== undefined) {
      for (const segment of payCycleSegments(
        period.startDate,
        period.endDate,
        anchor,
        cycleDays,
      )) {
        let workedHours = 0;
        for (const [key, hours] of hoursByUserDate) {
          if (key.startsWith(`${userId}:`)) {
            const date = key.slice(userId.length + 1);
            if (date >= segment.start && date <= segment.end) {
              workedHours += hours;
            }
          }
        }
        accrued +=
          Math.max(0, workedHours - contract * (segment.days / cycleDays)) *
          settings.accrualMultiplier;
      }
    }
    accruedHours.set(userId, Math.round(accrued * 100) / 100);
  }
  for (const usage of settings.usages) {
    usedHours.set(
      usage.userId,
      (usedHours.get(usage.userId) ?? 0) + usage.hours,
    );
  }
  return { accruedHours, usedHours };
}

function payCycleSegments(
  startDate: string,
  endDate: string,
  anchor: string,
  cycleDays: number,
): { start: string; end: string; days: number }[] {
  const dayMs = 86_400_000;
  const toMillis = (date: string) => Date.parse(`${date}T00:00:00Z`);
  const start = toMillis(startDate);
  const end = toMillis(endDate);
  const anchorValue = toMillis(anchor);
  let cycleStart =
    anchorValue +
    Math.floor((start - anchorValue) / (cycleDays * dayMs)) * cycleDays * dayMs;
  const segments: { start: string; end: string; days: number }[] = [];
  while (cycleStart <= end) {
    const cycleEnd = cycleStart + (cycleDays - 1) * dayMs;
    const segmentStart = Math.max(start, cycleStart);
    const segmentEnd = Math.min(end, cycleEnd);
    if (segmentStart <= segmentEnd) {
      segments.push({
        start: new Date(segmentStart).toISOString().slice(0, 10),
        end: new Date(segmentEnd).toISOString().slice(0, 10),
        days: Math.floor((segmentEnd - segmentStart) / dayMs) + 1,
      });
    }
    cycleStart += cycleDays * dayMs;
  }
  return segments;
}

function worksheetXml(
  rows: (string | number)[][],
  boldColumns: number[] = [],
  boldRows: number[] = [],
  boldColumnsFromRow = 0,
): string {
  const rowXml = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((value, columnIndex) =>
            cellXml(
              value,
              `${columnName(columnIndex + 1)}${rowIndex + 1}`,
              (rowIndex >= boldColumnsFromRow && boldColumns.includes(columnIndex)) ||
                boldRows.includes(rowIndex),
            ),
          )
          .join('')}</row>`,
    )
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${rowXml}</sheetData></worksheet>`
  );
}

function cellXml(value: string | number, reference: string, bold = false): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${reference}" s="${bold ? 3 : 1}"><v>${value}</v></c>`;
  }
  const style = bold ? ' s="2"' : '';
  const text = escapeXml(String(value)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  return `<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function columnName(index: number): string {
  let column = '';
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) {
    column = String.fromCharCode(((value - 1) % 26) + 65) + column;
  }
  return column;
}

function isPayType(value: unknown): value is PayType {
  return typeof value === 'string' && PAY_TYPE_ORDER.includes(value as PayType);
}

function durationSeconds(entry: TimeEntry, now: number): number {
  const start = new Date(entry.startTime).getTime();
  const duration =
    entry.endTime !== null
      ? (entry.durationSeconds ?? Math.round((new Date(entry.endTime).getTime() - start) / 1000))
      : Math.round((now - start) / 1000);
  return Math.max(0, duration);
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
