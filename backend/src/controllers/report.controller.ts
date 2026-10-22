import { Request, Response } from 'express';
import { User, Project, Task, TimeEntry } from '../models';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';

export const listReportUsers = asyncHandler(async (req: Request, res: Response) => {
  const users = await User.findAll({
    attributes: ['id', 'name'],
    order: [['name', 'ASC']],
  });
  res.json({ users, currentUserId: req.user!.id });
});

export const listReportTimeEntries = asyncHandler(async (req: Request, res: Response) => {
  const requestedUserId = req.query.userId;
  if (requestedUserId !== undefined && typeof requestedUserId !== 'string') {
    throw new ApiError(400, 'userId must be a user ID or "all"');
  }

  let includeAllUsers = false;
  let userId = req.user!.id;
  if (requestedUserId === 'all') {
    includeAllUsers = true;
  } else if (requestedUserId) {
    if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(requestedUserId)) {
      throw new ApiError(400, 'userId must be a valid user ID or "all"');
    }
    const user = await User.findByPk(requestedUserId, { attributes: ['id'] });
    if (!user) {
      throw new ApiError(404, 'User not found');
    }
    userId = user.id;
  }

  const timeEntries = await TimeEntry.findAll({
    where: includeAllUsers ? {} : { userId },
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
      {
        model: User,
        as: 'user',
        attributes: ['id', 'name'],
        required: true,
      },
    ],
    order: [['startTime', 'DESC']],
  });
  res.json({ timeEntries });
});
