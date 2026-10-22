import { Request, Response } from 'express';
import { Op } from 'sequelize';
import {
  ManageProject as Project,
  ManageTask as Task,
  ManageTaskDependency as TaskDependency,
} from '../models';
import { sequelize } from '../config/database';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';

interface DependencyEdge {
  predecessorTaskId: string;
  successorTaskId: string;
}

function hasPath(
  edges: DependencyEdge[],
  startId: string,
  targetId: string,
): boolean {
  const successors = new Map<string, string[]>();
  for (const edge of edges) {
    const next = successors.get(edge.predecessorTaskId) ?? [];
    next.push(edge.successorTaskId);
    successors.set(edge.predecessorTaskId, next);
  }

  const pending = [startId];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop();
    if (!current || visited.has(current)) {
      continue;
    }
    if (current === targetId) {
      return true;
    }
    visited.add(current);
    pending.push(...(successors.get(current) ?? []));
  }
  return false;
}

export const listProjectDependencies = asyncHandler(
  async (req: Request, res: Response) => {
    const project = await Project.findByPk(req.params.projectId);
    if (!project) {
      throw new ApiError(404, 'Project not found.');
    }
    const dependencies = await TaskDependency.findAll({
      where: { projectId: project.id },
      order: [['createdAt', 'ASC']],
    });
    res.json({ dependencies });
  },
);

export const createProjectDependency = asyncHandler(
  async (req: Request, res: Response) => {
    const { predecessorTaskId, successorTaskId } = req.body as {
      predecessorTaskId?: unknown;
      successorTaskId?: unknown;
    };
    if (
      typeof predecessorTaskId !== 'string' ||
      typeof successorTaskId !== 'string'
    ) {
      throw new ApiError(400, 'Both dependency task IDs are required.');
    }
    if (predecessorTaskId === successorTaskId) {
      throw new ApiError(400, 'A task cannot depend on itself.');
    }

    const dependency = await sequelize.transaction(async (transaction) => {
      const project = await Project.findByPk(req.params.projectId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!project) {
        throw new ApiError(404, 'Project not found.');
      }
      const tasks = await Task.findAll({
        where: {
          id: { [Op.in]: [predecessorTaskId, successorTaskId] },
          projectId: project.id,
        },
        transaction,
      });
      if (tasks.length !== 2) {
        throw new ApiError(
          400,
          'Both dependency tasks must belong to this project.',
        );
      }

      const edges = await TaskDependency.findAll({
        where: { projectId: project.id },
        attributes: ['predecessorTaskId', 'successorTaskId'],
        transaction,
      });
      const edgeValues = edges.map(
        ({ predecessorTaskId: predecessor, successorTaskId: successor }) => ({
          predecessorTaskId: predecessor,
          successorTaskId: successor,
        }),
      );
      if (
        edgeValues.some(
          (edge) =>
            edge.predecessorTaskId === predecessorTaskId &&
            edge.successorTaskId === successorTaskId,
        )
      ) {
        throw new ApiError(409, 'These tasks are already linked.');
      }
      if (hasPath(edgeValues, successorTaskId, predecessorTaskId)) {
        throw new ApiError(400, 'This link would create a dependency cycle.');
      }

      return TaskDependency.create(
        {
          projectId: project.id,
          predecessorTaskId,
          successorTaskId,
        },
        { transaction },
      );
    });
    res.status(201).json({ dependency });
  },
);

export const deleteProjectDependency = asyncHandler(
  async (req: Request, res: Response) => {
    const dependency = await TaskDependency.findOne({
      where: {
        id: req.params.dependencyId,
        projectId: req.params.projectId,
      },
    });
    if (!dependency) {
      throw new ApiError(404, 'Dependency not found.');
    }
    await dependency.destroy();
    res.status(204).send();
  },
);
