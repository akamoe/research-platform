import { useEffect, useState } from "react"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { SettingsDialog } from "@/components/settings-dialog"
import { MusicProvider } from "@/components/music/music-provider"
import { ThemeProvider } from "@/hooks/use-theme"
import { api, type PublicSettings } from "@/lib/api"
import { useRoute } from "@/lib/router"
import { HomePage } from "@/pages/home"
import { ProjectPage } from "@/pages/project"

export default function App() {
  const route = useRoute()
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    api.settings().then(setSettings, () => {})
  }, [])

  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={400}>
        <MusicProvider>
          {route.name === "home" && <HomePage onOpenSettings={() => setSettingsOpen(true)} />}
          {route.name === "project" && settings && (
            <ProjectPage
              key={route.projectId}
              projectId={route.projectId}
              notePath={route.note}
              paperId={route.paper}
              view={route.view}
              kbPage={route.page}
              settings={settings}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          )}
          {settings && (
            <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} onSettings={setSettings} />
          )}
          <Toaster position="top-center" />
        </MusicProvider>
      </TooltipProvider>
    </ThemeProvider>
  )
}
