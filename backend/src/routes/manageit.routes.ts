import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import projectRoutes from './manageit-project.routes';
import taskRoutes from './manageit-task.routes';

const router = Router();

router.use(requireAuth);
router.use('/projects', projectRoutes);
router.use('/tasks', taskRoutes);

export default router;
