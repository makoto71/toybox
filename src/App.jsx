import { useState } from 'react'
import './App.css'

function App() {
  return (
    <div className="portal-container">
      <header className="portal-header">
        <h1>tomori</h1>
        <p>あそびのひろば</p>
      </header>

      <main className="app-grid">
        <a href="/apps/oekaki/index.html" className="app-card oekaki-card">
          <div className="app-icon">🎨</div>
          <h2>おえかき</h2>
        </a>

        <a href="/apps/oekaki-3d/index.html" className="app-card oekaki-3d-card">
          <div className="app-icon">🧊</div>
          <h2>3Dおえかき</h2>
        </a>

        <a href="/apps/camera-ar/index.html" className="app-card camera-ar-card">
          <div className="app-icon">📷</div>
          <h2>カメラAR</h2>
        </a>

        {/* 今後アプリが増えたらここに追加 */}
        <div className="app-card coming-soon">
          <div className="app-icon">?</div>
          <h2>またね</h2>
        </div>
      </main>
    </div>
  )
}

export default App
