import { Request, Response } from 'express';
import { sequelize } from '../config/database';
import {
  ManageProject as Project,
  ManageTask as Task,
  ManageTaskDependency as TaskDependency,
} from '../models';
import { DEFAULT_PROJECT_COLOR } from '../models/ManageProject';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';

function validateProjectCode(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{3}$/.test(value.trim())) {
    throw new ApiError(400, 'Project code must be exactly three digits.');
  }
  return value.trim();
}

function validateName(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, `${label} is required.`);
  }
  const name = value.trim();
  if (name.length > 120) {
    throw new ApiError(400, `${label} must be 120 characters or fewer.`);
  }
  return name;
}

function validateColor(value: unknown): string {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new ApiError(400, 'Project color must be a six-digit hex value.');
  }
  return value.toUpperCase();
}

async function ensureProjectCodeAvailable(
  projectCode: string,
  exceptProjectId?: string,
): Promise<void> {
  const existingProject = await Project.findOne({ where: { projectCode } });
  if (existingProject && existingProject.id !== exceptProjectId) {
    throw new ApiError(409, 'Project code is already in use.');
  }
}

export const listProjects = asyncHandler(async (_req: Request, res: Response) => {
  const projects = await Project.findAll({
    order: [
      ['createdAt', 'ASC'],
      ['name', 'ASC'],
    ],
  });
  res.json({ projects });
});

export const createProject = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      projectCode,
      name,
      description = '',
      color = DEFAULT_PROJECT_COLOR,
    } = req.body as {
      projectCode?: unknown;
      name?: unknown;
      description?: unknown;
      color?: unknown;
    };
    const code = validateProjectCode(projectCode);
    await ensureProjectCodeAvailable(code);
    if (typeof description !== 'string') {
      throw new ApiError(400, 'Description must be a string.');
    }
    if (description.length > 2000) {
      throw new ApiError(400, 'Description must be 2000 characters or fewer.');
    }
    const project = await Project.create({
      projectCode: code,
      name: validateName(name, 'Project name'),
      description: description.trim(),
      color: validateColor(color),
    });
    res.status(201).json({ project });
  },
);

export const updateProject = asyncHandler(
  async (req: Request, res: Response) => {
    const project = await Project.findByPk(req.params.id);
    if (!project) {
      throw new ApiError(404, 'Project not found.');
    }

    const { name, description } = req.body as {
      name?: unknown;
      description?: unknown;
      projectCode?: unknown;
      color?: unknown;
    };
    const changes = req.body as {
      name?: unknown;
      description?: unknown;
      projectCode?: unknown;
      color?: unknown;
      isArchived?: unknown;
    };
    if (
      changes.name === undefined &&
      changes.description === undefined &&
      changes.projectCode === undefined &&
      changes.color === undefined &&
      changes.isArchived === undefined
    ) {
      throw new ApiError(400, 'At least one project field must be provided.');
    }
    const updates: {
      name?: string;
      description?: string;
      projectCode?: string;
      color?: string;
      isArchived?: boolean;
    } = {};
    if (name !== undefined) {
      updates.name = validateName(name, 'Project name');
    }
    if (description !== undefined) {
      if (typeof description !== 'string' || description.length > 2000) {
        throw new ApiError(400, 'Description must be 2000 characters or fewer.');
      }
      updates.description = description.trim();
    }
    if (changes.projectCode !== undefined) {
      const projectCode = validateProjectCode(changes.projectCode);
      await ensureProjectCodeAvailable(projectCode, project.id);
      updates.projectCode = projectCode;
    }
    if (changes.color !== undefined) {
      updates.color = validateColor(changes.color);
    }
    if (changes.isArchived !== undefined) {
      if (typeof changes.isArchived !== 'boolean') {
        throw new ApiError(400, 'Archived must be a boolean value.');
      }
      updates.isArchived = changes.isArchived;
    }
    await project.update(updates);
    res.json({ project });
  },
);

export const deleteProject = asyncHandler(
  async (req: Request, res: Response) => {
    const project = await Project.findByPk(req.params.id);
    if (!project) {
      throw new ApiError(404, 'Project not found.');
    }
    await sequelize.transaction(async (transaction) => {
      await TaskDependency.destroy({
        where: { projectId: project.id },
        transaction,
      });
      await Task.destroy({
        where: { projectId: project.id },
        transaction,
      });
      await project.destroy({ transaction });
    });
    res.status(204).send();
  },
);

export const listProjectTasks = asyncHandler(
  async (req: Request, res: Response) => {
    const project = await Project.findByPk(req.params.projectId);
    if (!project) {
      throw new ApiError(404, 'Project not found.');
    }
    const tasks = await Task.findAll({
      where: { projectId: project.id },
      order: [
        ['startDate', 'ASC'],
        ['createdAt', 'ASC'],
      ],
    });
    res.json({ tasks });
  },
);
