import { strToU8, zipSync } from 'fflate';
import { DateTime } from 'luxon';
import nodemailer from 'nodemailer';
import { Op } from 'sequelize';
import { env } from '../config/env';
import { Project, Task, TimeEntry, User } from '../models';
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
  const workbook = await buildReportWorkbook(entries, period, timezone);
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
): Promise<Buffer> {
  const userTotals = new Map<string, { name: string; seconds: Record<PayType, number> }>();
  const now = Date.now();
  for (const entry of entries) {
    const userName = entry.user?.name ?? '';
    const user = userTotals.get(entry.userId) ?? {
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
  const activeTypes = PAY_TYPE_ORDER.filter((type) => totals[type] > 0);
  const summaryRows: (string | number)[][] = [
    ['Report period', period.startDate, period.endDate],
    [],
    ['Name', 'Total Paid Hours', ...activeTypes.map((type) => PAY_TYPE_LABELS[type])],
  ];
  for (const user of sortedUsers) {
    summaryRows.push([
      safeText(user.name),
      paidTypes.reduce((sum, type) => sum + user.seconds[type], 0) / 3600,
      ...activeTypes.map((type) => user.seconds[type] / 3600),
    ]);
  }
  summaryRows.push([
    'All users',
    paidTypes.reduce((sum, type) => sum + totals[type], 0) / 3600,
    ...activeTypes.map((type) => totals[type] / 3600),
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
          '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
          '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
          '<fill><patternFill patternType="gray125"/></fill></fills>' +
          '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
          '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
          '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
          '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
          '</styleSheet>',
      ),
      'xl/worksheets/sheet1.xml': strToU8(worksheetXml(summaryRows)),
      'xl/worksheets/sheet2.xml': strToU8(worksheetXml(detailRows)),
    }),
  );
}

function worksheetXml(rows: (string | number)[][]): string {
  const rowXml = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((value, columnIndex) => cellXml(value, `${columnName(columnIndex + 1)}${rowIndex + 1}`))
          .join('')}</row>`,
    )
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${rowXml}</sheetData></worksheet>`
  );
}

function cellXml(value: string | number, reference: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${reference}" s="1"><v>${value}</v></c>`;
  }
  const text = escapeXml(String(value)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
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
