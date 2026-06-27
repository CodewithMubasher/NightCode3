# NightCode3 Self-Audit Report

Engine state: **mid-refactor** — Effect-TS layer has been removed and replaced with
`engine-runner.ts` + `engine-utils.ts` + per-provider files under `providers/`.
`gateway.ts` shows `UU` in git index but contains no conflict markers (clean code).
TypeScript compiles clean (`tsc --noEmit` passes).

---

## CRITICAL BUGS (block the core agent loop)

### BUG-1: Gemini tool-result format is WRONG → multi-step tool loops break on Gemini
**File:** `lib/engine/providers/google.ts:116-120`
Gemini is the **primary model** for this project. But tool results are formatted as
plain user text:
```ts
geminiMessages.push({ role: "user", parts: [{ text: `[Tool Result] ${text}` }] })
```
Gemini's API requires `functionResponse` parts paired with `functionCall` parts in
the prior model turn, e.g.:
```json
{ "role": "user", "parts": [{ "functionResponse": { "name": "read_file", "response": { ... } } }] }
```
Also, when the assistant turn contained `functionCall` parts, those must be echoed
back as the `model` role — currently the code rebuilds assistant turns only from
text/tool-call parts and DROPS the functionCall parts entirely. **Result:** on the
2nd step, Gemini has no idea what tool was called or what it returned → it either
hallucinates or repeats the same call forever. This breaks Features 16-22, 111-120
for the default model.

### BUG-2: Gemini assistant turns lose their `functionCall` parts
**File:** `lib/engine/providers/google.ts:122-134`
When `currentMessages` carries an assistant message whose content is the array
`[{type:"tool-call", toolName, input, toolCallId}]` (built by engine-runner.ts:604),
the Gemini formatter maps unknown parts to `{text: JSON.stringify(p)}`. Gemini never
sees a `functionCall` in the model turn → cannot pair the `functionResponse`. Same
root cause as BUG-1.

### BUG-3: grep uses a stateful `g`-flag regex with `.test()` in a loop
**File:** `lib/engine/tools/grep.ts:65,74`
`new RegExp(args.pattern, "gi")` created once, then `regex.test(lines[i])` called
per line. With the `g` flag, `.test()` advances `lastIndex` and alternates
true/false, skipping matches. **Result:** grep returns ~50% of real matches and
silently drops others. Critical for Features 43, 112-119.

### BUG-4: read_file has NO path-traversal protection
**File:** `lib/engine/tools/read-file.ts:6-13`
`resolvePath` normalizes but never checks `startsWith(WORKSPACE)`. The LLM can read
`../../etc/passwd` or any absolute path. write_file/edit_file/delete_file all guard;
read_file does not. Security hole (Feature 31/32).

### BUG-5: execute_command loses non-zero exit codes silently
**File:** `lib/engine/tools/execute-command.ts:46-59`
`execAsync` (Node `exec`) **throws** on non-zero exit codes, so the `catch` in
`executeTool` returns `{success:false, error:"Command failed with exit code N"}`
**without stdout/stderr**. The LLM never sees the test/compiler output it needs to
debug. This breaks Features 44-46, 116, 120. Also the timeout is 30s (npm install
regularly exceeds this) and there is no stdin/`maxBuffer` (large npm logs throw
"stdout maxBuffer exceeded").

### BUG-6: edit_file strategy `indentationFlexible` is broken
**File:** `lib/engine/tools/edit-file.ts:59`
```ts
if (content.substring(i * (contentLines[0]?.length ?? 0)).startsWith(indentedOld))
```
This multiplies the line index by the **length of the first line** as a byte offset
— complete nonsense. It will essentially never match. Strategy 4 of 9 is dead.

### BUG-7: edit_file `simple`/`multiOccurrence` use `String.replace` which replaces ALL
**File:** `lib/engine/tools/edit-file.ts:19, 113`
`content.replace(oldStr, newStr)` — when `oldStr` is a STRING (not regex),
`String.replace` replaces only the **first** occurrence, which is correct. BUT
`multiOccurrence` is supposed to handle multiple occurrences and its comment says
"if count===1 replace" — it actually returns null when count>1, meaning a legit
single-occurrence edit falls through to `simple` first anyway. The real danger:
`whitespaceNormalized` (line 41) does `before + newStr` and **discards everything
after the match** — silent data loss.

### BUG-8: clearOldToolOutputs compares string LENGTH to TOKEN threshold
**File:** `lib/engine/engine-utils.ts:50,55`
`CLEAR_THRESHOLD_TOKENS = 12000` compared against `val.length` (characters).
Since `estimateTokens` uses `chars/7`, a 12000-char string is ~1700 tokens. The
intended behavior was to clear ~12000-token outputs. Mostly harmless (clears too
rarely) but the variable name and usage are contradictory and misleading.

### BUG-9: Streaming text causes O(N) re-render per token (Tier 2 disaster)
**File:** `store/nightcode-store.ts:648`
Every `text_delta` event calls `get().updateMessageContent()` → full Zustand `set()`
→ re-renders the ENTIRE message list. For a 500-token response that's 500 full tree
re-renders. No `nc:token` CustomEvent / useRef direct-DOM path exists despite
comments referencing it. Feature 4/101.

### BUG-10: PLAN→BUILD switch reads `t.name` but `tools` are `{name}` already
**File:** `lib/engine/engine-runner.ts:516`
```ts
const buildTools = currentConfig.tools.map((t) => TOOL_REGISTRY[t.name])
```
`currentConfig.tools` is `[{name:"read_file"}, ...]` so `t.name` works. However
`.filter(Boolean)` is missing here (present at index.ts:121), so an unknown tool
name yields `undefined` in the array and gets passed downstream. Minor but real.

### BUG-11: `consecutiveErrors` never forces termination
**File:** `lib/engine/engine-runner.ts:311-319,533-538`
The mission says "stop after 3 consecutive errors." The code increments
`consecutiveErrors` and injects a forced-think, but **never breaks the loop**. An
agent stuck retrying a failing tool will run all 20 (or 30) iterations.

### BUG-12: Compaction summary JSON.parse can throw & is silently swallowed wrong
**File:** `lib/engine/context-builder.ts:287-299`
If `summarizeSteps` returns non-JSON (LLM added prose), `JSON.parse` throws inside
the `.map`, the catch returns `null`, filter removes it → compaction block is empty
→ context silently loses ALL prior history with no summary. The agent forgets
everything mid-task.

### BUG-13: `buildRequest` double-strips and can mismatch store payload
**File:** `lib/engine/context-builder.ts:347-361`
The store sends messages where `content` may be a string OR a pre-built parts
array. `buildRequest` trusts `Array.isArray(raw.content)`. But `engine-runner` also
receives `strippedMessages` (index.ts:147) which already ran `.replace` on strings.
Then `buildRequest` is called on the ORIGINAL `messages` (index.ts:144) and its
`system` output is used, while `strippedMessages` is what actually goes to the
gateway. Two divergent message arrays. Works by accident for text-only, fragile for
multimodal.

## HIGH-SEVERITY ISSUES

### PERF-1: `formatOpenAIMessages` is called once per step but rebuilds arrays
Acceptable. Not a hot path.

### PERF-2: `estimateMessageTokens` walks every message every step (×3 calls/step)
engine-runner calls it at lines 103, 566, 648. Each is O(messages). For a 15-step
run that's ~45 full scans. Cacheable.

### UX-1: No streaming status line ("Step 3/20 — Reading package.json")
`statusMessage` exists in store but is never set by the SSE handler. Feature 86/Q.

### UX-2: `getChatTitle` truncates mid-word, no LLM title generation
Feature 12 — titles are just first 40 chars of user message. Acceptable but weak.

### BUG-14: `generate_image` success short-circuits the WHOLE turn
**File:** `lib/engine/engine-runner.ts:558-561`
After any successful image gen, the loop breaks immediately — even if the LLM called
`write_file` AND `generate_image` in parallel, the file write result is discarded
from the next context (toolResultMessages built but loop exits before appending).
Actually re-reading: `currentMessages` append happens at line 627 AFTER the image
break check at 558. So parallel writes with an image are LOST.

### BUG-15: `ask` event sets message status to "complete" but engine keeps running
**File:** `store/nightcode-store.ts:820-821`, `engine-runner.ts:602`
Store marks complete on ask; engine breaks on `asked` at end of round. Mostly OK,
but if the LLM emitted text AND ask in same turn, the text is overwritten by "Let
me ask..." (line 819). Minor.

### BUG-16: `confirmDeletion` uses `findLast` (ES2023) — check target
Node 20+ supports it. OK.

### BUG-17: tool_end matching by "running tool name" is racy
**File:** `store/nightcode-store.ts:713-725`
If two `read_file` calls run in parallel, tool_end for the first may match the
second's shimmer. Tool call IDs should be authoritative. The engine emits
`toolCallId: tc.generatedId` on both tool_start and tool_end (runner:264,379,429)
so the IDs DO match — the fallback is only a safety net. Low risk.

## MEDIUM ISSUES

- **BUG-18:** `searchFilesTool` not read — need to verify glob correctness (Feature 42).
- **BUG-19:** No `get_errors` / `run_tests` tools (Tier 3 L, M) — debugging tasks impossible.
- **BUG-20:** System prompts lack explicit "read before edit, verify after write" rules (Tier 4 N, O).
- **BUG-21:** `execute_command` dangerous-pattern list misses `rm -rf ~`, `:(){:|:&};:`, `del /s`, `rmdir /s`.
- **BUG-22:** `list_directory` cache never invalidated on write_file/create_folder (Feature 40, Tier 3 K).
- **BUG-23:** `expert_agent`/`delegate_task`/`execute_workspace_script` not yet audited for CaaT (Features 53-55, 18).
- **BUG-24:** `planner.ts` fallback retry strips tool messages but keeps assistant tool-call arrays — malformed for OpenAI.

## CONFIDENCE SUMMARY (key features)
- Feature 1 (streaming): 70 — works but laggy (BUG-9)
- Feature 16-22 (engine loop): **15 on Gemini** (BUG-1/2), 75 on OpenAI providers
- Feature 31-32 (read_file): 60 (BUG-4 security)
- Feature 35-37 (edit_file): 55 (BUG-6/7)
- Feature 43 (grep): 30 (BUG-3)
- Feature 44-46 (execute_command): 35 (BUG-5)
- Feature 111-120 (coding tasks): **20 on Gemini**, 55 on OpenAI

**Overall: the engine is fundamentally broken for the DEFAULT model (Gemini).**
Fixing BUG-1/2 is the single highest-leverage change.
