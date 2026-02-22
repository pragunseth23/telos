# Telos (Hackathon Build)

Telos is a goal-aware desktop AI that turns your conversation into an Intent Graph, breaks long-term goals into concrete tasks, and executes the tasks you delegate.

## Product Goal

Most assistants are stateless and chat-first. We wanted an assistant that is:

- Identity-aware (who you are)
- Goal-aware (where you want to go)
- Action-aware (what to do next)
- Constraint-aware (what it must not violate)

So instead of a plain chat log, Telos maintains a structured Intent Graph and requires each agent run to produce an alignment explanation.

## What We Built

- Conversational onboarding that gathers identity, goals, values, constraints, tensions, and work style.
- Automatic graph construction:
  - `Root` node = identity
  - `Goals` = long-horizon direction
  - `Actions` = near-term execution
- Workspace with 3 synchronized panels:
  - Task execution panel
  - Intent graph panel
  - Conversation panel
- Attached task checklist under each Action.
- Single-agent execution for eligible tasks (research/synthesis type work).
- Safety gating:
  - Human-only tasks are blocked
  - Vague tasks are blocked
  - Irreversible actions require explicit approval
- Intent Alignment Report for each execution:
  - Nodes advanced
  - Tensions activated
  - Constraints approached/breached
  - Reward signal
- Persistent memory:
  - App state in browser local storage
  - Model context and agent run artifacts on disk (Tauri app data)
- Multi-lens identity support (create/switch different identity lenses from Home).

## Example Intent Graph

Example graph (nodes + directed edges):

```text
Nodes:
- R: Root identity = Student / Builder
- G1: Goal = Get into college
- G2: Goal = Build startup momentum
- A1: Action = Build SAT prep system
- A2: Action = Build scholarship application pipeline
- A3: Action = Research competitors
- A4: Action = Draft first user interview script

Directed edges:
- R -> G1
- R -> G2
- G1 -> A1
- G1 -> A2
- G2 -> A3
- G2 -> A4

Tension edge (conflict metadata):
- G1 <-> G2  (example: "college outcomes vs startup velocity")
```

Execution in Telos runs on specific Actions and attached tasks, not on identity-level nodes.

## Why We Made These Decisions

- Tauri + Rust backend:
  - Keeps `OPENAI_API_KEY` out of frontend JS.
  - Gives us local file persistence for model context and agent artifacts.
- Structured JSON contracts for model output:
  - The backend enforces parseable outputs for onboarding/workspace/agent turns.
  - Reduces brittle prompt-only behavior during a hackathon timeline.
- Goals vs Actions split:
  - Keeps long-horizon intent separate from immediately executable work.
  - Makes delegation boundaries clearer.
- Strict agent eligibility policy:
  - We only auto-run tasks that are specific, scoped, and synthesis-friendly.
  - Avoids pretending to execute real-world human actions.
- Approval gate for irreversible actions:
  - Any task with destructive/irreversible language requires explicit confirmation.
- Single-agent scope (for hackathon):
  - We prioritized reliability, traceability, and end-to-end demo completeness over multi-agent complexity.
- Local-first persistence:
  - Faster iteration and predictable behavior during demos.
  - No external database setup required.

## How To Run

1. Install prerequisites:

- Node.js 18+
- Rust toolchain
- Tauri CLI:

```bash
cargo install tauri-cli
```

- Platform prerequisites from [Tauri v2 docs](https://v2.tauri.app/start/prerequisites/)

2. Configure environment:

```bash
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env` (optional: set `OPENAI_MODEL`, default is `gpt-5.2`).

3. Start the desktop app:

```bash
npm run tauri:dev
```

This runs the web frontend on `http://localhost:4173` and opens the Tauri desktop window.

## Persistence Paths

- Model context:
  - macOS: `~/Library/Application Support/com.telos.desktop/context/context.json`
  - Windows: `%APPDATA%/com.telos.desktop/context/context.json`
  - Linux: `~/.local/share/com.telos.desktop/context/context.json`
- Agent output artifacts:
  - `<app_data_dir>/context/agent_runs/*.md`
- Deliverable files (real task outputs):
  - `~/Desktop/Telos Deliverables/<result_id>__<task_slug>/`

Use Reset in the UI to clear local app state and persisted model context.

## Tests

```bash
npm test
```

Current tests cover graph construction/reward logic, onboarding parsing, agent execution policy, and API normalization contracts.
