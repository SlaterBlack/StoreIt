import { Router } from 'express';
import { listReportTimeEntries, listReportUsers } from '../controllers/report.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requireAdmin } from '../middleware/requireAdmin';
import {
  getScheduledReportSettings,
  sendScheduledReportTest,
  updateScheduledReportSettings,
} from '../controllers/scheduledReport.controller';
import {
  createToilUsage,
  deleteToilUsage,
  getToilSettings,
  updateToilSettings,
} from '../controllers/toil.controller';

const router = Router();

router.use(requireAuth);
router.get('/users', listReportUsers);
router.get('/time-entries', listReportTimeEntries);
router.get('/scheduled-email', requireAdmin, getScheduledReportSettings);
router.put('/scheduled-email', requireAdmin, updateScheduledReportSettings);
router.post('/scheduled-email/test', requireAdmin, sendScheduledReportTest);
router.get('/toil', requireAdmin, getToilSettings);
router.put('/toil/settings', requireAdmin, updateToilSettings);
router.post('/toil/used', requireAdmin, createToilUsage);
router.delete('/toil/used/:id', requireAdmin, deleteToilUsage);

export default router;
