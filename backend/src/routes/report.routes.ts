import { Router } from 'express';
import { listReportTimeEntries, listReportUsers } from '../controllers/report.controller';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

router.use(requireAuth);
router.get('/users', listReportUsers);
router.get('/time-entries', listReportTimeEntries);

export default router;
