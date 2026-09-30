import { Router } from 'express'
import {
  createVersionHandler,
  deleteVersionHandler,
  getVersionHandler,
  listVersionsHandler,
  restoreVersionHandler,
  updateVersionLabelHandler,
} from '../controllers/architecture.controller.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router({ mergeParams: true })

router.use(requireAuth)

router.get('/', listVersionsHandler)
router.post('/', createVersionHandler)
router.get('/:versionId', getVersionHandler)
router.put('/:versionId/label', updateVersionLabelHandler)
router.post('/:versionId/restore', restoreVersionHandler)
router.delete('/:versionId', deleteVersionHandler)

export default router