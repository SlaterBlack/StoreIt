import { NextFunction, Request, Response } from 'express';
import { User } from '../models';
import { requireAdmin } from './requireAdmin';
import { requireAuth } from './requireAuth';

// Creating a user normally requires an authenticated admin. The one exception
// is a completely empty users table: since there's no public registration
// endpoint, someone has to be able to create the very first (admin) account.
// Once at least one user exists, this always falls back to admin-only auth.
export async function requireAdminOrBootstrap(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userCount = await User.count();
    if (userCount === 0) {
      next();
      return;
    }
  } catch (error) {
    next(error);
    return;
  }

  requireAuth(req, res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    requireAdmin(req, res, next);
  });
}
