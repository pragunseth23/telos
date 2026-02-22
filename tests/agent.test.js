import test from "node:test";
import assert from "node:assert/strict";
import { SingleAgentExecutor } from "../src/agent.js";
import { IntentGraphEngine, NODE_TYPES } from "../src/intentGraph.js";

function buildGraph() {
  const graph = new IntentGraphEngine();
  graph.initializeFromOnboarding({
    aboutYourself: "student profile",
    roles: "student",
    currentPriorities: "Study for SAT\nComplete practice questions",
    longTermAmbitions: "Get into college",
    constraints: "3 hours/week",
  });
  return graph;
}

test("agent executes explicitly automatable research tasks and emits alignment report", () => {
  const graph = buildGraph();
  const executor = new SingleAgentExecutor();
  const goal = graph.getNodesByType(NODE_TYPES.SPEED2)[0];
  const agentTask = graph.addNode({
    type: NODE_TYPES.SPEED1,
    parentId: goal.id,
    title: "Search online for SAT study materials",
    description: "Compile top prep resources and summarize fit by level",
    executionMode: "Agent",
  });

  const result = executor.executeTask({
    taskId: agentTask.id,
    graph,
    profile: { constraints: "3 hours/week" },
  });

  assert.equal(result.status, "completed");
  assert.ok(result.log.intentAlignmentReport);
  assert.equal(typeof result.log.intentAlignmentReport.reward, "number");
});

test("agent blocks non-specific tasks even when mode is Agent", () => {
  const graph = buildGraph();
  const executor = new SingleAgentExecutor();
  const goal = graph.getNodesByType(NODE_TYPES.SPEED2)[0];

  const nonExecutableTask = graph.addNode({
    type: NODE_TYPES.SPEED1,
    parentId: goal.id,
    title: "Build pickleball prototype",
    description: "Implement and ship the core camera workflow",
    executionMode: "Agent",
  });

  const result = executor.executeTask({
    taskId: nonExecutableTask.id,
    graph,
    profile: {},
  });

  assert.equal(result.status, "blocked");
  assert.match(result.message, /not specific enough|human|real-world/i);
});

test("agent blocks human-only tasks", () => {
  const graph = buildGraph();
  const executor = new SingleAgentExecutor();
  const goal = graph.getNodesByType(NODE_TYPES.SPEED2)[0];
  const humanTask = graph.addNode({
    type: NODE_TYPES.SPEED1,
    parentId: goal.id,
    title: "Attend In-Person Pickleball Practice Session",
    description: "Show up at the local court and complete drills",
    executionMode: "Human",
  });

  const result = executor.executeTask({
    taskId: humanTask.id,
    graph,
    profile: {},
  });

  assert.equal(result.status, "blocked");
});

test("irreversible actions require approval", () => {
  const graph = buildGraph();
  const executor = new SingleAgentExecutor();
  const goal = graph.getNodesByType(NODE_TYPES.SPEED2)[0];

  const task = graph.addNode({
    type: NODE_TYPES.SPEED1,
    parentId: goal.id,
    title: "Search for scholarship options, compile a shortlist, and submit application online",
    description: "Provide links and a comparison table, then submit final application form online",
    executionMode: "Agent",
  });

  const requiresApproval = executor.executeTask({
    taskId: task.id,
    graph,
    profile: {},
  });

  assert.equal(requiresApproval.status, "needs_approval");

  const approved = executor.executeTask({
    taskId: task.id,
    graph,
    profile: {},
    approvalToken: true,
  });

  assert.equal(approved.status, "completed");
});
