import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAgentRunRequest,
  normalizeAgentRunResponse,
  normalizeModelTurnRequest,
  normalizeModelTurnResponse,
} from "../src/api.js";

test("normalizeModelTurnRequest sanitizes onboarding payload", () => {
  const payload = normalizeModelTurnRequest({
    phase: "ONBOARDING",
    init: "yes",
    message: ["  hey "],
    onboarding: {
      name: ["pragun"],
      profile: {
        roles: ["student", "builder"],
      },
    },
  });

  assert.equal(payload.phase, "onboarding");
  assert.equal(payload.init, true);
  assert.equal(payload.message, "hey");
  assert.equal(payload.onboarding.name, "pragun");
  assert.match(payload.onboarding.profile.roles, /student/i);
});

test("normalizeModelTurnResponse tolerates non-string response fields", () => {
  const response = normalizeModelTurnResponse(
    {
      phase: "onboarding",
      reply: ["hello", "there"],
      onboardingComplete: "true",
      onboarding: {
        name: ["pragun"],
        profile: {
          aboutYourself: ["student", "athlete"],
        },
      },
    },
    "onboarding"
  );

  assert.equal(response.phase, "onboarding");
  assert.equal(response.onboardingComplete, true);
  assert.equal(typeof response.reply, "string");
  assert.match(response.onboarding.profile.aboutYourself, /student/i);
});

test("normalizeModelTurnResponse normalizes workspace graph updates", () => {
  const response = normalizeModelTurnResponse(
    {
      phase: "workspace",
      reply: "Done",
      graph_updates: [
        {
          operation: "add action",
          title: ["Draft founder outreach script"],
          parent_goal: "Become a founder",
        },
        {
          op: "add_attached_task",
          taskTitle: "Search top 20 Berkeley startup clubs",
          parentAction: "Draft founder outreach script",
        },
        {
          op: "unknown_op",
          title: "Should be ignored",
        },
      ],
    },
    "workspace"
  );

  assert.equal(response.phase, "workspace");
  assert.equal(Array.isArray(response.graphUpdates), true);
  assert.equal(response.graphUpdates.length, 2);
  assert.equal(response.graphUpdates[0].op, "add_speed1_action");
  assert.equal(response.graphUpdates[0].parentGoal, "Become a Founder");
  assert.equal(response.graphUpdates[1].op, "add_attached_task");
});

test("normalizeAgentRunRequest enforces required identity fields", () => {
  const payload = normalizeAgentRunRequest({
    taskId: "task_1",
    task: {
      title: "Research tournament options",
      executionMode: "Agent",
      conflicts: [{ nodeId: "goal_1", weight: "0.4" }],
    },
    approvalToken: "false",
  });

  assert.equal(payload.taskId, "task_1");
  assert.equal(payload.task.id, "task_1");
  assert.equal(payload.task.executionMode, "Agent");
  assert.equal(payload.task.conflicts[0].weight, 0.4);
});

test("normalizeAgentRunResponse tolerates snake_case and mixed types", () => {
  const response = normalizeAgentRunResponse({
    status: "completed",
    message: ["done"],
    task_confidence_delta: "0.08",
    parent_confidence_delta: "0.03",
    result: {
      id: "result_1",
      task_id: "task_1",
      action_summary: ["Completed", "summary"],
      outputs: ["A", 12, true],
      intent_alignment_report: {
        reward: "0.6",
        constraints_approached: "3 hours/week",
      },
    },
  });

  assert.equal(response.status, "completed");
  assert.equal(response.taskConfidenceDelta, 0.08);
  assert.equal(response.parentConfidenceDelta, 0.03);
  assert.equal(response.result.taskId, "task_1");
  assert.equal(typeof response.result.actionSummary, "string");
  assert.equal(response.result.intentAlignmentReport.reward, 0.6);
  assert.equal(response.log.id, "result_1");
});
