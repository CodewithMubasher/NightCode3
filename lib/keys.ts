import { getDb, initSchema } from "@/lib/db/schema"

initSchema()

export type KeyEntry = {
  env_name: string
  display_name: string
  key_value: string
  account_label: string
  has_key: boolean
}

const PROVIDER_KEYS: { env_name: string; display_name: string }[] = [
  { env_name: "OPENAI_API_KEY", display_name: "OpenAI" },
  { env_name: "OPENROUTER_API_KEY", display_name: "OpenRouter" },
  { env_name: "GOOGLE_GENERATIVE_AI_API_KEY", display_name: "Google" },
  { env_name: "GROQ_API_KEY", display_name: "Groq" },
  { env_name: "OPENCODE_API_KEY", display_name: "OpenCode" },
  { env_name: "XAI_API_KEY", display_name: "xAI" },
  { env_name: "NAGA_API_KEY", display_name: "Naga" },
  { env_name: "CLOUDFLARE_API_TOKEN", display_name: "Cloudflare" },
  { env_name: "DEEPSEEK_API_KEY", display_name: "DeepSeek" },
  { env_name: "XIAOMI_API_KEY", display_name: "Xiaomi" },
  { env_name: "CEREBRAS_API_KEY", display_name: "Cerebras" },
  
  { env_name: "SAMBANOVA_API_KEY", display_name: "SambaNova" },
  { env_name: "OLLAMA_CLOUD_API_KEY", display_name: "Ollama Cloud" },
  { env_name: "FREETHEAI_API_KEY", display_name: "FreeTheAI" },
]

function getOldApiKey(envName: string): string | undefined {
  try {
    const db = getDb()
    const row = db.prepare("SELECT key_value FROM api_keys WHERE env_name = ?").get(envName) as { key_value: string } | undefined
    return row?.key_value
  } catch {
    return undefined
  }
}

export function getAllAccounts(): string[] {
  const db = getDb()
  const rows = db.prepare("SELECT label FROM accounts ORDER BY label").all() as { label: string }[]
  return rows.map((r) => r.label)
}

export function addAccount(label: string): void {
  const db = getDb()
  db.prepare("INSERT OR IGNORE INTO accounts (label) VALUES (?)").run(label)
}

export function getAssignedAccount(envName: string): string {
  const db = getDb()
  const row = db.prepare("SELECT account_label FROM provider_accounts WHERE env_name = ?").get(envName) as { account_label: string } | undefined
  return row?.account_label ?? "default"
}

export function setProviderAccount(envName: string, accountLabel: string): void {
  const db = getDb()
  db.prepare(
    "INSERT INTO provider_accounts (env_name, account_label) VALUES (?, ?) ON CONFLICT(env_name) DO UPDATE SET account_label = excluded.account_label"
  ).run(envName, accountLabel)
}

export function getAllKeyEntries(): KeyEntry[] {
  const db = getDb()
  const accountRows = db.prepare("SELECT env_name, account_label FROM provider_accounts").all() as { env_name: string; account_label: string }[]
  const accountMap = new Map(accountRows.map((r) => [r.env_name, r.account_label]))

  const allKeys = db.prepare("SELECT env_name, key_value, account_label FROM account_keys").all() as { env_name: string; key_value: string; account_label: string }[]
  const keyMap = new Map<string, { key_value: string; account_label: string }>()
  for (const k of allKeys) {
    keyMap.set(`${k.env_name}::${k.account_label}`, k)
  }

  return PROVIDER_KEYS
    .map((p) => {
      const assignedAccount = accountMap.get(p.env_name) ?? "default"
      const matched = keyMap.get(`${p.env_name}::${assignedAccount}`)
      const oldKey = getOldApiKey(p.env_name)
      const envVal = process.env[p.env_name] ?? ""
      const key_value = matched?.key_value ?? oldKey ?? envVal
      return {
        ...p,
        key_value,
        account_label: assignedAccount,
        has_key: key_value.length > 0,
      }
    })
    .filter((p) => p.has_key)
}

export function getApiKey(envName: string): string {
  const db = getDb()
  const row = db.prepare("SELECT account_label FROM provider_accounts WHERE env_name = ?").get(envName) as { account_label: string } | undefined
  const account = row?.account_label ?? "default"
  const keyRow = db.prepare("SELECT key_value FROM account_keys WHERE env_name = ? AND account_label = ?").get(envName, account) as { key_value: string } | undefined
  if (keyRow) return keyRow.key_value
  const oldKey = getOldApiKey(envName)
  if (oldKey) return oldKey
  return process.env[envName] ?? ""
}

export function setApiKey(envName: string, keyValue: string, accountLabel: string = "default"): void {
  const db = getDb()
  db.prepare("INSERT OR IGNORE INTO accounts (label) VALUES (?)").run(accountLabel)
  db.prepare(
    "INSERT INTO account_keys (env_name, key_value, account_label, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(env_name, account_label) DO UPDATE SET key_value = excluded.key_value, updated_at = excluded.updated_at"
  ).run(envName, keyValue, accountLabel, Date.now())
}

export function deleteApiKey(envName: string, accountLabel: string): void {
  const db = getDb()
  db.prepare("DELETE FROM account_keys WHERE env_name = ? AND account_label = ?").run(envName, accountLabel)
}

export function deleteAccount(label: string): void {
  const db = getDb()
  db.prepare("DELETE FROM account_keys WHERE account_label = ?").run(label)
  db.prepare("DELETE FROM provider_accounts WHERE account_label = ?").run(label)
  db.prepare("DELETE FROM accounts WHERE label = ?").run(label)
}

export function hasAnyKey(baseEnvName: string): boolean {
  const base = getApiKey(baseEnvName)
  if (base) return true
  for (let i = 1; i <= 10; i++) {
    const val = process.env[`${baseEnvName}_${i}`]
    if (val && val.trim()) return true
  }
  return false
}

export function maskKey(key: string): string {
  if (!key) return ""
  if (key.length <= 8) return key.slice(0, 2) + "..." + key.slice(-2)
  return key.slice(0, 4) + "..." + key.slice(-4)
}

// ── Multi-key rotation ────────────────────────────────────────────────────────
// Providers like Groq, Google, etc. can have multiple keys via suffixed env vars:
//   GROQ_API_KEY       → fallback/base
//   GROQ_API_KEY_1     → key 1 (rotated)
//   GROQ_API_KEY_2     → key 2 (rotated)
//   GROQ_API_KEY_3     → key 3 (rotated)
//   ...
// getNextKey() round-robins across all available keys.

const rotationCounters = new Map<string, number>()

export function getNextKey(baseEnvName: string): string {
  const keys: string[] = []

  // Base key from DB or env
  const base = getApiKey(baseEnvName)
  if (base) keys.push(base)

  // Suffixed keys from env only (these aren't in the DB system)
  for (let i = 1; i <= 10; i++) {
    const val = process.env[`${baseEnvName}_${i}`]
    if (val && val.trim()) {
      keys.push(val.trim())
    }
  }

  if (keys.length === 0) return ""

  const counter = rotationCounters.get(baseEnvName) ?? 0
  rotationCounters.set(baseEnvName, counter + 1)
  return keys[counter % keys.length]
}
