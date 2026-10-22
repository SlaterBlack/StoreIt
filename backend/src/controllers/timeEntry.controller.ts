import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Project, Task, TimeEntry } from '../models';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';

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
    isBillable,
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
    isBillable,
    startTime: parsedStartTime,
    endTime: parsedEndTime,
    durationSeconds: Math.round((parsedEndTime.getTime() - parsedStartTime.getTime()) / 1000),
    userId: req.user!.id,
  });
  res.status(201).json({ timeEntry });
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
  const parsedStartTime = startTime === undefined ? timeEntry.startTime : parseEntryDate(startTime, 'startTime');

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

  const parsedStartTime = startTime === undefined ? timeEntry.startTime : parseEntryDate(startTime, 'startTime');
  const parsedEndTime =
    endTime === undefined ? timeEntry.endTime : endTime === null ? null : parseEntryDate(endTime, 'endTime');
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
    durationSeconds: parsedEndTime ? Math.round((parsedEndTime.getTime() - parsedStartTime.getTime()) / 1000) : null,
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

export const deleteTimeEntry = asyncHandler(async (req: Request, res: Response) => {
  const deleted = await TimeEntry.destroy({
    where: { id: req.params.id, userId: req.user?.id },
  });
  if (!deleted) {
    throw new ApiError(404, 'Time entry not found');
  }
  res.status(204).send();
});
