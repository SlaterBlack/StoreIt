import { Router } from 'express';
import { createUser, deleteUser, listUsers, updateUser } from '../controllers/user.controller';
import { requireAdmin } from '../middleware/requireAdmin';
import { requireAdminOrBootstrap } from '../middleware/requireAdminOrBootstrap';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

// Listing, updating and deleting always require an authenticated admin.
// Creating allows one unauthenticated bootstrap request only while the users
// table is empty (see requireAdminOrBootstrap).
router.get('/', requireAuth, requireAdmin, listUsers);
router.post('/', requireAdminOrBootstrap, createUser);
router.patch('/:id', requireAuth, requireAdmin, updateUser);
router.delete('/:id', requireAuth, requireAdmin, deleteUser);

export default router;
