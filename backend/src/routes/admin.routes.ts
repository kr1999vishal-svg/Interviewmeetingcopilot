import { Router } from 'express';
import {
  getAdminConfig,
  saveAdminConfig,
  getUsers,
  getUsageStats,
  registerUser,
} from '../controllers/admin.controller.js';

const router = Router();

router.get('/config', getAdminConfig);
router.post('/config', saveAdminConfig);
router.get('/users', getUsers);
router.get('/stats', getUsageStats);
router.post('/register', registerUser);

export default router;
