import { DateTime } from 'luxon';
import { ScheduledReportConfig, ScheduledReportDelivery, User } from '../models';
import {
  reportPeriod,
  scheduledDeliveryDate,
  sendScheduledReportEmail,
  smtpConfigured,
} from './scheduledReportEmail';

const CONFIG_ID = 'fortnightly';
const CHECK_INTERVAL_MS = 60_000;
const RETRY_INTERVAL_MS = 60 * 60_000;
let isChecking = false;

export function startScheduledReportScheduler(): void {
  const runCheck = (): void => {
    void checkScheduledReports().catch((error: unknown) => {
      console.error('Scheduled report check failed:', error);
    });
  };
  runCheck();
  setInterval(runCheck, CHECK_INTERVAL_MS);
}

async function checkScheduledReports(): Promise<void> {
  if (isChecking) {
    return;
  }
  isChecking = true;
  try {
    const config = await ScheduledReportConfig.findByPk(CONFIG_ID);
    if (!config?.enabled) {
      return;
    }
    if (!config.startDate) {
      console.error('Scheduled report is enabled without a valid period start date.');
      return;
    }
    if (!smtpConfigured()) {
      console.error('Scheduled report is enabled but SMTP is not configured.');
      return;
    }
    const stepDays =
      config.frequencyInterval * (config.frequencyUnit === 'weeks' ? 7 : 1);
    if (!Number.isInteger(stepDays) || stepDays < 1 || config.reportPeriodDays < 1) {
      console.error('Scheduled report configuration has an invalid cadence or period length.');
      return;
    }

    const now = DateTime.now().setZone(config.timezone);
    const firstStart = DateTime.fromISO(config.startDate, { zone: config.timezone }).startOf('day');
    if (!now.isValid || !firstStart.isValid || now.toMillis() < firstStart.toMillis()) {
      return;
    }

    const elapsedDays = Math.floor(now.startOf('day').diff(firstStart, 'days').days);
    const lastPeriodIndex = Math.floor(elapsedDays / stepDays);
    const recipients = await User.findAll({
      attributes: ['id', 'name', 'email'],
      where: { id: config.recipientUserIds },
      order: [['name', 'ASC']],
    });
    if (!recipients.length) {
      console.error('Scheduled report is enabled but has no valid email recipients.');
      return;
    }
    if (!config.includeAllUsers && !config.includedUserIds.length) {
      console.error('Scheduled report is enabled but has no users selected for inclusion.');
      return;
    }

    for (let index = lastPeriodIndex; index >= 0; index--) {
      const periodStart = firstStart.plus({ days: index * stepDays }).toISODate()!;
      const scheduledAt = scheduledDeliveryDate(
        periodStart,
        config.reportPeriodDays,
        config.sendWeekday,
        config.sendTime,
        config.timezone,
      );
      if (now.toMillis() < scheduledAt.toMillis()) {
        continue;
      }

      const period = reportPeriod(periodStart, config.reportPeriodDays, config.timezone);
      const [delivery] = await ScheduledReportDelivery.findOrCreate({
        where: { periodStart },
        defaults: {
          periodStart,
          status: 'pending',
          attempts: 0,
          lastAttemptAt: null,
          sentAt: null,
          errorMessage: null,
        },
      });
      if (delivery.status === 'sent') {
        return;
      }
      if (
        delivery.lastAttemptAt &&
        Date.now() - delivery.lastAttemptAt.getTime() < RETRY_INTERVAL_MS
      ) {
        return;
      }

      await delivery.update({
        status: 'pending',
        attempts: delivery.attempts + 1,
        lastAttemptAt: new Date(),
        errorMessage: null,
      });
      try {
        await sendScheduledReportEmail(
          period,
          config.timezone,
          recipients,
          config.includeAllUsers ? null : config.includedUserIds,
        );
        await delivery.update({ status: 'sent', sentAt: new Date(), errorMessage: null });
        console.info(`Sent ClockIt report for ${period.startDate} to ${period.endDate}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown email delivery error';
        await delivery.update({ status: 'failed', errorMessage: message });
        console.error(`Could not send ClockIt report for ${periodStart}:`, error);
      }
      return;
    }
  } finally {
    isChecking = false;
  }
}
