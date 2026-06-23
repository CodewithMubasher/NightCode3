"use client"

import { TooltipProvider } from "@/components/ui/tooltip"
import { SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { TopHeader } from "@/components/top-header"
import { ArtifactPanel } from "@/components/artifact-panel"
import { WebPreviewPanel } from "@/components/web-preview-panel"
import { SpaceBackground } from "@/components/space-background"
import { useNightCodeStore } from "@/store/nightcode-store"

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const isPreviewOpen = useNightCodeStore((s) => s.isPreviewOpen)

  return (
    <TooltipProvider>
      <SidebarProvider>
        <div className="flex h-dvh w-full overflow-hidden">
          <AppSidebar />
          <div
            className="relative flex flex-col overflow-hidden"
            style={{ flex: isPreviewOpen ? "3 1 0%" : "1 1 0%" }}
          >
            <SpaceBackground />
            <TopHeader />
            <div className="flex flex-1 overflow-hidden">
              <main className="flex-1 overflow-hidden">
                {children}
              </main>
            </div>
          </div>
          <WebPreviewPanel />
          <ArtifactPanel />
        </div>
      </SidebarProvider>
    </TooltipProvider>
  )
}
