import { NextFunction, Request, Response } from 'express';
import { User } from '../models';
import { ApiError } from '../utils/ApiError';

// Must run after requireAuth so req.user is already populated.
export async function requireAdmin(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const authenticatedUser = req.user;
    if (!authenticatedUser) {
      next(new ApiError(403, 'Admin access required'));
      return;
    }

    const user = await User.findByPk(authenticatedUser.id);
    if (user?.role !== 'admin') {
      next(new ApiError(403, 'Admin access required'));
      return;
    }
    authenticatedUser.role = user.role;
    next();
  } catch (error) {
    next(error);
  }
}
