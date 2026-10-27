import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { sequelize } from '../config/database';
import { Project, Task, TimeEntry, Workspace } from '../models';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';

const MAX_IMPORT_ENTRIES = 5000;

interface ImportedEntryInput {
  startTime: Date;
  endTime: Date;
  projectNumber: string | null;
  projectName: string;
  taskName: string;
  description: string;
  isBillable: boolean;
}

interface ResolvedImportedEntry extends ImportedEntryInput {
  projectId: string;
  taskId: string;
}

export const listTimeEntries = asyncHandler(async (req: Request, res: Response) => {
  const timeEntries = await TimeEntry.findAll({
    where: { userId: req.user?.id },
    include: [
      {
        model: Task,
        as: 'task',
        attributes: ['id', 'name', 'payType'],
        required: false,
      },
      {
        model: Project,
        as: 'project',
        attributes: ['id', 'name', 'projectNumber'],
        required: false,
      },
    ],
    order: [['startTime', 'DESC']],
  });
  res.json({ timeEntries });
});

// Projects and tasks are shared by every user, so a task only needs to exist (and have a project).
async function findTask(taskId: string, allowArchivedProject = false): Promise<Task> {
  const task = await Task.findByPk(taskId);
  if (!task) {
    throw new ApiError(404, 'Task not found');
  }

  const project = await Project.findByPk(task.projectId);
  if (!project) {
    throw new ApiError(404, 'Task project not found');
  }
  if (project.archived && !allowArchivedProject) {
    throw new ApiError(409, 'Project is archived');
  }

  return task;
}

/** Starts a new running timer. A user may only have one running timer at a time. */
export const startTimeEntry = asyncHandler(async (req: Request, res: Response) => {
  const { description, taskId, isBillable } = req.body as {
    description?: string;
    taskId?: string;
    isBillable?: boolean;
  };

  if (!taskId) {
    throw new ApiError(400, 'taskId is required before a timer can be started');
  }
  if (isBillable !== undefined && typeof isBillable !== 'boolean') {
    throw new ApiError(400, 'isBillable must be a boolean');
  }
  const task = await findTask(taskId);

  const runningEntry = await TimeEntry.findOne({
    where: { userId: req.user!.id, endTime: { [Op.is]: null } },
  });
  if (runningEntry) {
    throw new ApiError(409, 'A time entry is already running. Stop it before starting a new one.');
  }

  const timeEntry = await TimeEntry.create({
    description: description ?? '',
    projectId: task.projectId,
    taskId: task.id,
    isBillable: isBillable ?? task.isBillable,
    startTime: new Date(),
    userId: req.user!.id,
  });

  res.status(201).json({ timeEntry });
});

/** Creates a completed time entry without starting a timer. */
export const createTimeEntry = asyncHandler(async (req: Request, res: Response) => {
  const { description, taskId, isBillable, startTime, endTime } = req.body as {
    description?: string;
    taskId?: string;
    isBillable?: boolean;
    startTime?: unknown;
    endTime?: unknown;
  };

  if (typeof taskId !== 'string' || !taskId) {
    throw new ApiError(400, 'taskId is required before a time entry can be saved');
  }
  const task = await findTask(taskId);
  if (description !== undefined && (typeof description !== 'string' || description.length > 500)) {
    throw new ApiError(400, 'description must be 500 characters or fewer');
  }
  if (isBillable !== undefined && typeof isBillable !== 'boolean') {
    throw new ApiError(400, 'isBillable must be a boolean');
  }

  const parsedStartTime = parseEntryDate(startTime, 'startTime');
  const parsedEndTime = parseEntryDate(endTime, 'endTime');
  if (parsedEndTime <= parsedStartTime) {
    throw new ApiError(400, 'endTime must be after startTime');
  }
  if (parsedEndTime > new Date()) {
    throw new ApiError(400, 'endTime cannot be in the future');
  }

  const timeEntry = await TimeEntry.create({
    description: description ?? '',
    taskId: task.id,
    projectId: task.projectId,
    isBillable: isBillable ?? task.isBillable,
    startTime: parsedStartTime,
    endTime: parsedEndTime,
    durationSeconds: Math.round((parsedEndTime.getTime() - parsedStartTime.getTime()) / 1000),
    userId: req.user!.id,
  });
  res.status(201).json({ timeEntry });
});

/** Imports completed report rows for the authenticated user. */
export const importTimeEntries = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { entries?: unknown };
  if (!Array.isArray(body?.entries) || body.entries.length === 0) {
    throw new ApiError(400, 'entries must be a non-empty array');
  }
  if (body.entries.length > MAX_IMPORT_ENTRIES) {
    throw new ApiError(400, `A CSV can contain at most ${MAX_IMPORT_ENTRIES} entries`);
  }

  const now = new Date();
  const entries = body.entries.map((entry, index) => validateImportedEntry(entry, index + 2, now));
  const userId = req.user!.id;

  const result = await sequelize.transaction(async (transaction) => {
    const projects = await Project.findAll({
      attributes: ['id', 'name', 'projectNumber'],
      transaction,
    });
    const tasks = await Task.findAll({
      attributes: ['id', 'name', 'projectId'],
      transaction,
    });

    let workspace = await Workspace.findOne({
      order: [['createdAt', 'ASC']],
      transaction,
    });
    let createdProjectCount = 0;
    let createdTaskCount = 0;
    const resolvedEntries: ResolvedImportedEntry[] = [];

    for (const [index, entry] of entries.entries()) {
      const rowNumber = index + 2;
      let project = findImportedProject(projects, entry, rowNumber);
      if (!project) {
        if (!workspace) {
          workspace = await Workspace.create(
            { name: 'Imported Workspace', ownerId: userId },
            { transaction },
          );
        }
        project = await Project.create(
          {
            name: entry.projectName.trim(),
            projectNumber: entry.projectNumber,
            workspaceId: workspace.id,
          },
          { transaction },
        );
        projects.push(project);
        createdProjectCount += 1;
      }

      let matchingTasks = tasks.filter(
        (task) =>
          task.projectId === project.id &&
          normalizeName(task.name) === normalizeName(entry.taskName),
      );
      if (matchingTasks.length > 1) {
        throw new ApiError(
          400,
          `CSV row ${rowNumber}: Task "${entry.taskName}" is ambiguous in project "${project.name}".`,
        );
      }
      if (matchingTasks.length === 0) {
        const task = await Task.create(
          { name: entry.taskName.trim(), projectId: project.id },
          { transaction },
        );
        tasks.push(task);
        matchingTasks = [task];
        createdTaskCount += 1;
      }

      resolvedEntries.push({
        ...entry,
        projectId: project.id,
        taskId: matchingTasks[0].id,
      });
    }

    const taskIds = [...new Set(resolvedEntries.map((entry) => entry.taskId))];
    const startTimes = resolvedEntries.map((entry) => entry.startTime.getTime());
    const existingEntries = await TimeEntry.findAll({
      where: {
        userId,
        taskId: { [Op.in]: taskIds },
        startTime: {
          [Op.between]: [new Date(Math.min(...startTimes)), new Date(Math.max(...startTimes))],
        },
      },
      attributes: ['taskId', 'startTime', 'endTime', 'description', 'isBillable'],
      transaction,
    });
    const seen = new Set(existingEntries.map((entry) => importedEntryKey(entry)));
    const toCreate = [];
    let skippedCount = 0;

    for (const entry of resolvedEntries) {
      const key = importedEntryKey(entry);
      if (seen.has(key)) {
        skippedCount += 1;
        continue;
      }
      seen.add(key);
      toCreate.push({
        userId,
        projectId: entry.projectId,
        taskId: entry.taskId,
        startTime: entry.startTime,
        endTime: entry.endTime,
        durationSeconds: Math.round((entry.endTime.getTime() - entry.startTime.getTime()) / 1000),
        description: entry.description,
        isBillable: entry.isBillable,
      });
    }

    if (toCreate.length) {
      await TimeEntry.bulkCreate(toCreate, { transaction, validate: true });
    }
    return {
      importedCount: toCreate.length,
      skippedCount,
      createdProjectCount,
      createdTaskCount,
    };
  });

  res.json(result);
});

/** Stops the currently running timer and records its duration. */
export const stopTimeEntry = asyncHandler(async (req: Request, res: Response) => {
  const timeEntry = await TimeEntry.findOne({
    where: { id: req.params.id, userId: req.user?.id },
  });
  if (!timeEntry) {
    throw new ApiError(404, 'Time entry not found');
  }
  if (timeEntry.endTime) {
    throw new ApiError(409, 'Time entry is already stopped');
  }
  const { taskId, startTime } = (req.body ?? {}) as {
    taskId?: unknown;
    startTime?: unknown;
  };
  const effectiveTaskId = taskId ?? timeEntry.taskId;
  if (typeof effectiveTaskId !== 'string' || !effectiveTaskId) {
    throw new ApiError(409, 'Assign a task before stopping this timer');
  }
  const task = await findTask(effectiveTaskId, true);
  const parsedStartTime =
    startTime === undefined ? timeEntry.startTime : parseEntryDate(startTime, 'startTime');

  const endTime = new Date();
  if (parsedStartTime >= endTime) {
    throw new ApiError(400, 'startTime must be before the timer end time');
  }
  const durationSeconds = Math.round((endTime.getTime() - parsedStartTime.getTime()) / 1000);

  await timeEntry.update({
    projectId: task.projectId,
    taskId: task.id,
    startTime: parsedStartTime,
    endTime,
    durationSeconds,
  });
  res.json({ timeEntry });
});

export const updateTimeEntry = asyncHandler(async (req: Request, res: Response) => {
  const timeEntry = await TimeEntry.findOne({
    where: { id: req.params.id, userId: req.user?.id },
  });
  if (!timeEntry) {
    throw new ApiError(404, 'Time entry not found');
  }

  const { description, taskId, isBillable, startTime, endTime } = req.body as {
    description?: string;
    taskId?: string;
    isBillable?: boolean;
    startTime?: string;
    endTime?: string | null;
  };

  const effectiveTaskId = taskId ?? timeEntry.taskId;
  if (!effectiveTaskId) {
    throw new ApiError(400, 'taskId is required before a time entry can be saved');
  }
  const task = await findTask(effectiveTaskId, true);

  if (description !== undefined && (typeof description !== 'string' || description.length > 500)) {
    throw new ApiError(400, 'description must be 500 characters or fewer');
  }
  if (isBillable !== undefined && typeof isBillable !== 'boolean') {
    throw new ApiError(400, 'isBillable must be a boolean');
  }

  const parsedStartTime =
    startTime === undefined ? timeEntry.startTime : parseEntryDate(startTime, 'startTime');
  const parsedEndTime =
    endTime === undefined
      ? timeEntry.endTime
      : endTime === null
        ? null
        : parseEntryDate(endTime, 'endTime');
  if (parsedEndTime && parsedEndTime < parsedStartTime) {
    throw new ApiError(400, 'endTime must be after startTime');
  }
  if (parsedEndTime === null && timeEntry.endTime !== null) {
    const runningEntry = await TimeEntry.findOne({
      where: {
        userId: req.user!.id,
        endTime: { [Op.is]: null },
      },
    });
    if (runningEntry && runningEntry.id !== timeEntry.id) {
      throw new ApiError(409, 'A time entry is already running.');
    }
  }

  await timeEntry.update({
    ...(description !== undefined ? { description } : {}),
    taskId: task.id,
    projectId: task.projectId,
    ...(isBillable !== undefined ? { isBillable } : {}),
    startTime: parsedStartTime,
    endTime: parsedEndTime,
    durationSeconds: parsedEndTime
      ? Math.round((parsedEndTime.getTime() - parsedStartTime.getTime()) / 1000)
      : null,
  });
  res.json({ timeEntry });
});

function parseEntryDate(value: unknown, field: string): Date {
  if (typeof value !== 'string') {
    throw new ApiError(400, `${field} must be a valid date`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, `${field} must be a valid date`);
  }
  return parsed;
}

function validateImportedEntry(value: unknown, rowNumber: number, now: Date): ImportedEntryInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, `CSV row ${rowNumber} is invalid.`);
  }
  const entry = value as Record<string, unknown>;
  const projectName = requiredImportText(entry.projectName, 'Project', rowNumber, 120);
  const taskName = requiredImportText(entry.taskName, 'Task', rowNumber, 120);
  const description =
    entry.description === undefined
      ? ''
      : requiredImportText(entry.description, 'Description', rowNumber, 500, true);
  const projectNumber = entry.projectNumber ?? null;
  if (
    projectNumber !== null &&
    (typeof projectNumber !== 'string' || !/^\d{3}$/.test(projectNumber))
  ) {
    throw new ApiError(400, `CSV row ${rowNumber} has an invalid Project number.`);
  }
  if (typeof entry.isBillable !== 'boolean') {
    throw new ApiError(400, `CSV row ${rowNumber} must include a valid Billable value.`);
  }

  const startTime = parseImportTimestamp(entry.startTime, 'start', rowNumber);
  const endTime = parseImportTimestamp(entry.endTime, 'end', rowNumber);
  if (endTime <= startTime) {
    throw new ApiError(400, `CSV row ${rowNumber} must have an end time after its start time.`);
  }
  if (endTime > now) {
    throw new ApiError(400, `CSV row ${rowNumber} has an end time in the future.`);
  }

  return {
    startTime,
    endTime,
    projectNumber,
    projectName,
    taskName,
    description,
    isBillable: entry.isBillable,
  };
}

function requiredImportText(
  value: unknown,
  field: string,
  rowNumber: number,
  maxLength: number,
  allowEmpty = false,
): string {
  if (typeof value !== 'string' || value.length > maxLength || (!allowEmpty && !value.trim())) {
    throw new ApiError(400, `CSV row ${rowNumber} has an invalid ${field}.`);
  }
  return value;
}

function parseImportTimestamp(value: unknown, field: string, rowNumber: number): Date {
  if (typeof value !== 'string') {
    throw new ApiError(400, `CSV row ${rowNumber} has an invalid ${field} timestamp.`);
  }
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.exec(value);
  if (!parts || !isValidCalendarDate(parts)) {
    throw new ApiError(400, `CSV row ${rowNumber} has an invalid ${field} timestamp.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, `CSV row ${rowNumber} has an invalid ${field} timestamp.`);
  }
  return date;
}

function isValidCalendarDate(parts: RegExpExecArray): boolean {
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = parts;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return (
    year > 0 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
}

function findImportedProject(
  projects: Project[],
  entry: ImportedEntryInput,
  rowNumber: number,
): Project | null {
  const name = normalizeName(entry.projectName);
  const byName = projects.filter((project) => normalizeName(project.name) === name);
  const byNumber = entry.projectNumber
    ? projects.filter((project) => project.projectNumber === entry.projectNumber)
    : [];
  const byBoth = byNumber.filter((project) => normalizeName(project.name) === name);
  const candidates =
    byBoth.length > 0
      ? byBoth
      : byName.length === 1
        ? byName
        : byNumber.length === 1
          ? byNumber
          : byName.length > 1
            ? byName
            : byNumber;

  if (candidates.length > 1) {
    throw new ApiError(400, `CSV row ${rowNumber}: Project "${entry.projectName}" is ambiguous.`);
  }
  return candidates[0] ?? null;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function importedEntryKey(entry: {
  taskId: string | null;
  startTime: Date;
  endTime: Date | null;
  description: string;
  isBillable: boolean;
}): string {
  return [
    entry.taskId,
    entry.startTime.getTime(),
    entry.endTime?.getTime() ?? '',
    entry.description,
    entry.isBillable,
  ].join('|');
}

export const deleteTimeEntry = asyncHandler(async (req: Request, res: Response) => {
  const deleted = await TimeEntry.destroy({
    where: { id: req.params.id, userId: req.user?.id },
  });
  if (!deleted) {
    throw new ApiError(404, 'Time entry not found');
  }
  res.status(204).send();
});
