import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProbeMessage,
  deconstructOnboardingConversation,
  extractNameFromMessage,
  ONBOARDING_NAME_PROMPT,
} from "../src/onboarding.js";

test("onboarding starts with name prompt", () => {
  assert.match(ONBOARDING_NAME_PROMPT, /what should i call you/i);
});

test("buildProbeMessage returns a probing question", () => {
  const message = buildProbeMessage(0, "I am a student and builder.");
  assert.match(message, /roles define your life/i);
});

test("extractNameFromMessage handles casual intros", () => {
  const first = extractNameFromMessage("sup im pragun");
  assert.equal(first.name, "Pragun");

  const second = extractNameFromMessage("hey its pragun nice to meet you");
  assert.equal(second.name, "Pragun");
});

test("deconstructOnboardingConversation keeps conversational outputs", () => {
  const profile = deconstructOnboardingConversation({
    responses: {
      aboutYourself: "I am a student founder.",
      roles: "student, founder",
      currentPriorities: "study for SAT and build MVP",
      longTermAmbitions: "get into college, launch startup",
      values: "growth, family",
      riskTolerance: "high, but thoughtful",
    },
    onboardingName: "Alex",
  });

  assert.equal(profile.accountName, "Alex");
  assert.equal(profile.riskTolerance, "high");
  assert.match(profile.roles, /student/i);
  assert.match(profile.currentPriorities, /study/i);
});
