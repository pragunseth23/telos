import { clamp, normalize, splitList } from "./utils.js";

const LATENT_MOTIVATIONS = [
  { keyword: "family", label: "protecting and investing in relationships" },
  { keyword: "health", label: "long-term wellbeing and energy" },
  { keyword: "money", label: "financial security and optionality" },
  { keyword: "creative", label: "expressive growth and identity" },
  { keyword: "impact", label: "contribution and social influence" },
];

function findMentionedNodes(message, graph) {
  const text = normalize(message);
  if (!text) {
    return [];
  }

  return graph.getAllNodes().filter((node) => {
    return node.title && text.includes(node.title.toLowerCase());
  });
}

function detectPriorityDirection(message) {
  const text = normalize(message);
  if (!text) {
    return 0;
  }

  if (/more important|increase|prioritize|focus more/.test(text)) {
    return 0.07;
  }

  if (/less important|decrease|deprioritize|not important|pause/.test(text)) {
    return -0.07;
  }

  return 0.02;
}

function detectInconsistency(message, profile) {
  const text = normalize(message);
  if (!text || !profile) {
    return null;
  }

  const values = splitList(profile.values).map((value) => value.toLowerCase());
  if (values.some((value) => value.includes("family")) && /ignore family/.test(text)) {
    return "This appears to conflict with your stated value around family.";
  }

  if (values.some((value) => value.includes("health")) && /skip sleep|ignore health/.test(text)) {
    return "This appears to conflict with your stated value around health.";
  }

  return null;
}

function detectLatentMotivation(message) {
  const text = normalize(message);
  const match = LATENT_MOTIVATIONS.find((entry) => text.includes(entry.keyword));
  return match ? match.label : null;
}

export function generateAssistantReply({ message, graph, profile, selectedNode }) {
  const mentionedNodes = findMentionedNodes(message, graph);
  const direction = detectPriorityDirection(message);
  const updates = [];
  const responseParts = [];

  if (mentionedNodes.length > 0) {
    for (const node of mentionedNodes) {
      updates.push({
        nodeId: node.id,
        patch: {
          priorityWeight: clamp(node.priorityWeight + direction, 0.05, 1),
          confidenceScore: clamp(node.confidenceScore + 0.03, 0, 1),
        },
        reason: `Priority update from conversation mention: ${node.title}`,
      });
    }

    responseParts.push("I updated intent emphasis based on your message.");
  } else if (selectedNode) {
    responseParts.push(
      `I did not detect a direct node mention, so I kept weights stable and focused context on "${selectedNode.title}".`
    );
  } else {
    responseParts.push("I did not detect a direct node mention yet.");
  }

  const inconsistency = detectInconsistency(message, profile);
  if (inconsistency) {
    responseParts.push(inconsistency);
  }

  const latentMotivation = detectLatentMotivation(message);
  if (latentMotivation) {
    responseParts.push(`Potential latent motivation detected: ${latentMotivation}.`);
  }

  if (/split|restructure|break down/.test(normalize(message))) {
    responseParts.push(
      "If you want, I can split one Speed-2 goal into smaller Speed-1 milestones to reduce ambiguity."
    );
  }

  responseParts.push(
    "Share one concrete next action and I can encode it as a Speed-1 task with execution mode."
  );

  return {
    message: responseParts.join(" "),
    updates,
  };
}

export function maybeBuildPeriodicSummary(messages, graph) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }

  if (messages.length % 6 !== 0) {
    return null;
  }

  const topGoals = graph
    .getNodesByType("speed2")
    .sort((a, b) => b.priorityWeight - a.priorityWeight)
    .slice(0, 3)
    .map((node) => node.title);

  const recentUpdates = graph.getRecentVersions(3).map((version) => version.reason);
  return {
    title: "Graph Evolution Summary",
    text: `Top Speed-2 goals: ${topGoals.join(", ")}. Recent graph updates: ${recentUpdates.join(
      " | "
    )}.`,
  };
}
