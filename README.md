# NightCode

**AI-powered code assistant** — multi-provider, extensible via MCP, with real-time tool feedback.

![Next.js](https://img.shields.io/badge/Next.js-16.2.6-black?logo=next.js)
![React](https://img.shields.io/badge/React-19.2.4-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4-06B6D4?logo=tailwindcss)
![License](https://img.shields.io/badge/License-MIT-green)

---

## Overview

NightCode is a full-stack, locally-run AI coding assistant. Connect your own API keys, choose from 14 supported providers, and let the agent work with your codebase through a rich tool system. It supports file operations, shell commands, code search, artifact rendering, image generation, and extensible MCP servers.

---

## Features

### Multi-Provider AI

Bring your own keys. NightCode supports **14 providers** with automatic failover, health monitoring, rate-limit tracking, and key rotation:

| Provider      | Identifier   | Endpoint                            |
| ------------- | ------------ | ----------------------------------- |
| Google Gemini | `google`     | `generativelanguage.googleapis.com` |
| OpenAI        | `openai`     | `api.openai.com`                    |
| Groq          | `groq`       | `api.groq.com`                      |
| OpenRouter    | `openrouter` | `openrouter.ai`                     |
| OpenCode      | `opencode`   | `opencode.ai`                       |
| Ollama        | `ollama`     | `ollama.com`                        |
| DeepSeek      | `deepseek`   | `api.deepseek.com`                  |
| xAI           | `xai`        | `api.x.ai`                          |
| Xiaomi        | `xiaomi`     | `api.xiaomimimo.com`                |
| Cerebras      | `cerebras`   | `api.cerebras.ai`                   |
| Naga          | `naga`       | `api.naga.ac`                       |
| SambaNova     | `sambanova`  | `api.sambanova.ai`                  |
| FreeTheAI     | `freetheai`  | `api.freetheai.xyz`                 |
| Cloudflare    | `cloudflare` | `api.cloudflare.com`                |

### 22 Built-in Tools

| Tool                                                                     | Purpose                             |
| ------------------------------------------------------------------------ | ----------------------------------- |
| `read_file` / `write_file` / `create_file`                               | Read, write, and create files       |
| `edit_file`                                                              | Targeted file edits                 |
| `delete_file` / `create_folder`                                          | File system management              |
| `list_directory` / `search_files` / `grep`                               | Codebase navigation and search      |
| `shell` / `execute_workspace_script`                                     | Command execution                   |
| `delegate_task`                                                          | Sub-agent delegation                |
| `ask`                                                                    | Interactive user questions          |
| `create_artifact` / `read_artifact` / `edit_artifact` / `list_artifacts` | Rich content rendering              |
| `generate_image`                                                         | AI image generation (Google Gemini) |
| `search_memories`                                                        | Agent memory retrieval              |
| `task`                                                                   | Task tracking                       |
| `plan_exit`                                                              | Plan completion signaling           |
| `get_errors` / `run_tests`                                               | Build and test integration          |

### MCP (Model Context Protocol)

Extend NightCode with any MCP-compatible server. Plug in database tools, API clients, browser automation, or any custom capability:

```json
{
  "name": "my-server",
  "type": "local",
  "command": "python my_server.py",
  "args": [],
  "enabled": true
}
```

MCP tools are automatically merged into the agent's available toolset with server-prefixed names.

### Skills System

Inject specialized instructions into the agent's context. Enable skills globally from the customize page or activate them per-message with `@skill-name` in the prompt input.

### Rich Artifacts

Render code, markdown, HTML, SVG, Mermaid diagrams, and math equations inline — streamed token-by-token for instant feedback.

### Smart Context Management

Automatic context window compaction, token counting, and sliding-window decisions prevent context overflow while preserving critical information.

---

## Architecture

```
Message → runEngine() → Adapter → Provider Stream (text + tool_calls)
                              ↓
                    dispatchTool() → execute → verify
                              ↓
                    Feed result back → repeat until done
                              ↓
                    ContextManager (auto-compaction)
                              ↓
                    Cache + Telemetry
```

NightCode uses a **dual-engine architecture**. The new event-driven engine (`lib/engine2/`) handles streaming, tool dispatch, context management, and caching. The legacy engine (`lib/engine/`) remains for backward compatibility.

---

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm (or npm)
- At least one AI provider API key

### Setup

```bash
# Clone the repository
git clone https://github.com/CodewithMubasher/NightCode3.git
cd NightCode3

# Install dependencies
pnpm install

# Configure your API keys
cp .env.example .env.local
# Edit .env.local with your keys
```

### Run

```bash
pnpm dev        # Development server
pnpm build      # Production build
pnpm start      # Start production server
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Other Commands

| Command          | Description               |
| ---------------- | ------------------------- |
| `pnpm lint`      | Run ESLint                |
| `pnpm format`    | Format code with Prettier |
| `pnpm typecheck` | TypeScript type checking  |

---

## Configuration

### Environment Variables

All provider keys go in `.env.local`:

```env
# At least one required
OPENAI_API_KEY=sk-...
GOOGLE_GENERATIVE_AI_API_KEY=AIza...
GROQ_API_KEY=gsk_...

# Optional: image generation
GOOGLE_IMAGE_KEY_1=AIza...
GENERATE_IMAGE_MODEL=gemini-2.5-flash-image

# Optional: restrict file operations
BUILD_WORKSPACE=C:\Users\me\project
```

Keys are stored in SQLite at runtime — env vars serve as fallback defaults.

### MCP Servers

Copy the example and configure your servers:

```bash
cp mcp-servers.example.json mcp-servers.json
```

Each server needs a name, type (`local` or `remote`), command, and optional environment variables.

### Settings

Configure theme (dark/light/system), primary color, default model/provider, temperature, max tokens, and more from the Settings dialog in the app.

---

## Project Structure

```
app/                  # Next.js App Router pages and API routes
├── (dashboard)/      # Main UI: chat, projects, customize
└── api/              # API endpoints (chat, keys, MCP, skills, etc.)

components/           # React UI components
├── ui/               # shadcn/ui primitives
├── chat/             # Chat interface
└── ai-elements/      # AI-rendered content (canvas, artifacts, etc.)

lib/                  # Core logic
├── engine/           # Legacy engine
├── engine2/          # New event-driven engine
├── mcp/              # MCP integration
├── db/               # SQLite database
└── keys/             # API key routing

store/                # Zustand state management
types/                # TypeScript type definitions
.skills/              # Skill definition files
```

---

## Tech Stack

| Layer        | Technology                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| Framework    | [Next.js](https://nextjs.org/) 16 (App Router)                                                                  |
| UI           | [React](https://react.dev/) 19, [TailwindCSS](https://tailwindcss.com/) v4, [shadcn/ui](https://ui.shadcn.com/) |
| State        | [Zustand](https://zustand-demo.pmnd.rs/) 5 with persist                                                         |
| AI SDK       | [Vercel AI SDK](https://sdk.vercel.ai/) 6, [LangChain](https://js.langchain.com/)                               |
| LLM Proviers | OpenAI, Google, Groq, OpenRouter, Ollama, +8 more                                                               |
| MCP          | [Model Context Protocol](https://modelcontextprotocol.io/) SDK                                                  |
| Database     | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)                                                    |
| Content      | [Streamdown](https://streamdown.dev/), KaTeX, Mermaid, xFlow                                                    |
| Icons        | [Lucide](https://lucide.dev/)                                                                                   |
| Animations   | [Motion](https://motion.dev/) (Framer Motion)                                                                   |

---

## License

MIT — see [LICENSE](LICENSE).

Copyright © 2026 Mubasher Chaudhary.
