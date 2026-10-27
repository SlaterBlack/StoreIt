import { createApp } from './app';
import { connectDatabase } from './config/database';
import { env } from './config/env';
import './models';
import { startScheduledReportScheduler } from './services/scheduledReportScheduler';
import { ensureAdminExists } from './utils/adminBootstrap';

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

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', error);
  process.exit(1);
});
