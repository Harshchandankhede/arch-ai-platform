import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AppLayout from './layouts/AppLayout.jsx'
import { useApp } from './store/AppContext.jsx'
import { Spinner } from './components/ui.jsx'

const Login = lazy(() => import('./pages/Login.jsx'))
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'))
const Projects = lazy(() => import('./pages/Projects.jsx'))
const Builder = lazy(() => import('./pages/Builder.jsx'))
const Simulation = lazy(() => import('./pages/Simulation.jsx'))
const ProcessMining = lazy(() => import('./pages/ProcessMining.jsx'))
const Evaluation = lazy(() => import('./pages/Evaluation.jsx'))
const Recommendations = lazy(() => import('./pages/Recommendations.jsx'))
const Comparison = lazy(() => import('./pages/Comparison.jsx'))
const Reports = lazy(() => import('./pages/Reports.jsx'))
const Interview = lazy(() => import('./pages/Interview.jsx'))
const Learning = lazy(() => import('./pages/Learning.jsx'))
const Settings = lazy(() => import('./pages/Settings.jsx'))

function Protected({ children }) {
  const { isAuthed } = useApp()
  const location = useLocation()
  if (!isAuthed) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}

function Loading({ label }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner label={label} />
    </div>
  )
}

export default function App() {
  return (
    <Suspense fallback={<Loading label="Loading module…" />}>
      <Routes>
        <Route path="/login" element={<Login mode="login" />} />
        <Route path="/register" element={<Login mode="register" />} />

        <Route
          element={
            <Protected>
              <AppLayout />
            </Protected>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/builder" element={<Builder />} />
          <Route path="/simulation" element={<Simulation />} />
          <Route path="/process-mining" element={<ProcessMining />} />
          <Route path="/evaluation" element={<Evaluation />} />
          <Route path="/recommendations" element={<Recommendations />} />
          <Route path="/comparison" element={<Comparison />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/interview" element={<Interview />} />
          <Route path="/learning" element={<Learning />} />
          <Route path="/settings" element={<Settings />} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  )
}
