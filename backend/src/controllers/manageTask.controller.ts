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
    if (typeof assignee !== 'string' || assignee.length > 120) {
      throw new ApiError(400, 'Assignee must be 120 characters or fewer.');
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
    isArchived,
  } = req.body as {
    name?: unknown;
    assignee?: unknown;
    startDate?: unknown;
    dueDate?: unknown;
    progress?: unknown;
    status?: unknown;
    isArchived?: unknown;
  };
  if (
    name === undefined &&
    assignee === undefined &&
    startDate === undefined &&
    dueDate === undefined &&
    progress === undefined &&
    status === undefined &&
    isArchived === undefined
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
    isArchived?: boolean;
  } = {};
  if (name !== undefined) {
    updates.name = validateTaskName(name);
  }
  if (assignee !== undefined) {
    if (typeof assignee !== 'string' || assignee.length > 120) {
      throw new ApiError(400, 'Assignee must be 120 characters or fewer.');
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
  if (isArchived !== undefined) {
    if (typeof isArchived !== 'boolean') {
      throw new ApiError(400, 'Archived must be a boolean value.');
    }
    updates.isArchived = isArchived;
  }
  const resultingStart = updates.startDate ?? task.startDate;
  const resultingDue = updates.dueDate ?? task.dueDate;
  if (resultingDue < resultingStart) {
    throw new ApiError(400, 'Due date must be on or after the start date.');
  }
  if (task.isMilestone && resultingStart !== resultingDue) {
    throw new ApiError(400, 'Milestones must have the same start and due date.');
  }

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
    const subtasks = await Task.findAll({ where: { parentTaskId: task.id } });
    if (
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
  }

  await task.update(updates);
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
