import { connectDatabase, sequelize } from '../config/database';
import { createAdminFromTerminal } from '../utils/adminBootstrap';

async function createAdmin(): Promise<void> {
  try {
    await connectDatabase();
    await createAdminFromTerminal();
  } catch (error) {
    console.error('Admin setup failed:', error);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

void createAdmin();
