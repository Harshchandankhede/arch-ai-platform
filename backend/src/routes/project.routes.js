import { Router } from 'express'
import {
  createProjectHandler,
  deleteProjectHandler,
  getProjectHandler,
  listProjectsHandler,
  updateProjectHandler,
} from '../controllers/project.controller.js'
import architectureRoutes from './architecture.routes.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.use(requireAuth)

router.get('/', listProjectsHandler)
router.post('/', createProjectHandler)
router.get('/:id', getProjectHandler)
router.put('/:id', updateProjectHandler)
router.delete('/:id', deleteProjectHandler)

router.use('/:projectId/versions', architectureRoutes)

export default router