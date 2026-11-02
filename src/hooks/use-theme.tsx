import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { applyThemeStyle, BUILTIN_THEMES, saveThemeStyle, savedThemeStyle, type ThemeStyle } from "@/lib/themes"

type Theme = "light" | "dark" | "system"
const ThemeContext = createContext<{
  theme: Theme
  setTheme: (t: Theme) => void
  style: ThemeStyle
  setStyle: (s: ThemeStyle) => void
}>({
  theme: "system",
  setTheme: () => {},
  style: BUILTIN_THEMES[0],
  setStyle: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("rp-theme") as Theme) || "system")
  const [style, setStyle] = useState<ThemeStyle>(() => savedThemeStyle() ?? BUILTIN_THEMES[0])

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches)
      document.documentElement.classList.toggle("dark", dark)
    }
    apply()
    localStorage.setItem("rp-theme", theme)
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [theme])

  useEffect(() => {
    applyThemeStyle(style)
    saveThemeStyle(style)
  }, [style])

  return <ThemeContext.Provider value={{ theme, setTheme, style, setStyle }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
