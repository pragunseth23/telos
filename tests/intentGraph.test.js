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

test("initializeFromOnboarding strips core identity prefix from root title", () => {
  const graph = new IntentGraphEngine();
  graph.initializeFromOnboarding({
    aboutYourself: "Freshman builder profile",
    roles: "Core Identity: UC Berkeley freshman / aspiring product builder",
    currentPriorities: "Ship v1",
    longTermAmbitions: "Become a founder",
  });

  const root = graph.getRoot();
  assert.ok(root);
  assert.equal(root.title.includes("Core Identity"), false);
  assert.equal(root.title.includes("core identity"), false);
});

test("initializeFromOnboarding keeps speed2 and speed1 distinct across hierarchy", () => {
  const graph = new IntentGraphEngine();
  graph.initializeFromOnboarding({
    aboutYourself: "UC Berkeley freshman and aspiring product builder",
    roles: "UC Berkeley freshman / aspiring product builder",
    currentPriorities: "become a founder and raise capital",
    longTermAmbitions: "uc berkeley freshman / aspiring product builder",
  });

  const root = graph.getRoot();
  assert.ok(root);
  const speed2 = graph.getNodesByType(NODE_TYPES.SPEED2);
  assert.ok(speed2.length > 0);
  assert.notEqual(speed2[0].title.toLowerCase(), root.title.toLowerCase());

  const speed1 = graph
    .getNodesByType(NODE_TYPES.SPEED1)
    .filter((node) => node.parentId === speed2[0].id);
  assert.ok(speed1.length > 0);
  assert.notEqual(speed1[0].title.toLowerCase(), speed2[0].title.toLowerCase());
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
