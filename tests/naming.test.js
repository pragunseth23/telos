import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureAttachedTaskTitle,
  ensureSpeed1ActionTitle,
  ensureSpeed2GoalTitle,
  isActionableLabel,
  normalizeTitleForDisplay,
} from "../src/naming.js";

test("normalizeTitleForDisplay applies consistent capitalization", () => {
  const normalized = normalizeTitleForDisplay("  build a gtm plan for uc berkeley ai project. ");
  assert.equal(normalized, "Build a GTM Plan for UC Berkeley AI Project");
});

test("ensureSpeed2GoalTitle avoids copying identity title", () => {
  const identity = "UC Berkeley Freshman / Aspiring Product Builder";
  const goal = ensureSpeed2GoalTitle(identity, identity, 1);
  assert.notEqual(goal.toLowerCase(), identity.toLowerCase());
});

test("ensureSpeed1ActionTitle rewrites non-actionable or copied titles", () => {
  const parentGoal = "Become a Founder and Raise Capital";
  const rewritten = ensureSpeed1ActionTitle("become a founder and raise capital", parentGoal, 1);
  assert.notEqual(rewritten.toLowerCase(), parentGoal.toLowerCase());
  assert.equal(isActionableLabel(rewritten, { minWords: 3 }), true);
});

test("ensureAttachedTaskTitle returns specific actionable task wording", () => {
  const actionTitle = "Validate Demand for AI Refereeing App";
  const task = ensureAttachedTaskTitle("validate demand for ai refereeing app", actionTitle, 1);
  assert.equal(isActionableLabel(task, { minWords: 5, requireOutput: true }), true);
});
