import { Router } from 'express';
import projectRoutes from './project.routes';
import reportRoutes from './report.routes';
import timeEntryRoutes from './timeEntry.routes';
import workspaceRoutes from './workspace.routes';

const router = Router();

router.use('/workspaces', workspaceRoutes);
router.use('/projects', projectRoutes);
router.use('/time-entries', timeEntryRoutes);
router.use('/reports', reportRoutes);

export default router;
