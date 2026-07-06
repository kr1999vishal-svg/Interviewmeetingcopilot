import { Router } from 'express';
import {
  getAdminConfig,
  saveAdminConfig,
  getUsers,
  getUsageStats,
  registerUser,
  getPaymentPlans,
  createRazorpayOrder,
  verifyPayment,
  getUserUsage,
  updateUsage,
  checkApiHealth,
} from '../controllers/admin.controller.js';

const router = Router();

router.get('/config', getAdminConfig);
router.post('/config', saveAdminConfig);
router.get('/users', getUsers);
router.get('/stats', getUsageStats);
router.post('/register', registerUser);
router.get('/plans', getPaymentPlans);
router.post('/create-order', createRazorpayOrder);
router.post('/verify-payment', verifyPayment);
router.get('/usage', getUserUsage);
router.post('/usage', updateUsage);
router.get('/health', checkApiHealth);

export default router;
