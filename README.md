# Telos

Telos is a desktop AI assistant that builds and maintains a personalized intent graph from conversation.

The product is designed around one goal: give users more time for creative, human work by letting the agent execute routine, well-scoped tasks.

## Product Flow

1. **Conversational onboarding**
   - User chats with Telos.
   - Telos asks probing questions and builds context from natural responses.
2. **Graph construction**
   - Telos generates identity lenses and graph structure from onboarding context.
3. **Execution workspace**
   - User navigates Goals, Actions, and attached Tasks.
   - Agent-assigned tasks can be run directly.
   - Human-assigned tasks are tracked but not agent-runnable.

## Core Model

- **Identity Lens**: a perspective like Student, Squash Player, Traveler.
- **Goal**: long-horizon objective under a lens.
- **Action**: concrete near-term action attached to a goal.
- **Task**: attached checklist item under an action, assigned to either:
  - `agent` (runnable)
  - `human` (non-runnable)

## Key UX + Behavior

- Multi-lens home with graph previews.
- Workspace with:
  - task panel
  - force graph view
  - conversation panel
- Reset with confirmation.
- No timestamp clutter in chat/task surfaces.
- Agent execution available at task level only.
- Task assignment visible on hover.
- Goal completion is gated: a goal can be marked done only after all of its actions are completed.

## Agent Execution + Deliverables

When an agent task runs:

- Telos generates a readable task result document.
- Telos writes concrete deliverable files to Desktop.
- Deliverables are saved under:
  - `~/Desktop/Telos Deliverables/<task-slug>__<YYYY-MM-DD_HH-MM>/`
  - Collision-safe suffixes are added only when needed (for example `-02`).

Generated files include:

- One markdown file per deliverable
- `task-result.md` summary in the same folder

The app also stores agent result documents in app data for in-app viewing.

## Tech Stack

- **Desktop shell**: Tauri v2
- **Frontend**: vanilla JS + HTML/CSS
- **Backend**: Rust + Tauri commands
- **Model API**: OpenAI Responses API
- **Default model**: `gpt-5.2`

Reasoning policy:

- Onboarding/workspace chat: reasoning effort `none`
- Agent execution: reasoning effort `low` (or `medium` when approval flow is used)

## Setup

### 1. Prerequisites

- Node.js 18+
- Rust toolchain
- Tauri CLI:

```bash
cargo install tauri-cli
```

- Platform prerequisites from [Tauri v2 docs](https://v2.tauri.app/start/prerequisites/)

### 2. Environment

```bash
cp .env.example .env
```

Set:

- `OPENAI_API_KEY` (required)
- `OPENAI_MODEL` (optional, defaults to `gpt-5.2`)

### 3. Run

```bash
npm run tauri:dev
```

## Project Scripts

- `npm run tauri:dev` — run desktop app in dev mode
- `npm run tauri:build` — build desktop app
- `npm test` — run Node test suite

## Persistence

- Frontend app state: local storage
- Backend context:
  - macOS: `~/Library/Application Support/com.telos.desktop/context/context.json`
  - Windows: `%APPDATA%/com.telos.desktop/context/context.json`
  - Linux: `~/.local/share/com.telos.desktop/context/context.json`
- Agent result docs:
  - `<app_data_dir>/context/agent_runs/*.md`
- Desktop deliverables:
  - `~/Desktop/Telos Deliverables/...`

## Security Notes

- Do not commit `.env`.
- Keep API keys in environment variables only.
- `.gitignore` is configured to exclude local secrets and build artifacts.

## Tests

```bash
npm test
```
