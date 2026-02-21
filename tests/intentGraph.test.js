import test from "node:test";
import assert from "node:assert/strict";
import { IntentGraphEngine, NODE_TYPES } from "../src/intentGraph.js";

test("initializeFromOnboarding builds root, speed2 and speed1 nodes", () => {
  const graph = new IntentGraphEngine();
  graph.initializeFromOnboarding({
    aboutYourself: "I am a student building a startup.",
    roles: "student, founder",
    currentPriorities: "Study for SAT\nResearch competitors",
    longTermAmbitions: "Get into college\nBuild a startup",
    values: "growth, family",
    constraints: "10 hours/week",
    relationships: "family, mentor",
    tensions: "Get into college vs Build a startup",
    riskTolerance: "medium",
    workStyle: "deep work mornings",
    creativeAspirations: "write essays",
  });

  const root = graph.getRoot();
  assert.ok(root);
  assert.equal(root.type, NODE_TYPES.ROOT);

  const speed2 = graph.getNodesByType(NODE_TYPES.SPEED2);
  assert.equal(speed2.length, 2);

  const speed1 = graph.getNodesByType(NODE_TYPES.SPEED1);
  assert.ok(speed1.length >= 2);

  assert.ok(graph.getRecentVersions(10).length > 0);
});

test("computeReward uses progress minus penalties", () => {
  const graph = new IntentGraphEngine();
  graph.initializeFromOnboarding({
    aboutYourself: "test",
    roles: "developer",
    currentPriorities: "Ship MVP",
    longTermAmbitions: "Build product",
  });

  const speed1 = graph.getNodesByType(NODE_TYPES.SPEED1)[0];

  const reward = graph.computeReward({
    advancedNodes: [{ nodeId: speed1.id, delta: 0.3 }],
    tensionsActivated: [{ nodeId: "x", weight: 0.2 }],
    constraintsApproached: ["10 hours/week"],
    constraintBreaches: [],
  });

  assert.equal(typeof reward.reward, "number");
  assert.ok(reward.progressScore > 0);
  assert.ok(reward.penalty > 0);
});

test("addConflict stores conflict metadata on node", () => {
  const graph = new IntentGraphEngine();
  graph.initializeFromOnboarding({
    aboutYourself: "test",
    roles: "developer",
    currentPriorities: "Ship MVP\nSleep enough",
    longTermAmbitions: "Build product\nStay healthy",
  });

  const [firstGoal, secondGoal] = graph.getNodesByType(NODE_TYPES.SPEED2);
  graph.addConflict(firstGoal.id, secondGoal.id, "work vs rest", 0.4);

  const refreshed = graph.getNode(firstGoal.id);
  assert.equal(refreshed.conflicts.length, 1);
  assert.equal(refreshed.conflicts[0].nodeId, secondGoal.id);
});
