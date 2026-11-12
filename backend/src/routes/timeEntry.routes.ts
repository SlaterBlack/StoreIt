import { Router } from 'express';
import {
  adminUpdateTimeEntry,
  deleteTimeEntry,
  createTimeEntry,
  importTimeEntries,
  listTimeEntries,
  startTimeEntry,
  stopTimeEntry,
  updateTimeEntry,
} from '../controllers/timeEntry.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requireAdmin } from '../middleware/requireAdmin';

const router = Router();

router.use(requireAuth);
router.get('/', listTimeEntries);
router.post('/import', importTimeEntries);
router.post('/', createTimeEntry);
router.post('/start', startTimeEntry);
router.post('/:id/stop', stopTimeEntry);
router.patch('/admin/:id', requireAdmin, adminUpdateTimeEntry);
router.patch('/:id', updateTimeEntry);
router.delete('/:id', deleteTimeEntry);

export default router;
