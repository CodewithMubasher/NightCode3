"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import {
  Eclipse,
  CirclePlus,
  FolderPlus,
  Wrench,
  Plus,
  Box,
  EllipsisVertical,
  LogOut,
  User,
  Settings,
  CreditCard,
  MoreHorizontal,
  Pencil,
  Trash2,
  Minus,
  ArrowRightFromLine,
  Blocks,
  Folder,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu"
import { useNightCodeStore } from "@/store/nightcode-store"
import { SettingsDialog } from "@/components/settings-dialog"
import { Skeleton } from "@/components/ui/skeleton"

const navItems = [
  { icon: CirclePlus, label: "New Chat", href: "/", isNav: true },
  { icon: Box, label: "Agent Studio", href: "/studio", isNav: true },
  { icon: FolderPlus, label: "Projects", href: "/projects", isNav: true },
  { icon: Wrench, label: "Customize", href: "/customize", isNav: true },
  { icon: Blocks, label: "Artifacts", isNav: false },
]

export function AppSidebar() {
  const router = useRouter()
  const [hydrated, setHydrated] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  React.useEffect(() => { setHydrated(true) }, [])
  const chats = useNightCodeStore((s) => s.chats)
  const projects = useNightCodeStore((s) => s.projects)

  const recentChats = hydrated
    ? [...chats].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 15)
    : []

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="p-0">
        <div className="mt-1.5 flex items-center gap-2 px-[18px] py-[12.4px]">
          <Eclipse size={22} style={{ color: "var(--primary-color)" }} />
          <span className="text-base font-semibold tracking-wider">NIGHTCODE</span>
        </div>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent className="mobile-sidebar-content">
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item, idx) => {
                if (item.isNav) {
                  return (
                    <SidebarMenuItem key={item.label} className="mobile-sidebar-item" style={{ animationDelay: `${idx * 0.04}s` }}>
                      <SidebarMenuButton asChild>
                        <Link href={item.href ?? "#"}>
                          <item.icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                }
                return (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton onClick={() => {
                      window.dispatchEvent(new CustomEvent("toggle-artifact-panel"))
                    }}>
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarSeparator />
        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {projects.map((project, idx) => (
                <SidebarMenuItem key={project.id} className="mobile-sidebar-item" style={{ animationDelay: `${(navItems.length + idx) * 0.04}s` }}>
                  <SidebarMenuButton asChild>
                    <Link href={`/projects/${project.id}`}>
                      <Folder size={14} />
                      <span className="truncate">{project.name}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {projects.length === 0 && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link href="/projects">
                      <Plus />
                      <span>New Project</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarSeparator />
        <SidebarGroup>
          <SidebarGroupLabel>Chats</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {recentChats.map((chat) => {
                return (
                  <SidebarMenuItem key={chat.id}>
                    <div className="group relative flex items-center">
                      <SidebarMenuButton asChild>
                        <Link
                          href={`/chat/${chat.id}`}
                          onClick={() => useNightCodeStore.getState().setActiveChat(chat.id)}
                        >
                          <span className="truncate">{chat.title.length > 25 ? `${chat.title.slice(0, 25)}...` : chat.title}</span>
                        </Link>
                      </SidebarMenuButton>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            onClick={(e) => e.stopPropagation()}
                            className="absolute right-1 flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-hover:opacity-100"
                            aria-label="Chat options"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                        </DropdownMenuTrigger>
                          <DropdownMenuContent side="right" align="start" className="w-48">
                          <DropdownMenuItem
                            onClick={() => {
                              const title = prompt("Rename chat:", chat.title)
                              if (title?.trim()) useNightCodeStore.getState().renameChat(chat.id, title.trim())
                            }}
                          >
                            <Pencil size={14} />
                            <span>Rename</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              useNightCodeStore.getState().deleteChat(chat.id)
                              if (window.location.pathname === `/chat/${chat.id}`) router.push("/")
                            }}
                            variant="destructive"
                          >
                            <Trash2 size={14} />
                            <span>Delete</span>
                          </DropdownMenuItem>
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger className="whitespace-nowrap">
                              <ArrowRightFromLine size={14} />
                              <span>Move to project</span>
                            </DropdownMenuSubTrigger>
                            <DropdownMenuPortal>
                              <DropdownMenuSubContent>
                                {projects.map((p) => (
                                  <DropdownMenuItem
                                    key={p.id}
                                    onClick={() => useNightCodeStore.getState().moveChatToProject(chat.id, p.id)}
                                  >
                                    <Folder size={14} />
                                    <span>{p.name}</span>
                                  </DropdownMenuItem>
                                ))}
                                {projects.length === 0 && (
                                  <DropdownMenuItem disabled>
                                    <span>No projects yet</span>
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => useNightCodeStore.getState().moveChatToProject(chat.id, null)}
                                >
                                  <Minus size={14} />
                                  <span>Remove from project</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => router.push("/projects")}
                                >
                                  <Plus size={14} />
                                  <span>New project</span>
                                </DropdownMenuItem>
                              </DropdownMenuSubContent>
                            </DropdownMenuPortal>
                          </DropdownMenuSub>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </SidebarMenuItem>
                )
              })}
              {!hydrated ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <SidebarMenuItem key={i}>
                    <div className="flex items-center gap-2 px-2 py-1">
                      <Skeleton className="h-4 flex-1 rounded" />
                    </div>
                  </SidebarMenuItem>
                ))
              ) : recentChats.length === 0 ? (
                <SidebarMenuItem>
                  <span className="px-2 text-xs text-muted-foreground">No chats yet</span>
                </SidebarMenuItem>
              ) : null}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t p-3">
        <div className="flex w-full items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
            U
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">User</span>
            <span className="truncate text-xs text-muted-foreground">user@example.com</span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" aria-label="User menu">
                <EllipsisVertical size={16} className="shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-48">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem>
                  <User size={14} />
                  <span>Profile</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                  <Settings size={14} />
                  <span>Settings</span>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <CreditCard size={14} />
                  <span>Billing</span>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <LogOut size={14} />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </SidebarFooter>
      <style>{`
        @keyframes sidebar-item-in {
          from { opacity: 0; transform: translateX(-12px); }
          to { opacity: 1; transform: translateX(0); }
        }
        [data-mobile="true"] .mobile-sidebar-content .sidebar-group-content > div > div {
          opacity: 0;
          animation: sidebar-item-in 0.3s cubic-bezier(0.25, 0.1, 0.25, 1) forwards;
        }
        [data-mobile="true"] .mobile-sidebar-content .sidebar-group-content > div > div:nth-child(1) { animation-delay: 0.02s; }
        [data-mobile="true"] .mobile-sidebar-content .sidebar-group-content > div > div:nth-child(2) { animation-delay: 0.04s; }
        [data-mobile="true"] .mobile-sidebar-content .sidebar-group-content > div > div:nth-child(3) { animation-delay: 0.06s; }
        [data-mobile="true"] .mobile-sidebar-content .sidebar-group-content > div > div:nth-child(4) { animation-delay: 0.08s; }
        [data-mobile="true"] .mobile-sidebar-content .sidebar-group-content > div > div:nth-child(5) { animation-delay: 0.1s; }
        [data-mobile="true"] .mobile-sidebar-content .sidebar-group-content > div > div:nth-child(6) { animation-delay: 0.12s; }
        [data-mobile="true"] .mobile-sidebar-content .sidebar-group-content > div > div:nth-child(7) { animation-delay: 0.14s; }
        [data-mobile="true"] .mobile-sidebar-content .sidebar-group-content > div > div:nth-child(8) { animation-delay: 0.16s; }
        [data-mobile="true"] .mobile-sidebar-content .sidebar-group-content > div > div:nth-child(9) { animation-delay: 0.18s; }
        [data-mobile="true"] .mobile-sidebar-content .sidebar-group-content > div > div:nth-child(10) { animation-delay: 0.2s; }
      `}</style>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </Sidebar>
  )
}
