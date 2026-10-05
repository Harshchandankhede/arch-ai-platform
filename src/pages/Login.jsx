import { Component, Suspense, lazy, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import { useApp, useDispatch } from '../store/AppContext.jsx'
import { login, register } from '../services/auth.js'
import { Button, Field, Spinner, inputClass } from '../components/ui.jsx'

const LandingScene = lazy(() => import('../features/three/LandingScene.jsx'))

class SceneBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return <div className="blueprint-canvas h-full w-full bg-surface" />
    }
    return this.props.children
  }
}

function SceneFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="blueprint-canvas h-full w-full" />
    </div>
  )
}

function Hero() {
  return (
    <div className="relative hidden h-screen overflow-hidden border-r border-line-soft lg:block">
      <div className="absolute inset-0">
        <SceneBoundary>
          <Suspense fallback={<SceneFallback />}>
            <LandingScene />
          </Suspense>
        </SceneBoundary>
      </div>

      <div className="radial-fade pointer-events-none absolute inset-0 bg-gradient-to-t from-base via-base/75 to-base/20" />

      <div className="absolute inset-x-0 top-0 flex items-center gap-2.5 p-9">
        <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px] bg-gradient-to-br from-accent to-accent/55 font-mono text-[15px] font-bold text-[#1a1206]">
          A
        </div>
        <div className="font-mono text-[15px] font-bold tracking-tight">Arch-AI</div>
      </div>

      <div className="absolute inset-x-0 bottom-0 p-9">
        <div className="mb-2 font-mono text-[11px] tracking-widest text-accent uppercase">
          Software Architecture Learning Platform
        </div>
        <h1 className="max-w-[460px] text-[32px] leading-[1.15]">
          Design it. Simulate it. Prove it.
        </h1>
        <p className="mt-3 max-w-[440px] text-[14px] text-ink-dim">
          A workspace for software-engineering students to build layered architectures, run discrete-event
          simulations, mine the resulting event log, and defend every quality trade-off with numbers.
        </p>
      </div>
    </div>
  )
}

export default function Login({ mode = 'login' }) {
  const isRegister = mode === 'register'
  const { isAuthed, authChecked } = useApp()
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const location = useLocation()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  async function onSubmit(event) {
    event.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)
    try {
      const result = isRegister
        ? await register({ name, email, password })
        : await login({ email, password })
      dispatch({
        type: 'LOGIN',
        name: result?.name,
        email: result?.email,
        id: result?.id,
        role: result?.role,
      })
      const from = location.state?.from
      navigate(from && typeof from === 'string' ? from : '/dashboard', { replace: true })
    } catch (err) {
      setError(err?.message || 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  // Honour the page the user was originally sent away from. Hard-coding /dashboard here
  // meant a reload on /simulation bounced to the dashboard, whose auto-run pre-loaded a
  // cached result — so the Simulation page never presented its own empty state.
  const from = location.state?.from

  // Until the stored token has been verified, isAuthed is false for a reason that is not
  // "signed out". Rendering the form first would flash it at a user who still has a valid
  // session, so hold on a spinner for that one round-trip.
  if (!authChecked) {
    return (
      <div className="grid min-h-screen lg:grid-cols-2">
        <Hero />
        <div className="flex min-h-screen items-center justify-center px-5 py-12">
          <Spinner label="Checking your session…" />
        </div>
      </div>
    )
  }

  if (isAuthed) {
    return <Navigate to={from && typeof from === 'string' ? from : '/dashboard'} replace />
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <Hero />

      <div className="flex min-h-screen items-center justify-center px-5 py-12">
        <div className="w-full max-w-[380px]">
          <div className="mb-7 flex items-center gap-2.5">
            <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px] bg-gradient-to-br from-accent to-accent/55 font-mono text-[15px] font-bold text-[#1a1206]">
              A
            </div>
            <div className="min-w-0">
              <div className="font-mono text-[16px] font-bold tracking-tight">Arch-AI</div>
              <div className="mt-0.5 font-mono text-[10px] tracking-wider text-ink-faint uppercase">
                Design · Simulate · Evaluate
              </div>
            </div>
          </div>

          <h2 className="text-[24px] leading-tight">{isRegister ? 'Create account' : 'Sign in'}</h2>
          <p className="mt-1.5 text-[13.5px] text-ink-dim">
            {isRegister
              ? 'Set up a local workspace for your software-engineering architecture coursework.'
              : 'Pick up where you left off in your architecture evaluation workspace.'}
          </p>

          <form className="mt-6" onSubmit={onSubmit} noValidate>
            {isRegister && (
              <Field label="Full name">
                <input
                  className={inputClass}
                  type="text"
                  name="name"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                />
              </Field>
            )}

            <Field label="Email">
              <input
                className={inputClass}
                type="email"
                name="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
              />
            </Field>

            <Field
              label="Password"
              hint={isRegister ? 'At least 6 characters. Nothing leaves this browser.' : undefined}
            >
              <div className="relative">
                <input
                  className={`${inputClass} pr-10`}
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute top-1/2 right-2 flex -translate-y-1/2 cursor-pointer items-center justify-center text-ink-faint transition-colors hover:text-ink"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </Field>

            {error && (
              <div className="mb-3.5 rounded-[7px] border border-red bg-red/10 px-3 py-2.5 text-[12.5px] text-red">
                {error}
              </div>
            )}

            <Button type="submit" variant="primary" disabled={busy} className="w-full justify-center">
              {busy ? 'Working…' : isRegister ? 'Create account' : 'Sign in'}
              {!busy && <ArrowRight size={15} />}
            </Button>
          </form>

<div className="mt-5 border-t border-line-soft pt-5 text-center text-[12.5px] text-ink-dim">
            {isRegister ? 'Already have a workspace?' : 'New to Arch-AI?'}{' '}
            <button
              type="button"
              onClick={() => {
                setError('')
                navigate(isRegister ? '/login' : '/register', { replace: true })
              }}
              className="cursor-pointer font-semibold text-accent hover:underline"
            >
              {isRegister ? 'Sign in instead' : 'Create an account'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
