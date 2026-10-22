import { Router } from 'express';
import { deleteTask, updateTask } from '../controllers/manageTask.controller';

const router = Router();

router.patch('/:taskId', updateTask);
router.delete('/:taskId', deleteTask);

export default router;
