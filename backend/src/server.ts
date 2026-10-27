import { createApp } from './app';
import { connectDatabase } from './config/database';
import { env } from './config/env';
import './models';
import { User } from './models';
import { startScheduledReportScheduler } from './services/scheduledReportScheduler';

async function bootstrap(): Promise<void> {
  await connectDatabase();

  await ensureAdminExists();
  startScheduledReportScheduler();

  const app = createApp();
  app.listen(env.port, env.apiHost, () => {
    // eslint-disable-next-line no-console
    console.log(`StoreIt API listening on http://${env.apiHost}:${env.port}`);
  });
}

// Promote the oldest account only when no administrator exists.
async function ensureAdminExists(): Promise<void> {
  const adminCount = await User.count({ where: { role: 'admin' } });
  if (adminCount > 0) {
    return;
  }

  const oldestUser = await User.findOne({ order: [['createdAt', 'ASC']] });
  if (!oldestUser) {
    return;
  }

  oldestUser.role = 'admin';
  await oldestUser.save();
  // eslint-disable-next-line no-console
  console.log(`No admin found; promoted "${oldestUser.email}" to admin.`);
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', error);
  process.exit(1);
});
