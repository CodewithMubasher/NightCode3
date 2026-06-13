import { Key } from "lucide-react"

export default function SettingsPage() {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-6 overflow-y-auto p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your API keys and preferences
        </p>
      </div>
      <div className="rounded-lg border p-4">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-medium">
          <Key size={16} />
          API Keys
        </h2>
        <div className="grid grid-cols-[1fr_1fr_2fr] gap-3">
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Provider
          </div>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Model
          </div>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            API Key
          </div>
        </div>
        <div className="mt-4 text-sm text-muted-foreground">
          No API keys configured
        </div>
      </div>
    </div>
  )
}
