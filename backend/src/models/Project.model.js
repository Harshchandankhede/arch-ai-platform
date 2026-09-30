import mongoose from 'mongoose'
import { architectureSchema } from './architecture.schema.js'

const { Schema } = mongoose

const projectSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Project name is required'],
      trim: true,
      minlength: [1, 'Project name cannot be empty'],
      maxlength: [120, 'Project name must be at most 120 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description must be at most 500 characters'],
      default: '',
    },
    owner: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    arch: {
      type: architectureSchema,
      default: () => ({ nodes: [], edges: [] }),
    },
    currentVersion: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret) {
        delete ret.owner
        return ret
      },
    },
  },
)

projectSchema.index({ owner: 1, updatedAt: -1 })

export const Project = mongoose.models.Project || mongoose.model('Project', projectSchema)
export default Project