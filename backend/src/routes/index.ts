import { Router } from 'express';
import { sequelize } from '../config/database';
import { asyncHandler } from '../utils/asyncHandler';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import clockItRoutes from './clockit.routes';
import manageItRoutes from './manageit.routes';

const router = Router();

router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    await sequelize.authenticate();
    res.json({ status: 'ok', database: 'connected' });
  }),
);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/clockit', clockItRoutes);
router.use('/manageit', manageItRoutes);

export default router;
