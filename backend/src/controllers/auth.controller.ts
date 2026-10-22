import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import { env } from '../config/env';
import { User } from '../models';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { signToken } from '../utils/jwt';
import {
  EMAIL_PATTERN,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  toPublicUser,
} from '../utils/userHelpers';

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email: rawEmail, password } = req.body as { email?: string; password?: string };

  if (!rawEmail || !password) {
    throw new ApiError(400, 'email and password are required');
  }

  const email = normalizeEmail(rawEmail);

  const user = await User.findOne({ where: { email } });
  if (!user) {
    throw new ApiError(401, 'Invalid email or password');
  }

  const isValidPassword = await bcrypt.compare(password, user.passwordHash);
  if (!isValidPassword) {
    throw new ApiError(401, 'Invalid email or password');
  }

  const token = signToken({ sub: user.id, email: user.email, role: user.role });
  res.json({ token, user: toPublicUser(user) });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findByPk(req.user?.id);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }
  res.json({ user: toPublicUser(user) });
});

export const updateMe = asyncHandler(async (req: Request, res: Response) => {
  const { name, email: rawEmail, password } = req.body as {
    name?: string;
    email?: string;
    password?: string;
  };

  const user = await User.findByPk(req.user?.id);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  if (name !== undefined) {
    if (!name.trim()) {
      throw new ApiError(400, 'name cannot be empty');
    }
    user.name = name.trim();
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

  if (password !== undefined) {
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new ApiError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    user.passwordHash = await bcrypt.hash(password, env.bcryptSaltRounds);
  }

  if (name === undefined && rawEmail === undefined && password === undefined) {
    throw new ApiError(400, 'Provide at least one profile field to update');
  }

  await user.save();
  res.json({ user: toPublicUser(user) });
});
