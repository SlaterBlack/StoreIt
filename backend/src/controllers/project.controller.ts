import { Request, Response } from "express";
import { Project, Task, TimeEntry, Workspace } from "../models";
import { PAY_TYPES, PayType } from "../models/Task";
import { ApiError } from "../utils/ApiError";
import { asyncHandler } from "../utils/asyncHandler";

// Projects are shared by every signed-in user, so access only requires the workspace to exist.
async function assertWorkspaceExists(workspaceId: string): Promise<void> {
  const workspace = await Workspace.findByPk(workspaceId);
  if (!workspace) {
    throw new ApiError(404, "Workspace not found");
  }
}

async function findProject(projectId: string): Promise<Project> {
  const project = await Project.findByPk(projectId);
  if (!project) {
    throw new ApiError(404, "Project not found");
  }
  return project;
}

function validateName(
  value: unknown,
  requiredMessage: string,
  tooLongMessage = "name must be 120 characters or fewer",
): string {
  if (typeof value !== "string") {
    throw new ApiError(400, requiredMessage);
  }

  const name = value.trim();
  if (!name) {
    throw new ApiError(400, requiredMessage);
  }
  if (name.length > 120) {
    throw new ApiError(400, tooLongMessage);
  }
  return name;
}

function validatePayType(value: unknown): PayType | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !PAY_TYPES.includes(value as PayType)) {
    throw new ApiError(400, `payType must be one of: ${PAY_TYPES.join(", ")}`);
  }
  return value as PayType;
}

async function findProjectTask(
  projectId: string,
  taskId: string,
): Promise<Task> {
  const task = await Task.findOne({ where: { id: taskId, projectId } });
  if (!task) {
    throw new ApiError(404, "Task not found");
  }
  return task;
}

export const listProjects = asyncHandler(
  async (req: Request, res: Response) => {
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) {
      throw new ApiError(400, "workspaceId query parameter is required");
    }

    await assertWorkspaceExists(workspaceId);
    const includeTasks = req.query.includeTasks === "true";
    const includeArchived = req.query.includeArchived === "true";
    const projects = await Project.findAll({
      where: { workspaceId, ...(includeArchived ? {} : { archived: false }) },
      ...(includeTasks ? { include: [{ model: Task, as: "tasks" }] } : {}),
      order: [
        ["projectNumber", "ASC"],
        ["name", "ASC"],
      ],
    });
    res.json({ projects });
  },
);

export const createProject = asyncHandler(
  async (req: Request, res: Response) => {
    const { name, projectNumber, color, isBillable, workspaceId } =
      req.body as {
        name?: string;
        projectNumber?: string;
        color?: string;
        isBillable?: boolean;
        workspaceId?: string;
      };

    if (typeof workspaceId !== "string" || typeof projectNumber !== "string") {
      throw new ApiError(
        400,
        "name, projectNumber, and workspaceId are required",
      );
    }
    const trimmedName = validateName(
      name,
      "name, projectNumber, and workspaceId are required",
    );
    if (!/^\d{3}$/.test(projectNumber)) {
      throw new ApiError(400, "projectNumber must be exactly three digits");
    }
    if (color !== undefined && !/^#[\da-f]{6}$/i.test(color)) {
      throw new ApiError(400, "color must be a six-digit hexadecimal color");
    }

    await assertWorkspaceExists(workspaceId);
    const project = await Project.create({
      name: trimmedName,
      projectNumber,
      color,
      isBillable,
      workspaceId,
    });
    res.status(201).json({ project });
  },
);

export const updateProject = asyncHandler(
  async (req: Request, res: Response) => {
    const project = await findProject(req.params.id);

    const { color, name, projectNumber, archived } = req.body as {
      color?: string;
      name?: string;
      projectNumber?: string;
      archived?: boolean;
    };
    const updates: {
      color?: string;
      name?: string;
      projectNumber?: string;
      archived?: boolean;
    } = {};

    if (color !== undefined) {
      if (typeof color !== "string" || !/^#[\da-f]{6}$/i.test(color)) {
        throw new ApiError(400, "color must be a six-digit hexadecimal color");
      }
      updates.color = color.toUpperCase();
    }
    if (name !== undefined) {
      updates.name = validateName(
        name,
        "name must be between 1 and 120 characters",
        "name must be between 1 and 120 characters",
      );
    }
    if (projectNumber !== undefined) {
      if (typeof projectNumber !== "string" || !/^\d{3}$/.test(projectNumber)) {
        throw new ApiError(400, "projectNumber must be exactly three digits");
      }
      updates.projectNumber = projectNumber;
    }
    if (archived !== undefined) {
      if (typeof archived !== "boolean") {
        throw new ApiError(400, "archived must be a boolean");
      }
      updates.archived = archived;
    }
    if (Object.keys(updates).length === 0) {
      throw new ApiError(400, "At least one project field must be provided");
    }

    await project.update(updates);
    res.json({ project });
  },
);

export const deleteProject = asyncHandler(
  async (req: Request, res: Response) => {
    const project = await findProject(req.params.id);
    if ((await TimeEntry.count({ where: { projectId: project.id } })) > 0) {
      throw new ApiError(
        409,
        "Projects with recorded time entries cannot be deleted",
      );
    }

    await Task.destroy({ where: { projectId: project.id } });
    await project.destroy();
    res.status(204).send();
  },
);

export const listProjectTasks = asyncHandler(
  async (req: Request, res: Response) => {
    const project = await findProject(req.params.projectId);

    const tasks = await Task.findAll({
      where: { projectId: project.id },
      order: [["name", "ASC"]],
    });
    res.json({ tasks });
  },
);

export const createProjectTask = asyncHandler(
  async (req: Request, res: Response) => {
    const project = await findProject(req.params.projectId);

    const { name, payType } = req.body as { name?: string; payType?: unknown };
    const trimmedName = validateName(name, "name is required");
    const validPayType = validatePayType(payType);

    const task = await Task.create({
      name: trimmedName,
      projectId: project.id,
      ...(validPayType ? { payType: validPayType } : {}),
    });
    res.status(201).json({ task });
  },
);

export const updateProjectTask = asyncHandler(
  async (req: Request, res: Response) => {
    const project = await findProject(req.params.projectId);

    const task = await findProjectTask(project.id, req.params.taskId);

    const { name, payType } = req.body as { name?: string; payType?: unknown };
    const validPayType = validatePayType(payType);
    await task.update({
      name: validateName(
        name,
        "name must be between 1 and 120 characters",
        "name must be between 1 and 120 characters",
      ),
      ...(validPayType ? { payType: validPayType } : {}),
    });
    res.json({ task });
  },
);

export const deleteProjectTask = asyncHandler(
  async (req: Request, res: Response) => {
    const project = await findProject(req.params.projectId);

    const task = await findProjectTask(project.id, req.params.taskId);

    if ((await TimeEntry.count({ where: { taskId: task.id } })) > 0) {
      throw new ApiError(
        409,
        "Tasks assigned to time entries cannot be deleted",
      );
    }

    await task.destroy();
    res.status(204).send();
  },
);
