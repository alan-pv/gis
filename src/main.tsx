import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/kalam/latin-400.css'
import '@fontsource/kalam/latin-ext-400.css'
import '@fontsource/kalam/latin-700.css'
import '@fontsource/kalam/latin-ext-700.css'
import './index.css'
import './ui/tokens.css'
import App from './App'
import { ensureBoardFontLoaded } from './canvas/font'

// The board font is awaited BEFORE the first render so that the canvas's first
// text measurement does not use the fallback font.
void ensureBoardFontLoaded().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
