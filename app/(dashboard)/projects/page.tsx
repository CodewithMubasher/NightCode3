"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Folder,
  FolderPlus,
  Plus,
  Search,
  MoreHorizontal,
  X,
  Star,
  Trash2,
  Pencil,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useNightCodeStore } from "@/store/nightcode-store"

export default function ProjectsPage() {
  const router = useRouter()
  const projects = useNightCodeStore((s) => s.projects)
  const createProject = useNightCodeStore((s) => s.createProject)
  const renameProject = useNightCodeStore((s) => s.renameProject)
  const deleteProject = useNightCodeStore((s) => s.deleteProject)
  const toggleStarProject = useNightCodeStore((s) => s.toggleStarProject)

  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [desc, setDesc] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleCreate() {
    if (!name.trim() || loading) return
    setLoading(true)
    const chatId = await createProject(name.trim(), desc.trim())
    await new Promise((r) => setTimeout(r, 2000))
    setLoading(false)
    setOpen(false)
    setName("")
    setDesc("")
    router.push(`/chat/${chatId}`)
  }

  function handleRename(id: string, current: string) {
    const name = prompt("Rename project:", current)
    if (name?.trim()) renameProject(id, name.trim())
  }

  function handleDelete(id: string) {
    if (confirm("Delete this project?")) deleteProject(id)
  }

  const sorted = [...projects].sort((a, b) => {
    if (a.starred !== b.starred) return a.starred ? -1 : 1
    return b.updatedAt - a.updatedAt
  })

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-6 overflow-y-auto p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground shrink-0">Projects</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <Input placeholder="Search..." className="h-8 w-44 pl-8 text-sm" />
          </div>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus size={14} />
            New
          </Button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <Card className="p-6">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderPlus size={16} />
              </EmptyMedia>
              <EmptyTitle>No projects yet</EmptyTitle>
              <EmptyDescription>Create your first project to organize your work.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" onClick={() => setOpen(true)}>
                <Plus size={14} />
                New Project
              </Button>
            </EmptyContent>
          </Empty>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {sorted.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="group flex items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-3 transition-colors duration-150 hover:bg-sidebar-accent"
            >
              {project.starred ? (
                <Star size={16} className="size-4 shrink-0 fill-yellow-500 text-yellow-500" />
              ) : (
                <Folder size={16} className="size-4 shrink-0 text-sidebar-foreground/50" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-sidebar-foreground">{project.name}</div>
                {project.description && (
                  <div className="truncate text-xs text-sidebar-foreground/50">{project.description}</div>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    onClick={(e) => e.preventDefault()}
                    className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/50 opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-foreground group-hover:opacity-100"
                  >
                    <MoreHorizontal size={13} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="bottom" align="end" className="w-36">
                  <DropdownMenuItem onClick={() => handleRename(project.id, project.name)}>
                    <Pencil size={14} />
                    <span>Rename</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => toggleStarProject(project.id)}>
                    <Star size={14} />
                    <span>{project.starred ? "Unstar" : "Star"}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleDelete(project.id)}
                    variant="destructive"
                  >
                    <Trash2 size={14} />
                    <span>Delete</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Link>
          ))}
        </div>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl ring-1 ring-foreground/10"
            onClick={(e) => e.stopPropagation()}
          >
            {loading ? (
              <div className="flex flex-col items-center gap-4 py-8">
                <Loader2 size={32} className="animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Creating project...</p>
              </div>
            ) : (
              <>
                <div className="mb-1 flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Create a project</h2>
                  <button
                    onClick={() => setOpen(false)}
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X size={18} />
                  </button>
                </div>
                <p className="mb-5 text-sm text-muted-foreground">What are you working on?</p>
                <Input
                  placeholder="Name your project"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mb-4"
                  autoFocus
                />
                <p className="mb-1 text-sm text-muted-foreground">What are you trying to achieve?</p>
                <textarea
                  placeholder="Describe your project, goals etc"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  className="mb-6 flex min-h-[100px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreate} disabled={!name.trim()}>
                    Create Project
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
