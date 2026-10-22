import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import { env } from '../config/env';
import { User } from '../models';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { EMAIL_PATTERN, MIN_PASSWORD_LENGTH, isValidRole, normalizeEmail, toPublicUser } from '../utils/userHelpers';

export const listUsers = asyncHandler(async (_req: Request, res: Response) => {
  const users = await User.findAll({ order: [['name', 'ASC']] });
  res.json({ users: users.map(toPublicUser) });
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const { name, email: rawEmail, password, role: rawRole } = req.body as {
    name?: string;
    email?: string;
    password?: string;
    role?: string;
  };

  if (!name || !rawEmail || !password) {
    throw new ApiError(400, 'name, email and password are required');
  }

  const email = normalizeEmail(rawEmail);
  if (!EMAIL_PATTERN.test(email)) {
    throw new ApiError(400, 'Enter a valid email address');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ApiError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const role = rawRole ?? 'user';
  if (!isValidRole(role)) {
    throw new ApiError(400, "role must be 'admin' or 'user'");
  }

  const existing = await User.findOne({ where: { email } });
  if (existing) {
    throw new ApiError(409, 'A user with that email already exists');
  }

  // When nobody is authenticated this can only be the one-time bootstrap
  // request (see requireAdminOrBootstrap) that creates the very first
  // account, which must be an admin regardless of what was requested.
  const effectiveRole = req.user ? role : 'admin';

  const passwordHash = await bcrypt.hash(password, env.bcryptSaltRounds);
  const user = await User.create({ name: name.trim(), email, passwordHash, role: effectiveRole });

  res.status(201).json({ user: toPublicUser(user) });
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const { name, email: rawEmail, password, role: rawRole } = req.body as {
    name?: string;
    email?: string;
    password?: string;
    role?: string;
  };

  const user = await User.findByPk(req.params.id);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  if (rawEmail !== undefined) {
    const email = normalizeEmail(rawEmail);
    if (!EMAIL_PATTERN.test(email)) {
      throw new ApiError(400, 'Enter a valid email address');
    }
    const existing = await User.findOne({ where: { email } });
    if (existing && existing.id !== user.id) {
      throw new ApiError(409, 'A user with that email already exists');
    }
    user.email = email;
  }

  if (name !== undefined) {
    if (!name.trim()) {
      throw new ApiError(400, 'name cannot be empty');
    }
    user.name = name.trim();
  }

  if (password !== undefined) {
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new ApiError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    user.passwordHash = await bcrypt.hash(password, env.bcryptSaltRounds);
  }

  if (rawRole !== undefined) {
    if (!isValidRole(rawRole)) {
      throw new ApiError(400, "role must be 'admin' or 'user'");
    }
    if (user.role === 'admin' && rawRole !== 'admin') {
      await ensureNotLastAdmin('You cannot remove the last remaining admin');
    }
    user.role = rawRole;
  }

  await user.save();
  res.json({ user: toPublicUser(user) });
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findByPk(req.params.id);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  if (user.id === req.user?.id) {
    throw new ApiError(400, 'You cannot delete your own account');
  }

  if (user.role === 'admin') {
    await ensureNotLastAdmin('You cannot delete the last remaining admin');
  }

  await user.destroy();
  res.status(204).send();
});

// Guards against locking everyone out of user management by demoting/deleting
// the only remaining admin account. Callers only invoke this when the target
// user currently holds the admin role.
async function ensureNotLastAdmin(message: string): Promise<void> {
  const adminCount = await User.count({ where: { role: 'admin' } });
  if (adminCount <= 1) {
    throw new ApiError(400, message);
  }
}
