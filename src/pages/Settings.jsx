import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Database, LogOut, Moon, RotateCcw, ShieldAlert, User } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  Field,
  PageHead,
  RangeField,
  inputClass,
} from '../components/ui.jsx'
import { useApp, useDispatch } from '../store/AppContext.jsx'
import { defaultSettings } from '../store/reducer.js'
import { clearUserState, userStorageKey } from '../store/storage.js'
import { logout } from '../services/auth.js'

export default function Settings() {
  const { user, settings, workload, notify } = useApp()
  const dispatch = useDispatch()
  const navigate = useNavigate()

  const [name, setName] = useState(settings?.name || user?.name || '')
  const [email, setEmail] = useState(settings?.email || user?.email || '')
  const [confirmReset, setConfirmReset] = useState(false)

  const threshold = Number(settings?.alertThreshold ?? defaultSettings.alertThreshold)
  const arrivalRate = Number(workload?.arrivalRate ?? 120)

  function saveProfile(event) {
    event.preventDefault()
    dispatch({
      type: 'SET_SETTINGS',
      settings: { name: name.trim(), email: email.trim() },
    })
    notify('Profile saved')
  }

  function onThreshold(event) {
    const next = Math.max(0, Math.min(100, Number(event.target.value) || 0))
    dispatch({ type: 'SET_SETTINGS', settings: { alertThreshold: next } })
  }

  function onArrivalRate(value) {
    dispatch({ type: 'SET_WORKLOAD', workload: { arrivalRate: Math.max(1, Math.round(value)) } })
  }

  function signOut() {
    logout()
    dispatch({ type: 'LOGOUT' })
    navigate('/login', { replace: true })
  }

  function resetDemoData() {
    if (!confirmReset) {
      setConfirmReset(true)
      return
    }
    // Only this account's namespace is cleared. Every other account's preferences on
    // this browser are left untouched.
    try {
      clearUserState(user?.id)
      notify('Local preferences cleared')
    } catch {
      notify('Could not reach localStorage, reloading anyway', 'error')
    }
    window.location.reload()
  }

  return (
    <div>
      <PageHead
        eyebrow="Account"
        title="Settings"
        desc="Profile details, simulation defaults and session controls for this local workspace."
      />

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
        <Card title="Profile" sub="Shown on exported reports" className="xl:col-span-2">
          <form onSubmit={saveProfile}>
            <div className="grid grid-cols-1 gap-x-4 md:grid-cols-3">
              <Field label="Full name">
                <input
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Aditi Sharma"
                />
              </Field>
              <Field label="Email">
                <input
                  className={inputClass}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@student.edu"
                />
              </Field>
              <Field label="Role" hint="Assigned by this build, not editable.">
                <div className="flex h-[38px] items-center gap-2 rounded-[7px] border border-line bg-overlay px-3">
                  <User size={14} className="shrink-0 text-ink-faint" />
                  <span className="font-mono text-[13px] text-ink-dim">{user?.role || 'Student'}</span>
                </div>
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="primary">
                Save changes
              </Button>
              {user?.email && (
                <span className="font-mono text-[11.5px] text-ink-faint">
                  Signed in as {user.email}
                </span>
              )}
            </div>
          </form>
        </Card>

        <Card title="Preferences" sub="Defaults applied to new simulation runs">
          <Field
            label="Health score alert threshold"
            hint={`Evaluation pages flag any dimension scoring below ${threshold}/100.`}
          >
            <input
              className={inputClass}
              type="number"
              min={0}
              max={100}
              step={1}
              value={threshold}
              onChange={onThreshold}
            />
          </Field>

          <RangeField
            label="Default arrival rate"
            value={arrivalRate}
            onChange={onArrivalRate}
            min={10}
            max={500}
            step={10}
            format={(v) => `${v} req/s`}
          />

          <Field label="Theme">
            <select className={inputClass} defaultValue="blueprint" aria-label="Theme">
              <option value="blueprint">Blueprint Dark</option>
              <option value="light" disabled>
                Light — coming soon
              </option>
            </select>
          </Field>

          <div className="flex items-center gap-2 rounded-[8px] border border-line-soft bg-raised px-3 py-2.5">
            <Moon size={14} className="shrink-0 text-ink-faint" />
            <span className="text-[12.5px] text-ink-dim">
              Only the blueprint theme ships in this prototype. A light theme is stubbed above.
            </span>
          </div>
        </Card>

        <Card title="Danger zone" sub="Sign out, or wipe everything this prototype stored">
          <div className="mb-4 flex gap-2.5 rounded-[8px] border border-red/40 bg-red/10 p-3">
            <ShieldAlert size={16} className="mt-0.5 shrink-0 text-red" />
            <p className="text-[12.5px] text-ink-dim">
              Signing out clears the in-memory session. The stored workspace survives so you can sign
              back in with any credentials.
            </p>
          </div>

          <div className="mb-4">
            <Button variant="danger" icon={<LogOut size={15} />} onClick={signOut}>
              Sign out
            </Button>
          </div>

          <div className="flex gap-2.5 rounded-[8px] border border-line bg-raised p-3">
            <Database size={15} className="mt-0.5 shrink-0 text-ink-faint" />
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] text-ink-dim">
                Your projects are stored per account on the server and are only ever loaded
                for the account you are signed in as. This browser keeps just your
                preferences, under a key unique to you:{' '}
                <code className="font-mono text-[12px] text-accent">
                  {userStorageKey(user?.id) || 'archai.state.v1.u.&lt;your-id&gt;'}
                </code>
                . Clearing your browser data also removes it.
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Button
                  variant="danger"
                  icon={<RotateCcw size={15} />}
                  onClick={resetDemoData}
                  onBlur={() => setConfirmReset(false)}
                >
                  {confirmReset ? 'Click again to confirm' : 'Reset demo data'}
                </Button>
                {confirmReset && <Badge tone="red">Unrecoverable</Badge>}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
