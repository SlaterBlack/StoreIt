import '../models';
import { sequelize } from '../config/database';

async function migrateSchema(): Promise<void> {
  await sequelize.authenticate();
  await sequelize.sync();
  await sequelize.query(`
    ALTER TABLE clockit_tasks
      ADD COLUMN IF NOT EXISTS is_billable boolean NOT NULL DEFAULT true
  `);
  await sequelize.query(`
    ALTER TABLE clockit_scheduled_report_configs
      ADD COLUMN IF NOT EXISTS frequency_unit varchar(8) NOT NULL DEFAULT 'weeks',
      ADD COLUMN IF NOT EXISTS frequency_interval integer NOT NULL DEFAULT 2,
      ADD COLUMN IF NOT EXISTS report_period_days integer NOT NULL DEFAULT 14,
      ADD COLUMN IF NOT EXISTS include_all_users boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS included_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb
  `);
  await sequelize.query(`
    ALTER TABLE clockit_dashboard_reminders
      ADD COLUMN IF NOT EXISTS start_date date NOT NULL DEFAULT '1970-01-05',
      ADD COLUMN IF NOT EXISTS frequency_unit varchar(5) NOT NULL DEFAULT 'weeks',
      ADD COLUMN IF NOT EXISTS frequency_interval integer NOT NULL DEFAULT 1
  `);
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS storeit_migrations (
      name text PRIMARY KEY,
      executed_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  console.log('StoreIt schema is ready.');
}

migrateSchema()
  .catch((error: unknown) => {
    console.error('StoreIt schema migration failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
