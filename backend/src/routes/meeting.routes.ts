import { Router } from 'express';
import {
  createMeeting,
  deleteMeeting,
  getMeeting,
  listMeetings,
  summarizeMeeting,
  syncMeeting,
  updateMeeting,
} from '../controllers/meeting.controller.js';

export const meetingRouter = Router();

meetingRouter.get('/', listMeetings);
meetingRouter.post('/', createMeeting);
meetingRouter.post('/sync', syncMeeting);
meetingRouter.get('/:id', getMeeting);
meetingRouter.patch('/:id', updateMeeting);
meetingRouter.delete('/:id', deleteMeeting);
meetingRouter.post('/:id/summary', summarizeMeeting);
