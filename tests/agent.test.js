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

test("agent executes agent/hybrid tasks and emits alignment report", () => {
  const graph = buildGraph();
  const executor = new SingleAgentExecutor();
  const agentTask =
    graph
      .getNodesByType(NODE_TYPES.SPEED1)
      .find((node) => node.executionMode !== "Human") || graph.getNodesByType(NODE_TYPES.SPEED1)[0];

  const result = executor.executeTask({
    taskId: agentTask.id,
    graph,
    profile: { constraints: "3 hours/week" },
  });

  assert.equal(result.status, "completed");
  assert.ok(result.log.intentAlignmentReport);
  assert.equal(typeof result.log.intentAlignmentReport.reward, "number");
});

test("agent blocks human-only tasks", () => {
  const graph = buildGraph();
  const executor = new SingleAgentExecutor();
  const humanTask = graph
    .getNodesByType(NODE_TYPES.SPEED1)
    .find((node) => node.executionMode === "Human");

  assert.ok(humanTask);

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
    title: "Submit college application",
    description: "Submit final form",
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
