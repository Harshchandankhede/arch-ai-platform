import { Router } from 'express'
import { advisorStatusHandler, generateAdvisorHandler } from '../controllers/recommendation.controller.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// This router spends paid Gemini quota on every call, so it is always behind auth.
router.use(requireAuth)

router.get('/advisor', advisorStatusHandler)
router.post('/advisor', generateAdvisorHandler)

export default router