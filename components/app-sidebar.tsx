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
  ArrowRightFromLine,
  Blocks,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useNightCodeStore } from "@/store/nightcode-store"

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
  React.useEffect(() => { setHydrated(true) }, [])
  const chats = useNightCodeStore((s) => s.chats)

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
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                if (item.isNav) {
                  return (
                    <SidebarMenuItem key={item.label}>
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
          <SidebarGroupLabel>Notes</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <Plus />
                  <span>New Notebook</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
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
                          >
                            <MoreHorizontal size={14} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="right" align="start" className="w-40">
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
                          <DropdownMenuItem disabled>
                            <ArrowRightFromLine size={14} />
                            <span>Move</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </SidebarMenuItem>
                )
              })}
              {recentChats.length === 0 && (
                <SidebarMenuItem>
                  <span className="px-2 text-xs text-muted-foreground">No chats yet</span>
                </SidebarMenuItem>
              )}
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
              <button className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
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
                <DropdownMenuItem>
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
    </Sidebar>
  )
}
