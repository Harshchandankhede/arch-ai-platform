import mongoose from 'mongoose'
import { architectureSchema } from './architecture.schema.js'

const { Schema } = mongoose

const architectureVersionSchema = new Schema(
  {
    project: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    versionNumber: {
      type: Number,
      required: true,
      min: [1, 'Version number must be at least 1'],
    },
    label: {
      type: String,
      trim: true,
      maxlength: [80, 'Label must be at most 80 characters'],
      default: '',
    },
    arch: {
      type: architectureSchema,
      default: () => ({ nodes: [], edges: [] }),
    },
    nodeCount: { type: Number, default: 0 },
    edgeCount: { type: Number, default: 0 },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true, versionKey: false },
)

architectureVersionSchema.index({ project: 1, versionNumber: -1 }, { unique: true })

export const ArchitectureVersion =
  mongoose.models.ArchitectureVersion ||
  mongoose.model('ArchitectureVersion', architectureVersionSchema)
export default ArchitectureVersion