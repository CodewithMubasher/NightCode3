import { TooltipProvider } from "@/components/ui/tooltip"
import { SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { TopHeader } from "@/components/top-header"
import { ArtifactPanel } from "@/components/artifact-panel"
import { SpaceBackground } from "@/components/space-background"

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <div className="flex h-dvh w-full overflow-hidden">
          <AppSidebar />
          <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
            <SpaceBackground />
            <TopHeader />
            <div className="flex flex-1 overflow-hidden">
              <main className="flex-1 overflow-hidden">
                {children}
              </main>
            </div>
          </div>
          <ArtifactPanel />
        </div>
      </SidebarProvider>
    </TooltipProvider>
  )
}
