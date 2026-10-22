import { Request, Response } from 'express';
import { Workspace } from '../models';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';

// The workspace is shared by every user. The oldest one is the shared workspace;
// the owner is simply the user who created it.
export const listWorkspaces = asyncHandler(async (_req: Request, res: Response) => {
  const workspaces = await Workspace.findAll({ order: [['createdAt', 'ASC']] });
  res.json({ workspaces });
});

export const createWorkspace = asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.body as { name?: string };
  if (!name) {
    throw new ApiError(400, 'name is required');
  }

  const existing = await Workspace.findOne({ order: [['createdAt', 'ASC']] });
  if (existing) {
    res.json({ workspace: existing });
    return;
  }

  const workspace = await Workspace.create({ name, ownerId: req.user!.id });
  res.status(201).json({ workspace });
});

export const getWorkspace = asyncHandler(async (req: Request, res: Response) => {
  const workspace = await Workspace.findByPk(req.params.id);
  if (!workspace) {
    throw new ApiError(404, 'Workspace not found');
  }
  res.json({ workspace });
});

export const deleteWorkspace = asyncHandler(async (req: Request, res: Response) => {
  const deleted = await Workspace.destroy({
    where: { id: req.params.id, ownerId: req.user?.id },
  });
  if (!deleted) {
    throw new ApiError(404, 'Workspace not found');
  }
  res.status(204).send();
});
