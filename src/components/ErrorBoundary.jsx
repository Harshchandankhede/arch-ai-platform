import { Component } from 'react'
import { TriangleAlert, RotateCcw } from 'lucide-react'

/**
 * Catches render-time errors anywhere below it.
 *
 * Without this, a single ReferenceError in any component unmounts the whole React tree and
 * the user gets a blank page with no explanation — which is exactly what happened when
 * `colors` was used in AppLayout without being imported. Nothing appears in the DOM, so
 * there is nothing to inspect and no clue what went wrong.
 *
 * This component makes the failure visible and offers a way out, and it deliberately shows
 * the real message and stack in development: a swallowed error here would just move the
 * debugging problem somewhere less obvious.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    // Keep it in the console too, so the usual debugging workflow still works.
    console.error('Unhandled render error:', error, info?.componentStack)
  }

  handleReset = () => {
    this.setState({ error: null, info: null })
  }

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex min-h-screen items-center justify-center px-5 py-12">
        <div className="w-full max-w-[620px]">
          <div className="rounded-panel border border-red bg-red/8 p-5">
            <div className="mb-2 flex items-center gap-2 font-mono text-[12px] font-semibold text-red uppercase">
              <TriangleAlert size={15} />
              Something broke while rendering
            </div>
            <p className="text-[13px] text-ink">
              The page hit an unexpected error and stopped. Reloading usually clears it. If it
              keeps happening, a recent change introduced the problem below.
            </p>

            <pre className="mt-3 overflow-x-auto rounded-[7px] border border-line bg-base-alt p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink">
              {String(error?.message || error)}
              {info?.componentStack ? `\n${info.componentStack.trim()}` : ''}
            </pre>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="cursor-pointer rounded-[7px] border border-line bg-raised px-3.5 py-2 text-[13px] font-semibold text-ink transition hover:border-ink-faint"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex cursor-pointer items-center gap-2 rounded-[7px] border border-accent bg-accent px-3.5 py-2 text-[13px] font-semibold text-[#1a1206] transition hover:brightness-110"
              >
                <RotateCcw size={14} />
                Reload the page
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }
}