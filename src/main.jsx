import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { AppProvider } from './store/AppContext.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* Outermost, so a render error anywhere below shows a real message instead of a blank
        page. Without it a single bad reference silently unmounts the entire tree. */}
    <ErrorBoundary>
      <BrowserRouter>
        <AppProvider>
          <App />
        </AppProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
