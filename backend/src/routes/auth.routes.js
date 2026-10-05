import { Router } from 'express'
import {
  getCurrentUser,
  loginUser,
  registerUser,
  updateMyReportProfile,
} from '../controllers/auth.controller.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.post('/register', registerUser)
router.post('/login', loginUser)
router.get('/me', requireAuth, getCurrentUser)

// Separate resource from /auth/me rather than a second route on the same path, so the
// read and write contracts stay distinct and PUT cannot be mistaken for a profile read.
router.put('/me/report-profile', requireAuth, updateMyReportProfile)

export default router
