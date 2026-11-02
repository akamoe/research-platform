import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import App from "./App"
import { applyThemeStyle, savedThemeStyle } from "./lib/themes"

// Apply the saved color theme before the first paint.
applyThemeStyle(savedThemeStyle())

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
