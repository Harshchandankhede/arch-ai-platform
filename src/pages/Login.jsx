import { Component, Suspense, lazy, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Info } from 'lucide-react'
import { useApp, useDispatch } from '../store/AppContext.jsx'
import { login, register } from '../services/auth.js'
import { Button, Field, inputClass } from '../components/ui.jsx'

const LandingScene = lazy(() => import('../features/three/LandingScene.jsx'))

const DEMO = {
  name: 'Aditi Sharma',
  email: 'aditi.sharma@student.edu',
  password: 'password123',
}

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
  const { isAuthed } = useApp()
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const location = useLocation()

  const [name, setName] = useState(DEMO.name)
  const [email, setEmail] = useState(DEMO.email)
  const [password, setPassword] = useState(DEMO.password)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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

  if (isAuthed) return <Navigate to="/dashboard" replace />

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
                  placeholder="Aditi Sharma"
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
                placeholder="you@student.edu"
              />
            </Field>

            <Field
              label="Password"
              hint={isRegister ? 'At least 6 characters. Nothing leaves this browser.' : undefined}
            >
              <input
                className={inputClass}
                type="password"
                name="password"
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="password123"
              />
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

          <div className="mt-5 flex gap-2.5 rounded-[8px] border border-accent/40 bg-accent/10 p-3">
            <Info size={15} className="mt-0.5 shrink-0 text-accent" />
            <div>
              <div className="font-mono text-[10.5px] tracking-widest text-accent uppercase">
                Connected to Arch-AI API
              </div>
              <p className="mt-1 text-[12.5px] text-ink-dim">
                Accounts are stored in MongoDB with a bcrypt-hashed password and authenticated by JWT.
                Projects, simulation results and interview answers are still kept in this browser's
                localStorage until those endpoints are wired.
              </p>
            </div>
          </div>

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
