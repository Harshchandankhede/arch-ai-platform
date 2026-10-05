import { useEffect, useState } from 'react'

/**
 * Tracks the user's `prefers-reduced-motion` setting and stays subscribed to changes.
 *
 * Lives in lib/ rather than inside a feature folder because more than one layer needs it:
 * the login hero's 3D scene and the score count-up both have to stand still for readers
 * who have asked the system for less motion.
 */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  return reduced
}