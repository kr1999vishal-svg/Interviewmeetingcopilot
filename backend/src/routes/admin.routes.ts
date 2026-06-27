import { Router } from 'express';
import {
  getAdminConfig,
  saveAdminConfig,
  getUsers,
  getUsageStats,
} from '../controllers/admin.controller.js';

const router = Router();

router.get('/config', getAdminConfig);
router.post('/config', saveAdminConfig);
router.get('/users', getUsers);
router.get('/stats', getUsageStats);

export default router;
