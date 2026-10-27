import { Router } from 'express';
import { createUser, deleteUser, listUsers, updateUser } from '../controllers/user.controller';
import { requireAdmin } from '../middleware/requireAdmin';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

// Listing, updating and deleting always require an authenticated admin.
// Initial admin creation is performed locally from the backend terminal.
router.get('/', requireAuth, requireAdmin, listUsers);
router.post('/', requireAuth, requireAdmin, createUser);
router.patch('/:id', requireAuth, requireAdmin, updateUser);
router.delete('/:id', requireAuth, requireAdmin, deleteUser);

export default router;
