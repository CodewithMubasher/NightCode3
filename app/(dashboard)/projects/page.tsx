import { FolderPlus } from "lucide-react"

export default function ProjectsPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 -mt-16">
      <FolderPlus size={40} className="text-muted-foreground/40" />
      <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
      <p className="text-sm text-muted-foreground">
        Create and manage your projects
      </p>
    </div>
  )
}
