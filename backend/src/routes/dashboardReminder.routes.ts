import { Router } from 'express';
import {
  createDashboardReminder,
  deleteDashboardReminder,
  listActiveDashboardReminders,
  listDashboardReminders,
  updateDashboardReminder,
} from '../controllers/dashboardReminder.controller';
import { requireAdmin } from '../middleware/requireAdmin';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

router.use(requireAuth);
router.get('/active', listActiveDashboardReminders);
router.get('/', requireAdmin, listDashboardReminders);
router.post('/', requireAdmin, createDashboardReminder);
router.patch('/:id', requireAdmin, updateDashboardReminder);
router.delete('/:id', requireAdmin, deleteDashboardReminder);

export default router;
