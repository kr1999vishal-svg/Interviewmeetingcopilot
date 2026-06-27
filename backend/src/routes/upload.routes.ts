import { Router } from 'express';
import { uploadFile, getFile, getFilesByUser, uploadMiddleware } from '../controllers/upload.controller';

const router = Router();

router.post('/', uploadMiddleware, uploadFile);
router.get('/:fileId', getFile);
router.get('/user/:userId', getFilesByUser);

export default router;
