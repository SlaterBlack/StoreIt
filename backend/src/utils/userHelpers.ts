import { User, UserRole } from '../models/User';

export const MIN_PASSWORD_LENGTH = 8;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Emails are stored lower-cased so "A@x.com" and "a@x.com" are the same account.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidRole(role: unknown): role is UserRole {
  return role === 'admin' || role === 'user';
}

export function toPublicUser(user: User) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
