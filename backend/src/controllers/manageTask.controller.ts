import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { sequelize } from '../config/database';
import {
  ManageProject as Project,
  ManageTask as Task,
  ManageTaskDependency as TaskDependency,
} from '../models';
import { TASK_STATUSES, TaskStatus } from '../models/ManageTask';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';

const MAX_ASSIGNEES_LENGTH = 500;

function validateDate(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  ) {
    throw new ApiError(400, `${label} must be a valid YYYY-MM-DD date.`);
  }
  return value;
}

function dateDifference(from: string, to: string): number {
  return (
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
    86400000
  );
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return validateDate(date.toISOString().slice(0, 10), 'Shifted task date');
}

function validateProgress(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 100
  ) {
    throw new ApiError(400, 'Progress must be an integer from 0 to 100.');
  }
  return value;
}

function validateStatus(value: unknown): TaskStatus {
  if (typeof value !== 'string' || !TASK_STATUSES.includes(value as TaskStatus)) {
    throw new ApiError(
      400,
      `Status must be one of: ${TASK_STATUSES.join(', ')}.`,
    );
  }
  return value as TaskStatus;
}

function validateTaskName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, 'Task name is required.');
  }
  const name = value.trim();
  if (name.length > 120) {
    throw new ApiError(400, 'Task name must be 120 characters or fewer.');
  }
  return name;
}

function validateTaskColor(value: unknown): string {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new ApiError(400, 'Task color must be a six-digit hex value.');
  }
  return value.toUpperCase();
}

export const createProjectTask = asyncHandler(
  async (req: Request, res: Response) => {
    const project = await Project.findByPk(req.params.projectId);
    if (!project) {
      throw new ApiError(404, 'Project not found.');
    }
    const {
      name,
      assignee = '',
      startDate,
      dueDate,
      isMilestone = false,
      parentTaskId = null,
    } = req.body as {
      name?: unknown;
      assignee?: unknown;
      startDate?: unknown;
      dueDate?: unknown;
      isMilestone?: unknown;
      parentTaskId?: unknown;
    };
    if (
      typeof assignee !== 'string' ||
      assignee.length > MAX_ASSIGNEES_LENGTH
    ) {
      throw new ApiError(
        400,
        `Assignees must be ${MAX_ASSIGNEES_LENGTH} characters or fewer.`,
      );
    }
    if (typeof isMilestone !== 'boolean') {
      throw new ApiError(400, 'Milestone must be a boolean value.');
    }
    const validStart = validateDate(startDate, 'Start date');
    const validDue = validateDate(dueDate, 'Due date');
    if (validDue < validStart) {
      throw new ApiError(400, 'Due date must be on or after the start date.');
    }
    if (isMilestone && validStart !== validDue) {
      throw new ApiError(400, 'Milestones must have the same start and due date.');
    }
    if (isMilestone && parentTaskId !== null) {
      throw new ApiError(400, 'Milestones cannot be subtasks.');
    }
    let parentTask: Task | null = null;
    if (parentTaskId !== null) {
      if (typeof parentTaskId !== 'string') {
        throw new ApiError(400, 'Parent task ID must be a valid task ID.');
      }
      parentTask = await Task.findByPk(parentTaskId);
      if (!parentTask || parentTask.projectId !== project.id) {
        throw new ApiError(400, 'Parent task must belong to the same project.');
      }
      if (parentTask.isMilestone) {
        throw new ApiError(400, 'Milestones cannot have subtasks.');
      }
      if (parentTask.parentTaskId) {
        throw new ApiError(400, 'Subtasks cannot contain further subtasks.');
      }
      if (
        validStart < parentTask.startDate ||
        validDue > parentTask.dueDate
      ) {
        throw new ApiError(
          400,
          'Subtask dates must be within the parent task date range.',
        );
      }
    }
    const task = await Task.create({
      projectId: project.id,
      parentTaskId: parentTask?.id ?? null,
      isMilestone,
      name: validateTaskName(name),
      color: project.color,
      assignee: assignee.trim(),
      startDate: validStart,
      dueDate: validDue,
    });
    res.status(201).json({ task });
  },
);

export const updateTask = asyncHandler(async (req: Request, res: Response) => {
  const task = await Task.findByPk(req.params.taskId);
  if (!task) {
    throw new ApiError(404, 'Task not found.');
  }
  const {
    name,
    assignee,
    startDate,
    dueDate,
    progress,
    status,
    isMilestone,
    isArchived,
    color,
  } = req.body as {
    name?: unknown;
    assignee?: unknown;
    startDate?: unknown;
    dueDate?: unknown;
    progress?: unknown;
    status?: unknown;
    isMilestone?: unknown;
    isArchived?: unknown;
    color?: unknown;
  };
  if (
    name === undefined &&
    assignee === undefined &&
    startDate === undefined &&
    dueDate === undefined &&
    progress === undefined &&
    status === undefined &&
    isMilestone === undefined &&
    isArchived === undefined &&
    color === undefined
  ) {
    throw new ApiError(400, 'Provide at least one task field to update.');
  }

  const updates: {
    name?: string;
    assignee?: string;
    startDate?: string;
    dueDate?: string;
    progress?: number;
    status?: TaskStatus;
    isMilestone?: boolean;
    isArchived?: boolean;
    color?: string;
  } = {};
  if (name !== undefined) {
    updates.name = validateTaskName(name);
  }
  if (assignee !== undefined) {
    if (
      typeof assignee !== 'string' ||
      assignee.length > MAX_ASSIGNEES_LENGTH
    ) {
      throw new ApiError(
        400,
        `Assignees must be ${MAX_ASSIGNEES_LENGTH} characters or fewer.`,
      );
    }
    updates.assignee = assignee.trim();
  }
  if (startDate !== undefined) {
    updates.startDate = validateDate(startDate, 'Start date');
  }
  if (dueDate !== undefined) {
    updates.dueDate = validateDate(dueDate, 'Due date');
  }
  if (progress !== undefined) {
    updates.progress = validateProgress(progress);
  }
  if (status !== undefined) {
    updates.status = validateStatus(status);
  }
  if (isMilestone !== undefined) {
    if (typeof isMilestone !== 'boolean') {
      throw new ApiError(400, 'Milestone must be a boolean value.');
    }
    updates.isMilestone = isMilestone;
  }
  if (isArchived !== undefined) {
    if (typeof isArchived !== 'boolean') {
      throw new ApiError(400, 'Archived must be a boolean value.');
    }
    updates.isArchived = isArchived;
  }
  if (color !== undefined) {
    updates.color = validateTaskColor(color);
  }
  const resultingStart = updates.startDate ?? task.startDate;
  const resultingDue = updates.dueDate ?? task.dueDate;
  const resultingIsMilestone = updates.isMilestone ?? task.isMilestone;
  if (resultingDue < resultingStart) {
    throw new ApiError(400, 'Due date must be on or after the start date.');
  }
  if (resultingIsMilestone && task.parentTaskId) {
    throw new ApiError(400, 'Milestones cannot be subtasks.');
  }
  if (resultingIsMilestone && resultingStart !== resultingDue) {
    throw new ApiError(400, 'Milestones must have the same start and due date.');
  }

  let subtasks: Task[] = [];
  if (task.parentTaskId) {
    const parent = await Task.findByPk(task.parentTaskId);
    if (
      !parent ||
      resultingStart < parent.startDate ||
      resultingDue > parent.dueDate
    ) {
      throw new ApiError(
        400,
        'Subtask dates must be within the parent task date range.',
      );
    }
  } else {
    subtasks = await Task.findAll({ where: { parentTaskId: task.id } });
  }
  if (resultingIsMilestone && subtasks.length > 0) {
    throw new ApiError(400, 'Tasks with subtasks cannot be milestones.');
  }

  const startShift = dateDifference(task.startDate, resultingStart);
  const dueShift = dateDifference(task.dueDate, resultingDue);
  const shiftSubtasks =
    subtasks.length > 0 && startShift !== 0 && startShift === dueShift;
  const updateSubtaskColors =
    !task.parentTaskId && updates.color !== undefined && subtasks.length > 0;
  const completeSubtasks =
    !task.parentTaskId &&
    updates.status === 'complete' &&
    subtasks.length > 0;
  if (
    subtasks.length > 0 &&
    !shiftSubtasks &&
    subtasks.some(
      (subtask) =>
        subtask.startDate < resultingStart || subtask.dueDate > resultingDue,
    )
  ) {
    throw new ApiError(
      400,
      'Parent task dates must contain the dates of all its subtasks.',
    );
  }

  await sequelize.transaction(async (transaction) => {
    await task.update(updates, { transaction });
    if (shiftSubtasks || updateSubtaskColors || completeSubtasks) {
      for (const subtask of subtasks) {
        const subtaskUpdates: {
          startDate?: string;
          dueDate?: string;
          color?: string;
          status?: TaskStatus;
          progress?: number;
        } = {};
        if (shiftSubtasks) {
          subtaskUpdates.startDate = shiftDate(subtask.startDate, startShift);
          subtaskUpdates.dueDate = shiftDate(subtask.dueDate, startShift);
        }
        if (updateSubtaskColors) {
          subtaskUpdates.color = updates.color;
        }
        if (completeSubtasks) {
          subtaskUpdates.status = 'complete';
          subtaskUpdates.progress = 100;
        }
        await subtask.update(subtaskUpdates, { transaction });
      }
    }
  });
  res.json({ task });
});

export const deleteTask = asyncHandler(async (req: Request, res: Response) => {
  const task = await Task.findByPk(req.params.taskId);
  if (!task) {
    throw new ApiError(404, 'Task not found.');
  }
  await sequelize.transaction(async (transaction) => {
    const subtasks = await Task.findAll({
      where: { parentTaskId: task.id },
      attributes: ['id'],
      transaction,
    });
    const taskIds = [task.id, ...subtasks.map((subtask) => subtask.id)];
    await TaskDependency.destroy({
      where: {
        [Op.or]: [
          { predecessorTaskId: { [Op.in]: taskIds } },
          { successorTaskId: { [Op.in]: taskIds } },
        ],
      },
      transaction,
    });
    await Task.destroy({
      where: { id: { [Op.in]: taskIds } },
      transaction,
    });
  });
  res.status(204).send();
});
