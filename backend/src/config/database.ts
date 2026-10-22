import { Sequelize } from 'sequelize';
import { env } from './env';

export const sequelize = new Sequelize(env.db.name, env.db.user, env.db.password, {
  host: env.db.host,
  port: env.db.port,
  dialect: 'postgres',
  logging: env.db.logging,
  define: {
    underscored: true,
  },
});

export async function connectDatabase(): Promise<void> {
  await sequelize.authenticate();
}
