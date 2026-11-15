import React from 'react'
import { createRoot } from 'react-dom/client'
import {
  Chart as ChartJS, RadialLinearScale, LinearScale, CategoryScale, PointElement, LineElement,
  Filler, Tooltip, Legend,
} from 'chart.js'
import './index.css'
import App from './App.jsx'

ChartJS.register(RadialLinearScale, LinearScale, CategoryScale, PointElement, LineElement, Filler, Tooltip, Legend)
ChartJS.defaults.color = '#9ca3af'
ChartJS.defaults.borderColor = '#1f2937'
ChartJS.defaults.font.family = 'Inter, Pretendard, "Malgun Gothic", system-ui, sans-serif'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
