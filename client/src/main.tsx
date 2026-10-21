import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './navigation.css'
import './design-system.css'
import './workspace-tabs.css'
import './overview-metrics.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
