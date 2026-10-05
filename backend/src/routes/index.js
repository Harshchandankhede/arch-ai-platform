import { Router } from 'express'
import authRoutes from './auth.routes.js'
import healthRoutes from './health.routes.js'
import projectRoutes from './project.routes.js'
import recommendationRoutes from './recommendation.routes.js'

const router = Router()

router.use('/health', healthRoutes)
router.use('/auth', authRoutes)
router.use('/projects', projectRoutes)
router.use('/recommendations', recommendationRoutes)

export default router