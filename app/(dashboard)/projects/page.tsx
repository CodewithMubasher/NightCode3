"use client"

import { Folder, FolderPlus, Plus, Search, MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty"

interface Project {
  id: string
  name: string
  description: string
  updatedAt: string
}

const projects: Project[] = []

export default function ProjectsPage() {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-6 overflow-y-auto p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground shrink-0">Projects</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search..."
              className="h-8 w-44 pl-8 text-sm"
            />
          </div>
          <Button size="sm">
            <Plus size={14} />
            New
          </Button>
        </div>
      </div>

      {projects.length === 0 ? (
        <Card className="p-6">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderPlus size={16} />
              </EmptyMedia>
              <EmptyTitle>No projects yet</EmptyTitle>
              <EmptyDescription>
                Create your first project to organize your work.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm">
                <Plus size={14} />
                New Project
              </Button>
            </EmptyContent>
          </Empty>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {projects.map((project) => (
            <div
              key={project.id}
              className="flex items-start justify-between gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
            >
              <div className="flex items-start gap-3 min-w-0">
                <Folder size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <span className="text-sm text-foreground truncate block">{project.name}</span>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{project.description}</p>
                  <span className="text-[11px] text-muted-foreground mt-1 block">{project.updatedAt}</span>
                </div>
              </div>
              <Button size="icon-xs" variant="ghost" className="mt-0.5 shrink-0">
                <MoreHorizontal size={13} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}