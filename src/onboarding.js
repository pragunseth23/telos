import { normalize, splitList } from "./utils.js";

export const ONBOARDING_NAME_PROMPT = "Hey, I'm Telos. What should I call you?";
export const ONBOARDING_INTRO_PROMPT =
  "Great to meet you. I want to learn more about you. Tell me about yourself.";

export const ONBOARDING_PROBES = [
  {
    key: "roles",
    question:
      "Which roles define your life right now? (student, parent, founder, developer, etc.)",
  },
  {
    key: "currentPriorities",
    question: "What are your top priorities over the next 4-8 weeks?",
  },
  {
    key: "longTermAmbitions",
    question: "What long-term ambitions are you optimizing for over the next few years?",
  },
  {
    key: "values",
    question: "What values should never be compromised while pursuing your goals?",
  },
  {
    key: "constraints",
    question:
      "What constraints do I need to respect? Include time, money, geography, or obligations.",
  },
  {
    key: "relationships",
    question:
      "Who are your most important relationships I should account for in decisions and plans?",
  },
  {
    key: "tensions",
    question:
      "Where do you feel competing tensions right now? (for example growth vs stability)",
  },
  {
    key: "riskTolerance",
    question:
      "How would you describe your risk tolerance today: low, medium, or high? You can add nuance.",
  },
  {
    key: "workStyle",
    question:
      "What work style helps you perform best? (deep work windows, collaboration style, planning cadence)",
  },
  {
    key: "creativeAspirations",
    question:
      "What creative aspirations matter to you, even if they are not urgent right now?",
  },
];

function splitNaturalList(rawValue) {
  const normalized = String(rawValue || "")
    .replace(/\s+and\s+/gi, ", ")
    .replace(/\s+or\s+/gi, ", ");
  return splitList(normalized);
}

function inferRolesFromAbout(rawAbout) {
  const about = normalize(rawAbout);
  if (!about) {
    return [];
  }

  const roleHints = [
    "student",
    "parent",
    "founder",
    "developer",
    "engineer",
    "designer",
    "manager",
    "teacher",
    "researcher",
  ];

  return roleHints.filter((role) => about.includes(role));
}

function parseRiskTolerance(rawValue) {
  const value = normalize(rawValue);
  if (!value) {
    return "medium";
  }

  if (/low|cautious|conservative|risk averse/.test(value)) {
    return "low";
  }

  if (/high|aggressive|bold|very comfortable/.test(value)) {
    return "high";
  }

  return "medium";
}

function stringifyList(listValue, fallbackValue = "") {
  if (!Array.isArray(listValue) || listValue.length === 0) {
    return fallbackValue;
  }
  return listValue.join(", ");
}

function shortReflect(rawValue) {
  const cleaned = String(rawValue || "").trim();
  if (!cleaned) {
    return "";
  }

  const words = cleaned.split(/\s+/).slice(0, 12).join(" ");
  return words.length < cleaned.length ? `${words}...` : words;
}

function toDisplayName(rawValue) {
  const cleaned = String(rawValue || "")
    .replace(/[^a-zA-Z'-\s]/g, " ")
    .trim();
  if (!cleaned) {
    return "";
  }

  const stopWords = new Set([
    "nice",
    "to",
    "meet",
    "you",
    "hey",
    "hi",
    "hello",
    "sup",
    "yo",
    "its",
    "it's",
    "im",
    "i",
    "am",
  ]);

  const tokens = cleaned
    .split(/\s+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token && !stopWords.has(token));

  if (!tokens.length) {
    return "";
  }

  const picked = tokens.slice(0, 2);
  return picked
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

export function extractNameFromMessage(rawMessage) {
  const message = String(rawMessage || "").trim();
  if (!message) {
    return {
      name: "",
      confidence: 0,
    };
  }

  const patterns = [
    /(?:my name is|name's|i am|i'm|im|this is|call me|its|it's)\s+([a-zA-Z][a-zA-Z'\-\s]{0,40})/i,
    /^(?:hey|hi|hello|sup|yo)\s+(?:it'?s\s+)?([a-zA-Z][a-zA-Z'\-\s]{0,40})/i,
    /^([a-zA-Z][a-zA-Z'\-\s]{0,40})$/i,
  ];

  for (let index = 0; index < patterns.length; index += 1) {
    const pattern = patterns[index];
    const match = message.match(pattern);
    if (!match) {
      continue;
    }

    const name = toDisplayName(match[1]);
    if (!name) {
      continue;
    }

    const confidence = index === 0 ? 0.95 : index === 1 ? 0.82 : 0.62;
    return {
      name,
      confidence,
    };
  }

  return {
    name: "",
    confidence: 0,
  };
}

export function buildProbeMessage(probeIndex, previousAnswer = "") {
  const probe = ONBOARDING_PROBES[probeIndex];
  if (!probe) {
    return "Thanks. I have enough context to build your initial Intent Graph.";
  }

  const reflection = shortReflect(previousAnswer);
  if (!reflection) {
    return probe.question;
  }

  return `Noted: "${reflection}"\n\n${probe.question}`;
}

export function deconstructOnboardingConversation({
  responses = {},
  onboardingName = "",
} = {}) {
  const aboutYourself = String(responses.aboutYourself || "").trim();
  const roles = splitNaturalList(responses.roles);
  const inferredRoles = roles.length > 0 ? roles : inferRolesFromAbout(aboutYourself);

  const currentPriorities = splitNaturalList(responses.currentPriorities);
  const longTermAmbitions = splitNaturalList(responses.longTermAmbitions);
  const values = splitNaturalList(responses.values);
  const constraints = splitNaturalList(responses.constraints);
  const relationships = splitNaturalList(responses.relationships);
  const tensions = splitNaturalList(responses.tensions);

  const workStyle = String(responses.workStyle || "").trim();
  const creativeAspirations = String(responses.creativeAspirations || "").trim();
  const riskTolerance = parseRiskTolerance(responses.riskTolerance);

  return {
    aboutYourself: aboutYourself || "Profile captured from onboarding conversation.",
    roles: stringifyList(inferredRoles, "person"),
    currentPriorities: stringifyList(
      currentPriorities,
      "Define immediate priorities with bounded scope"
    ),
    longTermAmbitions: stringifyList(
      longTermAmbitions,
      "Clarify long-term ambitions and measurable milestones"
    ),
    values: stringifyList(values, "growth"),
    constraints: stringifyList(constraints),
    relationships: stringifyList(relationships),
    tensions: stringifyList(tensions),
    riskTolerance,
    workStyle,
    creativeAspirations,
    accountName: onboardingName || "",
    profileSource: "onboarding_conversation",
  };
}
