# Project Specification: (Telos)

## 1. Vision

We believe AI can be reimagined by centering it around people and their relationships. At its best, AI should function as connective tissue—strengthening individuals, organizations, and communities.

This product introduces a new paradigm in human-AI interaction by tightly integrating:

- Long-horizon reinforcement learning
- Multi-agent coordination systems
- Persistent user memory
- Structured user understanding
- Objective-aligned optimization through a personal Intent Graph

The system unifies research and product design to create a deeply personalized, goal-aware AI assistant.

---

## 2. Core Concept: The Intent Graph

The Intent Graph is the foundational control system of the application.

It represents:

- Identity
- Goals (short-term and long-term)
- Constraints
- Values
- Relationships
- Tradeoffs and tensions between competing objectives

The graph serves as:

- The persistent memory backbone
- The reward surface for agents
- The optimization target for automated actions
- The interpretability layer for human-AI collaboration

Every agent action must explicitly justify how it advances nodes within the Intent Graph.

---

## 3. Speed Architecture

The system operates across two timescales:

### Speed-2 (Long-Horizon Goals)

- Abstract ambitions
- Ambiguous or evolving objectives
- Identity-level motivations
- Parent nodes in the graph

Examples:
- Get into college
- Build a startup
- Become a better parent
- Improve physical health

These are explored primarily through conversational interaction. The AI asks clarifying questions to refine understanding of intent, constraints, and tradeoffs.

---

### Speed-1 (Actionable Tasks)

- Concrete, short-term tasks
- Executable within bounded scope
- Child nodes of Speed-2 goals

Examples:
- Study for SAT
- Find scholarship opportunities
- Research startup competitors
- Schedule workouts

Speed-1 tasks are partially or fully executable via agents.

---

## 4. Agent System

### Agent Principles

1. Agents operate only on Speed-1 tasks.
2. Each action must include a justification referencing affected graph nodes.
3. Agents optimize against the Intent Graph objective function.
4. Agents must respect constraints and encoded tensions.

### Execution Modes

Each Speed-1 task is labeled:

- **Agent-executable**
- **Human-executable**
- **Hybrid**

Example:

Speed-2: Get into college  
Speed-1: Do well on SAT  

Task Panel:
1. Find study materials → Agent
2. Complete practice problems → Human

Agents may:
- Search the web
- Summarize information
- Organize resources
- Draft plans
- Schedule tasks
- Create documents

They may not:
- Fabricate identity-level decisions
- Override constraints in graph
- Take irreversible actions without approval

---

## 5. Onboarding Flow

### Step 1: Minimal Chat Interface

Initial screen:

> "Hey, I'm Telos. I want to learn more about you. Tell me about yourself."

### Step 2: Structured Identity Extraction (10 Core Questions)

The system collects structured inputs regarding:

- Role(s): student, parent, founder, developer, etc.
- Current priorities
- Long-term ambitions
- Values
- Constraints (time, money, geography)
- Important relationships
- Areas of tension
- Risk tolerance
- Work style preferences
- Creative aspirations

### Step 3: Graph Construction

The system builds:

Root Node → Core Identity  
Speed-2 Nodes → Major life ambitions  
Speed-1 Nodes → Actionable children  

Graph must support:
- Directed edges
- Weighted importance
- Conflict encoding
- Temporal decay
- Version history

---

## 6. Graph as Objective Function

The Intent Graph functions as a control surface.

Each node contains:

- Priority weight
- Temporal horizon
- Confidence score
- Emotional valence
- Dependencies
- Conflicts

Agent reward is computed as:

Reward = Δ(Progress toward weighted nodes) − Penalty(conflict violations + constraint breaches)

Agents must produce an "Intent Alignment Report" for each action:

- Which nodes were advanced?
- By how much?
- Which tensions were activated?
- Was any constraint approached?

---

## 7. Conversational Intelligence

All chat interactions operate under persistent context.

The model must:

- Reference graph nodes implicitly
- Update graph weights dynamically
- Identify latent motivations
- Detect inconsistencies
- Suggest restructuring of goals

Inspired by recursive language model paradigms, the system should:

- Maintain layered memory
- Periodically summarize graph evolution
- Self-critique interpretations of user intent

---

## 8. Interface Design

### Main View Layout

Center: Intent Graph visualization  
Right Panel: Conversational Interface  
Left Panel: Task Execution / Agent Activity  

Clicking a Speed-2 node:
- Expands children Speed-1 nodes
- Enables refinement via chat

Clicking a Speed-1 node:
- Opens task panel
- Displays agent/human labels
- Shows execution logs
- Shows alignment reports

---

## 9. Technical Architecture

### Core Components

1. Intent Graph Engine
   - Graph database (e.g., Neo4j or custom)
   - Node weight updating logic
   - Conflict modeling system

2. Agent Orchestrator
   - Multi-agent coordination
   - Tool usage routing
   - Justification enforcement
   - Execution auditing

3. Memory System
   - Structured graph memory
   - Unstructured conversation logs
   - Periodic summarization
   - Version snapshots

4. Reinforcement Learning Layer
   - Long-horizon objective shaping
   - Multi-agent reward balancing
   - Human feedback integration

5. UI Layer
   - Graph visualization
   - Chat interface
   - Task dashboard
   - Alignment reporting

---

## 10. Safety & Governance

- All irreversible actions require explicit confirmation.
- Agents cannot modify identity-level nodes without dialogue.
- Constraints are hard boundaries unless manually changed.
- Full action logs must be transparent and reviewable.

---

## 11. MVP Scope

### Phase 1
- Onboarding flow
- Static Intent Graph
- Manual Speed-1 task labeling
- Single-agent execution
- Basic alignment justification

### Phase 2
- Dynamic weight updating
- Multi-agent coordination
- Web browsing agent
- Conflict encoding

### Phase 3
- Reinforcement learning layer
- Long-horizon planning engine
- Automatic graph restructuring suggestions

---

## 12. Success Criteria

- Users feel deeply understood
- Actions are transparently aligned with goals
- Reduced cognitive load in executing ambitions
- Increased progress toward long-term objectives
- Measurable improvement in decision clarity

---

## 13. Guiding Philosophy

Your device should understand you.

It should support your creative process.

It should act only in ways that measurably advance the person you are becoming.

The Intent Graph is not just memory.

It is the formalization of who you are and where you are going.