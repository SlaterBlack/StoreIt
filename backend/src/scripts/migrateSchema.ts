import '../models';
import { sequelize } from '../config/database';

async function migrateSchema(): Promise<void> {
  await sequelize.authenticate();
  await sequelize.sync();
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
