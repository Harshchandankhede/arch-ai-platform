import mongoose from 'mongoose'

const { Schema } = mongoose

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const userSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [80, 'Name must be at most 80 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      unique: true,
      match: [EMAIL_PATTERN, 'Please provide a valid email address'],
    },
    passwordHash: {
      type: String,
      required: false,
      select: false,
    },
    role: {
      type: String,
      enum: {
        values: ['student', 'faculty', 'admin'],
        message: '{VALUE} is not a supported role',
      },
      default: 'student',
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret) {
        delete ret.passwordHash
        return ret
      },
    },
  },
)

export const User = mongoose.models.User || mongoose.model('User', userSchema)
export default User
