"use client"

import { useState, useEffect } from "react"
import { Search, Plus, Puzzle, Cpu, BrainCircuit, Scroll, Cable } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

import type { SkillInfo } from "@/types"
type Tab = "skills" | "mcps" | "memory"

const TABS: { key: Tab; label: string; icon: typeof Puzzle }[] = [
  { key: "skills", label: "Skills", icon: Puzzle },
  { key: "mcps", label: "MCPs", icon: Cpu },
  { key: "memory", label: "Memory", icon: BrainCircuit },
]

interface MCPConfigItem {
  name: string
  type: "local" | "remote"
  command?: string
  args?: string[]
  url?: string
  environment?: Record<string, string>
  enabled: boolean
}

const emptyForm: MCPConfigItem = {
  name: "",
  type: "local",
  command: "",
  args: [],
  url: "",
  environment: {},
  enabled: true,
}

export default function CustomizePage() {
  const [activeTab, setActiveTab] = useState<Tab>("skills")
  const [search, setSearch] = useState("")
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [activeSkills, setActiveSkills] = useState<Set<string>>(new Set())
  const [mcps, setMcps] = useState<MCPConfigItem[]>([])
  const [mcpStatuses, setMcpStatuses] = useState<Record<string, string>>({})
  const [mcpError, setMcpError] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<MCPConfigItem>(emptyForm)
  const [envKey, setEnvKey] = useState("")
  const [envVal, setEnvVal] = useState("")
  const mcpSearch = activeTab === "mcps" ? search : ""

  useEffect(() => {
    fetch("/api/skills").then((r) => r.json()).then(setSkills).catch(() => {})
    fetchMcps()
  }, [])

  async function fetchMcps() {
    try {
      const res = await fetch("/api/mcps")
      if (res.ok) {
        const data = await res.json()
        setMcps(data.configs ?? [])
        setMcpStatuses(data.statuses ?? {})
      }
    } catch {}
  }

  function toggleSkill(slug: string) {
    setActiveSkills((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  const filteredSkills = skills.filter(
    (s) => s.title.toLowerCase().includes(search.toLowerCase()) || s.slug.toLowerCase().includes(search.toLowerCase())
  )

  const filteredMcps = mcps.filter(
    (m) => m.name.toLowerCase().includes(mcpSearch.toLowerCase())
  )

  function openNewForm() {
    setForm(emptyForm)
    setEnvKey("")
    setEnvVal("")
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
  }

  async function saveForm() {
    if (!form.name || !form.type) return
    const res = await fetch("/api/mcps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })
    if (res.ok) {
      const data = await res.json()
      setMcps(data.configs ?? [])
      setMcpStatuses(data.statuses ?? {})
      if (data.error) setMcpError(data.error)
      else setMcpError("")
    }
    closeForm()
  }

  async function toggleMCP(name: string) {
    const res = await fetch("/api/mcps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle", name }),
    })
    if (res.ok) {
      const data = await res.json()
      setMcps(data.configs ?? [])
      setMcpStatuses(data.statuses ?? {})
      if (data.error) setMcpError(data.error)
      else setMcpError("")
    }
  }

  async function deleteMCP(name: string) {
    const res = await fetch("/api/mcps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", name }),
    })
    if (res.ok) {
      const data = await res.json()
      setMcps(data.configs ?? [])
      setMcpStatuses(data.statuses ?? {})
    }
  }

  function addEnvVar() {
    if (!envKey) return
    setForm({ ...form, environment: { ...form.environment, [envKey]: envVal } })
    setEnvKey("")
    setEnvVal("")
  }

  function removeEnvVar(key: string) {
    const e = { ...form.environment }
    delete e[key]
    setForm({ ...form, environment: e })
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-6 overflow-y-auto p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground shrink-0">Customization</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="h-8 w-44 pl-8 text-sm"
            />
          </div>
          <Button size="sm" onClick={openNewForm}>
            <Plus size={14} />
            New
          </Button>
        </div>
      </div>

      <div className="flex gap-1">
        {TABS.map((tab) => (
          <Button
            key={tab.key}
            size="sm"
            variant={activeTab === tab.key ? "default" : "outline"}
            onClick={() => setActiveTab(tab.key)}
          >
            <tab.icon size={14} />
            {tab.label}
          </Button>
        ))}
      </div>

      {activeTab === "skills" && (
        <div className="flex flex-col gap-4">
          <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Puzzle size={16} />
            Skills
          </h2>
          {filteredSkills.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {search ? "No skills match your search" : "No skills available"}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {filteredSkills.map((skill) => (
                <div key={skill.slug} className="flex items-start justify-between gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
                  <div className="flex items-start gap-3 min-w-0">
                    <Scroll size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <span className="text-sm text-foreground truncate block">{skill.title}</span>
                      {skill.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{skill.description}</p>
                      )}
                    </div>
                  </div>
                  <Switch
                    className="mt-0.5 shrink-0"
                    checked={activeSkills.has(skill.slug)}
                    onCheckedChange={() => toggleSkill(skill.slug)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "mcps" && (
        <div className="flex flex-col gap-4">
          <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Cpu size={16} />
            MCP Servers
          </h2>
          {mcpError && (
            <div className="rounded border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">{mcpError}</div>
          )}
          {filteredMcps.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {mcpSearch ? "No MCPs match your search" : "No MCPs configured yet."}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {filteredMcps.map((mcp) => {
                const status = mcpStatuses[mcp.name] ?? "disconnected"
                return (
                  <div key={mcp.name} className="flex items-start justify-between gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
                    <div className="flex items-start gap-3 min-w-0">
                      <Cable size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm text-foreground truncate">{mcp.name}</span>
                          <Badge variant="outline" className="text-[10px] h-4 px-1">{mcp.type}</Badge>
                        </div>
                        <span className={`text-xs text-muted-foreground mt-0.5 block ${status === "connected" ? "text-green-500" : status === "error" ? "text-destructive" : ""}`}>
                          {status}
                        </span>
                      </div>
                    </div>
                    <Switch
                      className="mt-0.5 shrink-0"
                      checked={mcp.enabled}
                      onCheckedChange={() => toggleMCP(mcp.name)}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === "memory" && (
        <div className="flex flex-col gap-4">
          <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <BrainCircuit size={16} />
            Memory
          </h2>
          <div className="flex items-center justify-center rounded-xl bg-card p-6 ring-1 ring-foreground/10">
            <p className="text-sm text-muted-foreground">No memory files yet.</p>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={closeForm}>
          <Card className="w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu size={16} />
                New MCP Server
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
                <div>
                  <label className="mb-1 block text-sm text-muted-foreground">Name</label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="my-server"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-muted-foreground">Type</label>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={form.type === "local" ? "default" : "outline"}
                      onClick={() => setForm({ ...form, type: "local", url: "" })}
                      className="flex-1"
                    >
                      Local
                    </Button>
                    <Button
                      size="sm"
                      variant={form.type === "remote" ? "default" : "outline"}
                      onClick={() => setForm({ ...form, type: "remote", command: "", args: [] })}
                      className="flex-1"
                    >
                      Remote
                    </Button>
                  </div>
                </div>
                {form.type === "local" && (
                  <div>
                    <label className="mb-1 block text-sm text-muted-foreground">Command</label>
                    <Input
                      value={form.command}
                      onChange={(e) => setForm({ ...form, command: e.target.value })}
                      placeholder="python F:/win-mcp/server.py"
                    />
                  </div>
                )}
                {form.type === "remote" && (
                  <div>
                    <label className="mb-1 block text-sm text-muted-foreground">URL</label>
                    <Input
                      value={form.url}
                      onChange={(e) => setForm({ ...form, url: e.target.value })}
                      placeholder="https://mcp.example.com/mcp"
                    />
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-sm text-muted-foreground">Environment (optional)</label>
                  <div className="flex gap-2 mb-1.5">
                    <Input
                      value={envKey}
                      onChange={(e) => setEnvKey(e.target.value)}
                      placeholder="KEY"
                      className="h-8"
                    />
                    <Input
                      value={envVal}
                      onChange={(e) => setEnvVal(e.target.value)}
                      placeholder="VALUE"
                      className="h-8"
                    />
                    <Button size="sm" onClick={addEnvVar}>Add</Button>
                  </div>
                  {form.environment && Object.entries(form.environment).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(form.environment).map(([k, v]) => (
                        <Badge key={k} variant="secondary" className="gap-1 pr-1">
                          {k}={v}
                          <button onClick={() => removeEnvVar(k)} className="hover:text-foreground">&times;</button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm text-muted-foreground">Enabled</label>
                  <Switch
                    checked={form.enabled}
                    onCheckedChange={(v) => setForm({ ...form, enabled: v })}
                  />
                </div>
              </div>
            </CardContent>
            <div className="flex justify-end gap-2 px-6 pb-6">
              <Button variant="outline" onClick={closeForm}>Cancel</Button>
              <Button onClick={saveForm}>Save</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
