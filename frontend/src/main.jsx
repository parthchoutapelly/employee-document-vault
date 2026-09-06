// Configure AWS Amplify before the React tree mounts.
// This must be the first non-React import so Amplify is ready for
// any component that calls useAuth().
import { configureAmplify } from './services/amplify.js'
configureAmplify()

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
