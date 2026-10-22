import { Sequelize, QueryTypes } from 'sequelize';
import { sequelize } from '../config/database';
import { sourceDatabase } from '../config/env';
import {
  ManageProject,
  ManageTask,
  ManageTaskDependency,
  Project,
  Task,
  TimeEntry,
  User,
  Workspace,
} from '../models';

interface SourceUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: 'admin' | 'user';
  createdAt: Date;
  updatedAt: Date;
}

interface SourceWorkspace {
  id: string;
  name: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ClockItProject {
  id: string;
  name: string;
  projectNumber: string | null;
  color: string;
  isBillable: boolean;
  archived: boolean;
  workspaceId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ClockItTask {
  id: string;
  name: string;
  projectId: string;
  payType: 'hourly' | 'public-holiday' | 'sick-leave' | 'annual-leave' | 'unpaid';
  createdAt: Date;
  updatedAt: Date;
}

interface ClockItTimeEntry {
  id: string;
  description: string;
  startTime: Date;
  endTime: Date | null;
  durationSeconds: number | null;
  isBillable: boolean;
  userId: string;
  projectId: string | null;
  taskId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ManageItProject {
  id: string;
  projectCode: string;
  name: string;
  description: string;
  color: string;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ManageItTask {
  id: string;
  projectId: string;
  parentTaskId: string | null;
  isMilestone: boolean;
  isArchived: boolean;
  name: string;
  assignee: string;
  startDate: string;
  dueDate: string;
  progress: number;
  status: 'not_started' | 'in_progress' | 'complete';
  createdAt: Date;
  updatedAt: Date;
}

interface ManageItTaskDependency {
  id: string;
  projectId: string;
  predecessorTaskId: string;
  successorTaskId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface LegacyData {
  users: SourceUser[];
  workspaces: SourceWorkspace[];
  clockItProjects: ClockItProject[];
  clockItTasks: ClockItTask[];
  timeEntries: ClockItTimeEntry[];
  manageItProjects: ManageItProject[];
  manageItTasks: ManageItTask[];
  manageItDependencies: ManageItTaskDependency[];
}

const TABLES = [
  ['users', ['id', 'name', 'email', 'password_hash', 'created_at', 'updated_at']],
  ['workspaces', ['id', 'name', 'owner_id', 'created_at', 'updated_at']],
  [
    'projects',
    [
      'id',
      'name',
      'project_number',
      'color',
      'is_billable',
      'archived',
      'workspace_id',
      'created_at',
      'updated_at',
    ],
  ],
  ['tasks', ['id', 'name', 'project_id', 'pay_type', 'created_at', 'updated_at']],
  [
    'time_entries',
    [
      'id',
      'description',
      'start_time',
      'end_time',
      'duration_seconds',
      'is_billable',
      'user_id',
      'project_id',
      'task_id',
      'created_at',
      'updated_at',
    ],
  ],
] as const;

const MANAGEIT_TABLES = [
  [
    'projects',
    [
      'id',
      'project_code',
      'name',
      'description',
      'color',
      'is_archived',
      'created_at',
      'updated_at',
    ],
  ],
  [
    'tasks',
    [
      'id',
      'project_id',
      'parent_task_id',
      'is_milestone',
      'is_archived',
      'name',
      'assignee',
      'start_date',
      'due_date',
      'progress',
      'status',
      'created_at',
      'updated_at',
    ],
  ],
  [
    'task_dependencies',
    [
      'id',
      'project_id',
      'predecessor_task_id',
      'successor_task_id',
      'created_at',
      'updated_at',
    ],
  ],
] as const;

const STOREIT_TABLES = [
  'users',
  'clockit_workspaces',
  'clockit_projects',
  'clockit_tasks',
  'clockit_time_entries',
  'manageit_projects',
  'manageit_tasks',
  'manageit_task_dependencies',
];

function createSourceConnection(
  settings: ReturnType<typeof sourceDatabase>,
): Sequelize {
  return new Sequelize(settings.name, settings.user, settings.password, {
    host: settings.host,
    port: settings.port,
    dialect: 'postgres',
    logging: false,
    pool: { max: 2, min: 0, acquire: 10_000, idle: 10_000 },
  });
}

function assertSeparateDatabase(
  label: string,
  source: ReturnType<typeof sourceDatabase>,
): void {
  const sameDatabase =
    source.host.toLowerCase() === sequelize.config.host?.toString().toLowerCase() &&
    source.port === Number(sequelize.config.port) &&
    source.name === sequelize.config.database;
  if (sameDatabase) {
    throw new Error(`${label} source points to the StoreIt destination database.`);
  }
}

async function tableColumns(
  connection: Sequelize,
  tableName: string,
): Promise<Set<string>> {
  const rows = await connection.query<{ columnName: string }>(
    `SELECT column_name AS "columnName"
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = :tableName`,
    { replacements: { tableName }, type: QueryTypes.SELECT },
  );
  return new Set(rows.map(({ columnName }) => columnName));
}

async function requireColumns(
  connection: Sequelize,
  tableName: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Promise<Set<string>> {
  const columns = await tableColumns(connection, tableName);
  const missing = required.filter((column) => !columns.has(column));
  if (columns.size === 0 || missing.length) {
    throw new Error(
      `${tableName} is missing required columns: ${missing.join(', ') || '(table not found)'}. Run the existing app migrations first.`,
    );
  }
  return new Set([...required, ...optional.filter((column) => columns.has(column))]);
}

async function requireSourceSchema(
  clockIt: Sequelize,
  manageIt: Sequelize,
): Promise<boolean> {
  let roleColumnExists = false;
  for (const [table, columns] of TABLES) {
    const present = await requireColumns(
      clockIt,
      table,
      columns,
      table === 'users' ? ['role'] : [],
    );
    if (table === 'users') roleColumnExists = present.has('role');
  }
  for (const [table, columns] of MANAGEIT_TABLES) {
    await requireColumns(manageIt, table, columns);
  }
  return roleColumnExists;
}

async function readLegacyData(
  clockIt: Sequelize,
  manageIt: Sequelize,
  hasUserRole: boolean,
): Promise<LegacyData> {
  const roleSelection = hasUserRole ? 'role' : "'user'::text AS role";
  const [
    users,
    workspaces,
    clockItProjects,
    clockItTasks,
    timeEntries,
    manageItProjects,
    manageItTasks,
    manageItDependencies,
  ] = await Promise.all([
    clockIt.query<SourceUser>(
      `SELECT id::text AS id, name, email, password_hash AS "passwordHash",
              ${roleSelection}, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM public.users ORDER BY id`,
      { type: QueryTypes.SELECT },
    ),
    clockIt.query<SourceWorkspace>(
      `SELECT id::text AS id, name, owner_id::text AS "ownerId",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM public.workspaces ORDER BY id`,
      { type: QueryTypes.SELECT },
    ),
    clockIt.query<ClockItProject>(
      `SELECT id::text AS id, name, project_number AS "projectNumber", color,
              is_billable AS "isBillable", archived,
              workspace_id::text AS "workspaceId",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM public.projects ORDER BY id`,
      { type: QueryTypes.SELECT },
    ),
    clockIt.query<ClockItTask>(
      `SELECT id::text AS id, name, project_id::text AS "projectId", pay_type AS "payType",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM public.tasks ORDER BY id`,
      { type: QueryTypes.SELECT },
    ),
    clockIt.query<ClockItTimeEntry>(
      `SELECT id::text AS id, description, start_time AS "startTime", end_time AS "endTime",
              duration_seconds AS "durationSeconds", is_billable AS "isBillable",
              user_id::text AS "userId", project_id::text AS "projectId",
              task_id::text AS "taskId", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM public.time_entries ORDER BY id`,
      { type: QueryTypes.SELECT },
    ),
    manageIt.query<ManageItProject>(
      `SELECT id::text AS id, project_code AS "projectCode", name, description, color,
              is_archived AS "isArchived", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM public.projects ORDER BY id`,
      { type: QueryTypes.SELECT },
    ),
    manageIt.query<ManageItTask>(
      `SELECT id::text AS id, project_id::text AS "projectId",
              parent_task_id::text AS "parentTaskId", is_milestone AS "isMilestone",
              is_archived AS "isArchived", name, assignee, start_date AS "startDate",
              due_date AS "dueDate", progress, status,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM public.tasks ORDER BY id`,
      { type: QueryTypes.SELECT },
    ),
    manageIt.query<ManageItTaskDependency>(
      `SELECT id::text AS id, project_id::text AS "projectId",
              predecessor_task_id::text AS "predecessorTaskId",
              successor_task_id::text AS "successorTaskId",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM public.task_dependencies ORDER BY id`,
      { type: QueryTypes.SELECT },
    ),
  ]);

  return {
    users,
    workspaces,
    clockItProjects,
    clockItTasks,
    timeEntries,
    manageItProjects,
    manageItTasks,
    manageItDependencies,
  };
}

function validateData(data: LegacyData): void {
  const normalizedEmails = new Set<string>();
  for (const user of data.users) {
    const email = user.email.trim().toLowerCase();
    if (normalizedEmails.has(email)) {
      throw new Error(`ClockIt contains duplicate user email: ${email}`);
    }
    normalizedEmails.add(email);
  }

  const userIds = new Set(data.users.map(({ id }) => id));
  const workspaceIds = new Set(data.workspaces.map(({ id }) => id));
  const clockItProjectIds = new Set(data.clockItProjects.map(({ id }) => id));
  const clockItTaskIds = new Set(data.clockItTasks.map(({ id }) => id));
  const manageItProjectIds = new Set(data.manageItProjects.map(({ id }) => id));
  const manageItTaskIds = new Set(data.manageItTasks.map(({ id }) => id));

  for (const workspace of data.workspaces) {
    if (!userIds.has(workspace.ownerId)) {
      throw new Error(`ClockIt workspace ${workspace.id} has no owner account.`);
    }
  }
  for (const project of data.clockItProjects) {
    if (!workspaceIds.has(project.workspaceId)) {
      throw new Error(`ClockIt project ${project.id} has no workspace.`);
    }
  }
  for (const task of data.clockItTasks) {
    if (!clockItProjectIds.has(task.projectId)) {
      throw new Error(`ClockIt task ${task.id} has no project.`);
    }
  }
  for (const entry of data.timeEntries) {
    if (!userIds.has(entry.userId)) {
      throw new Error(`ClockIt time entry ${entry.id} has no user.`);
    }
    if (entry.projectId && !clockItProjectIds.has(entry.projectId)) {
      throw new Error(`ClockIt time entry ${entry.id} has no project.`);
    }
    if (entry.taskId && !clockItTaskIds.has(entry.taskId)) {
      throw new Error(`ClockIt time entry ${entry.id} has no task.`);
    }
  }
  for (const task of data.manageItTasks) {
    if (!manageItProjectIds.has(task.projectId)) {
      throw new Error(`ManageIt task ${task.id} has no project.`);
    }
    if (task.parentTaskId && !manageItTaskIds.has(task.parentTaskId)) {
      throw new Error(`ManageIt task ${task.id} has no parent task.`);
    }
  }
  for (const dependency of data.manageItDependencies) {
    if (
      !manageItProjectIds.has(dependency.projectId) ||
      !manageItTaskIds.has(dependency.predecessorTaskId) ||
      !manageItTaskIds.has(dependency.successorTaskId)
    ) {
      throw new Error(
        `ManageIt dependency ${dependency.id} has a missing related record.`,
      );
    }
  }
}

function dataCounts(data: LegacyData): Record<string, number> {
  return {
    users: data.users.length,
    clockit_workspaces: data.workspaces.length,
    clockit_projects: data.clockItProjects.length,
    clockit_tasks: data.clockItTasks.length,
    clockit_time_entries: data.timeEntries.length,
    manageit_projects: data.manageItProjects.length,
    manageit_tasks: data.manageItTasks.length,
    manageit_task_dependencies: data.manageItDependencies.length,
  };
}

async function insertInBatches<T>(
  rows: T[],
  insert: (batch: T[]) => Promise<unknown>,
): Promise<void> {
  const batchSize = 200;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    await insert(rows.slice(offset, offset + batchSize));
  }
}

async function ensureDestinationEmpty(): Promise<void> {
  const counts = await Promise.all([
    User.count(),
    Workspace.count(),
    Project.count(),
    Task.count(),
    TimeEntry.count(),
    ManageProject.count(),
    ManageTask.count(),
    ManageTaskDependency.count(),
  ]);
  const occupied = counts
    .map((count, index) => ({ count, table: STOREIT_TABLES[index] }))
    .filter(({ count }) => count > 0);
  if (occupied.length) {
    throw new Error(
      `StoreIt target tables must be empty before the first import: ${occupied
        .map(({ table, count }) => `${table}=${count}`)
        .join(', ')}`,
    );
  }
}

async function storeLegacyData(data: LegacyData): Promise<void> {
  await ensureDestinationEmpty();
  await sequelize.transaction(async (transaction) => {
    await insertInBatches(data.users, (batch) =>
      User.bulkCreate(batch, { transaction, validate: true }),
    );
    await insertInBatches(data.workspaces, (batch) =>
      Workspace.bulkCreate(batch, { transaction, validate: true }),
    );
    await insertInBatches(data.clockItProjects, (batch) =>
      Project.bulkCreate(batch, { transaction, validate: true }),
    );
    await insertInBatches(data.clockItTasks, (batch) =>
      Task.bulkCreate(batch, { transaction, validate: true }),
    );
    await insertInBatches(data.timeEntries, (batch) =>
      TimeEntry.bulkCreate(batch, { transaction, validate: true }),
    );
    await insertInBatches(data.manageItProjects, (batch) =>
      ManageProject.bulkCreate(batch, { transaction, validate: true }),
    );
    await insertInBatches(data.manageItTasks, (batch) =>
      ManageTask.bulkCreate(batch, { transaction, validate: true }),
    );
    await insertInBatches(data.manageItDependencies, (batch) =>
      ManageTaskDependency.bulkCreate(batch, { transaction, validate: true }),
    );
    await sequelize.query(
      `INSERT INTO storeit_migrations (name) VALUES ('legacy-clockit-manageit-import')`,
      { transaction },
    );
  });
}

async function migrationCompleted(): Promise<boolean> {
  const tables = await sequelize.query<{ exists: boolean }>(
    `SELECT to_regclass('public.storeit_migrations') IS NOT NULL AS "exists"`,
    { type: QueryTypes.SELECT },
  );
  if (!tables[0]?.exists) {
    throw new Error(
      'StoreIt schema is not initialized. Run npm run db:migrate first.',
    );
  }
  const rows = await sequelize.query<{ name: string }>(
    `SELECT name FROM storeit_migrations
     WHERE name = 'legacy-clockit-manageit-import'`,
    { type: QueryTypes.SELECT },
  );
  return rows.length > 0;
}

async function migrateLegacyData(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.length === 1 && args[0] === '--apply';
  if (args.length > 1 || (args.length === 1 && args[0] !== '--apply')) {
    throw new Error('Usage: npm run data:check | npm run data:migrate');
  }

  const clockItSettings = sourceDatabase('CLOCKIT_SOURCE');
  const manageItSettings = sourceDatabase('MANAGEIT_SOURCE');
  assertSeparateDatabase('ClockIt', clockItSettings);
  assertSeparateDatabase('ManageIt', manageItSettings);

  const clockIt = createSourceConnection(clockItSettings);
  const manageIt = createSourceConnection(manageItSettings);
  try {
    await Promise.all([
      sequelize.authenticate(),
      clockIt.authenticate(),
      manageIt.authenticate(),
    ]);
    if (await migrationCompleted()) {
      console.log('Legacy ClockIt/ManageIt data was already imported; no changes made.');
      return;
    }

    const hasUserRole = await requireSourceSchema(clockIt, manageIt);
    const data = await readLegacyData(clockIt, manageIt, hasUserRole);
    validateData(data);
    await ensureDestinationEmpty();
    console.log('Legacy data preflight passed. Rows found:');
    for (const [table, count] of Object.entries(dataCounts(data))) {
      console.log(`  ${table}: ${count}`);
    }

    if (!apply) {
      console.log(
        'Dry run only; no data was written. Run npm run data:migrate to import.',
      );
      return;
    }

    await storeLegacyData(data);
    console.log('Legacy data imported into StoreIt. Source databases were not changed.');
  } finally {
    await Promise.all([clockIt.close(), manageIt.close()]);
  }
}

migrateLegacyData()
  .catch((error: unknown) => {
    console.error('Legacy data migration failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
