import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Database, LogOut, Mail, Moon, RotateCcw, ShieldAlert, ShieldCheck, User } from 'lucide-react'
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
import { logout, saveReportProfile } from '../services/auth.js'

export default function Settings() {
  const { user, settings, workload, notify } = useApp()
  const dispatch = useDispatch()
  const navigate = useNavigate()

  // The report profile is server-owned, so it is seeded from the account and re-seeded
  // whenever a new account is signed in. Local state is only ever a draft: it is not the
  // source of truth and nothing here writes it to storage.
  const serverProfile = user?.reportProfile || {}
  const [displayName, setDisplayName] = useState(serverProfile.displayName || user?.name || '')
  const [affiliation, setAffiliation] = useState(serverProfile.affiliation || '')
  const [fieldErrors, setFieldErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  // Switching accounts must not carry the previous account's draft into the form.
  useEffect(() => {
    setDisplayName(serverProfile.displayName || user?.name || '')
    setAffiliation(serverProfile.affiliation || '')
    setFieldErrors({})
  }, [user?.id])

  const threshold = Number(settings?.alertThreshold ?? defaultSettings.alertThreshold)
  const arrivalRate = Number(workload?.arrivalRate ?? 120)

  async function saveProfile(event) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setFieldErrors({})
    try {
      const updated = await saveReportProfile({ displayName, affiliation })
      // Adopt the server's normalised values rather than the raw draft, so the form cannot
      // keep showing whitespace or casing the database did not accept.
      setDisplayName(updated?.reportProfile?.displayName ?? displayName.trim())
      setAffiliation(updated?.reportProfile?.affiliation ?? affiliation.trim())
      dispatch({
        type: 'SET_PROFILE',
        settings: {
          name: updated?.reportProfile?.displayName ?? displayName.trim(),
          affiliation: updated?.reportProfile?.affiliation ?? '',
        },
      })
      notify('Report profile saved')
    } catch (err) {
      // Field-level messages from the server are shown inline under the offending input;
      // anything else (network, 500) falls back to a single toast.
      const details = err?.details
      if (details && typeof details === 'object') {
        setFieldErrors(details)
        notify('Check the highlighted fields', 'error')
      } else {
        notify(err?.message || 'Could not save the report profile.', 'error')
      }
    } finally {
      setSaving(false)
    }
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
        <Card title="Report profile" sub="How you are credited on exported reports. Saved to your account." className="xl:col-span-2">
          <form onSubmit={saveProfile} noValidate>
            <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2">
              <Field label="Display name" error={fieldErrors.displayName}>
                <input
                  className={inputClass}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Aditi Sharma"
                  aria-invalid={Boolean(fieldErrors.displayName)}
                  maxLength={80}
                />
              </Field>
              <Field
                label="Affiliation"
                error={fieldErrors.affiliation}
                hint="Institution, department or team shown beside your name."
              >
                <input
                  className={inputClass}
                  value={affiliation}
                  onChange={(e) => setAffiliation(e.target.value)}
                  placeholder="Department of Computer Science, MIT"
                  aria-invalid={Boolean(fieldErrors.affiliation)}
                  maxLength={120}
                />
              </Field>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save report profile'}
              </Button>
              <span className="font-mono text-[11.5px] text-ink-faint">
                Stored on your account — visible on any device you sign in from.
              </span>
            </div>
          </form>
        </Card>

        <Card title="Account" sub="Your sign-in identity. Not editable here." className="xl:col-span-2">
          <div className="grid grid-cols-1 gap-x-4 md:grid-cols-3">
            <Field label="Login name" hint="Set at registration.">
              <div className="flex h-[38px] items-center gap-2 rounded-[7px] border border-line bg-overlay px-3">
                <User size={14} className="shrink-0 text-ink-faint" />
                <span className="truncate font-mono text-[13px] text-ink-dim">
                  {user?.name || '—'}
                </span>
              </div>
            </Field>
            <Field label="Login email" hint="Changing this requires re-registering; the report profile above cannot alter it.">
              <div className="flex h-[38px] items-center gap-2 overflow-hidden rounded-[7px] border border-line bg-overlay px-3">
                <Mail size={14} className="shrink-0 text-ink-faint" />
                <span className="truncate font-mono text-[13px] text-ink-dim">
                  {user?.email || '—'}
                </span>
              </div>
            </Field>
            <Field label="Role" hint="Assigned by this build, not editable.">
              <div className="flex h-[38px] items-center gap-2 rounded-[7px] border border-line bg-overlay px-3">
                <ShieldCheck size={14} className="shrink-0 text-ink-faint" />
                <span className="font-mono text-[13px] text-ink-dim">{user?.role || 'Student'}</span>
              </div>
            </Field>
          </div>
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
