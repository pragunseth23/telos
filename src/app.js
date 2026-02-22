import { IntentGraphEngine, NODE_TYPES } from "./intentGraph.js";
import { MemoryStore } from "./memory.js";
import {
  requestAgentRun,
  requestAgentResultDocument,
  requestModelTurn,
  resetModelContext,
} from "./api.js";
import {
  ensureAttachedTaskTitle,
  ensureSpeed1ActionTitle,
  ensureSpeed2GoalTitle,
  normalizeTitleForDisplay,
  normalizeTitleKey,
} from "./naming.js";
import { deepClone, nowIso, uid } from "./utils.js";

const appRoot = document.getElementById("app");
const store = new MemoryStore();
const SCROLL_BOTTOM_THRESHOLD = 64;

const WORKSPACE_INITIAL_MESSAGE =
  "Workspace ready. Select an Action to execute, or chat to refine your direction.";

const APP_ROUTES = Object.freeze({
  HOME: "home",
  WORKSPACE: "workspace",
  ONBOARDING: "onboarding",
});

const TASK_ASSIGNEES = Object.freeze({
  AGENT: "agent",
  HUMAN: "human",
});

const PROFILE_FIELDS = [
  "aboutYourself",
  "roles",
  "currentPriorities",
  "longTermAmbitions",
  "values",
  "constraints",
  "relationships",
  "tensions",
  "riskTolerance",
  "workStyle",
  "creativeAspirations",
];

const AGENT_RUN_ALLOW_PATTERNS = [
  /\bsearch\b/,
  /\bfind\b/,
  /\bresearch\b/,
  /\bcompare\b/,
  /\bsummarize\b/,
  /\borganize\b/,
  /\bcollect\b/,
  /\bgather\b/,
  /\bcompile\b/,
  /\bdraft\b/,
  /\boutline\b/,
  /\bbrainstorm\b/,
  /\banaly[sz]e\b/,
  /\bonline\b/,
  /\bstudy materials?\b/,
  /\bresources?\b/,
];

const AGENT_RUN_ACTION_PATTERNS = [
  /\bsearch\b/,
  /\bfind\b/,
  /\bresearch\b/,
  /\bcompare\b/,
  /\bsummarize\b/,
  /\borganize\b/,
  /\bcollect\b/,
  /\bgather\b/,
  /\bcompile\b/,
  /\bdraft\b/,
  /\boutline\b/,
  /\bbrainstorm\b/,
  /\banaly[sz]e\b/,
  /\brank\b/,
  /\bprioritize\b/,
];

const AGENT_RUN_SCOPE_PATTERNS = [
  /\bfor\b/,
  /\babout\b/,
  /\bon\b/,
  /\bfrom\b/,
  /\bbetween\b/,
  /\bwithin\b/,
  /\bacross\b/,
  /\bnear\b/,
  /\blocal\b/,
  /\btop\b/,
  /\bbest\b/,
  /\bvs\b/,
];

const AGENT_RUN_OUTPUT_PATTERNS = [
  /\blist\b/,
  /\bshortlist\b/,
  /\btable\b/,
  /\bcomparison\b/,
  /\bsummary\b/,
  /\bbrief\b/,
  /\breport\b/,
  /\bchecklist\b/,
  /\blinks?\b/,
  /\bsources?\b/,
  /\bresources?\b/,
  /\bstudy materials?\b/,
  /\bplan\b/,
  /\boutline\b/,
];

const AGENT_RUN_BLOCK_PATTERNS = [
  /\bpractice\b/,
  /\bplay\b/,
  /\bworkout\b/,
  /\bexercise\b/,
  /\btrain\b/,
  /\battend\b/,
  /\bgo to\b/,
  /\bshow up\b/,
  /\bcall\b/,
  /\bmeet\b/,
  /\btalk to\b/,
  /\binterview\b/,
  /\bcook\b/,
  /\btravel\b/,
  /\bstudy\b(?!\s+materials?)/,
  /\bbuild\b/,
  /\bcode\b/,
  /\bdevelop\b/,
  /\bship\b/,
  /\blaunch\b/,
];

const LENS_PROFILE_PRESETS = Object.freeze({
  student: {
    aboutYourself: "Student focused on compounding learning and long-term craft.",
    currentPriorities:
      "Classes and exam readiness\nResearch and project building\nHealth and recovery",
    longTermAmbitions:
      "Build deep technical mastery\nGraduate with a standout portfolio",
    values: "Learning\nDiscipline\nConsistency\nIntegrity",
    tensions: "Grades vs projects",
    workStyle: "Structured and execution-focused",
    creativeAspirations: "Build useful products that help real people",
    riskTolerance: "balanced",
  },
  "squash player": {
    aboutYourself: "Athlete identity focused on squash performance and consistency.",
    currentPriorities:
      "On-court training sessions\nFootwork and conditioning\nMatch review and tactics",
    longTermAmbitions:
      "Reach competitive squash level\nBuild elite movement and shot selection",
    values: "Discipline\nResilience\nExecution\nConsistency",
    tensions: "Training load vs academic workload",
    workStyle: "Repetition, feedback loops, and focused blocks",
    creativeAspirations: "Design smarter training systems and routines",
    riskTolerance: "balanced",
  },
  traveler: {
    aboutYourself: "Curious traveler optimizing for meaningful exploration and learning.",
    currentPriorities:
      "Plan next destination and itinerary\nBudget and logistics planning\nCulture and language preparation",
    longTermAmbitions:
      "Build a life with global perspective\nCreate a repeatable travel-learning system",
    values: "Curiosity\nPresence\nAdaptability\nGrowth",
    tensions: "Exploration vs routine commitments",
    workStyle: "Iterative planning with flexibility",
    creativeAspirations: "Capture stories and insights from each trip",
    riskTolerance: "balanced",
  },
});

function resolveLensPreset(lensLabel) {
  const normalized = normalizeLensLabel(lensLabel).toLowerCase();
  if (!normalized) {
    return null;
  }
  if (LENS_PROFILE_PRESETS[normalized]) {
    return LENS_PROFILE_PRESETS[normalized];
  }
  if (normalized.includes("student")) {
    return LENS_PROFILE_PRESETS.student;
  }
  if (normalized.includes("squash")) {
    return LENS_PROFILE_PRESETS["squash player"];
  }
  if (normalized.includes("travel")) {
    return LENS_PROFILE_PRESETS.traveler;
  }
  return null;
}

function buildLensProfile(baseProfile, lensLabel, baseName) {
  const cleanLabel = normalizeLensLabel(lensLabel);
  const preset = resolveLensPreset(cleanLabel);
  const genericProfile = {
    aboutYourself: `${cleanLabel} identity focused on meaningful progress and execution.`,
    currentPriorities: `Define weekly ${cleanLabel} priorities\nExecute highest-impact ${cleanLabel} task`,
    longTermAmbitions: `Build long-term excellence as a ${cleanLabel}\nCreate compounding outcomes in this identity`,
    values: "Impact\nLearning\nDiscipline",
    tensions: "",
    workStyle: "Focused deep work with clear weekly goals",
    creativeAspirations: `Build creative output connected to ${cleanLabel.toLowerCase()}`,
    riskTolerance: "balanced",
  };
  const seeded = preset || genericProfile;
  return normalizeStoredProfile(
    {
      ...(baseProfile || {}),
      ...seeded,
      roles: cleanLabel,
      displayName: String(baseProfile?.displayName || baseName || "").trim(),
      accountName: String(baseProfile?.accountName || baseName || "").trim(),
      profileSource: "lens_template",
    },
    baseName || ""
  );
}

function normalizeTaskExecutionText(taskNode) {
  if (!taskNode || typeof taskNode !== "object") {
    return "";
  }

  const checklistText = getChecklistForNode(taskNode)
    .map((item) => String(item?.title || "").trim())
    .filter(Boolean)
    .join(" ");

  return `${String(taskNode.title || "")} ${String(taskNode.description || "")} ${checklistText}`
    .trim()
    .toLowerCase();
}

function evaluateAgentAutomationText(rawText, options = {}) {
  const normalizedText = String(rawText || "").trim().toLowerCase();
  const minWords = Number(options.minWords ?? 6);
  const requireScope = options.requireScope !== false;

  if (!normalizedText) {
    return {
      allowed: false,
      reason: "Add a specific attached task before running the agent.",
    };
  }

  const hasAllowSignal = AGENT_RUN_ALLOW_PATTERNS.some((pattern) => pattern.test(normalizedText));
  if (!hasAllowSignal) {
    return {
      allowed: false,
      reason: "Agent runs are reserved for explicit online research and synthesis tasks.",
    };
  }

  const hasBlockSignal = AGENT_RUN_BLOCK_PATTERNS.some((pattern) => pattern.test(normalizedText));
  if (hasBlockSignal) {
    return {
      allowed: false,
      reason: "This task appears to require human or real-world execution steps.",
    };
  }

  const wordCount = normalizedText.split(/\s+/).filter(Boolean).length;
  const hasActionSignal = AGENT_RUN_ACTION_PATTERNS.some((pattern) =>
    pattern.test(normalizedText)
  );
  if (!hasActionSignal || wordCount < minWords) {
    return {
      allowed: false,
      reason:
        "Agent tasks must be specific and actionable: include a concrete research action and clear scope.",
    };
  }

  if (requireScope) {
    const hasScopeSignal = AGENT_RUN_SCOPE_PATTERNS.some((pattern) =>
      pattern.test(normalizedText)
    );
    const hasOutputSignal = AGENT_RUN_OUTPUT_PATTERNS.some((pattern) =>
      pattern.test(normalizedText)
    );
    const hasNumericScope = /\d/.test(normalizedText);
    if (!hasScopeSignal && !hasOutputSignal && !hasNumericScope) {
      return {
        allowed: false,
        reason:
          "Agent tasks must specify expected output (for example list/table/links) or explicit scope.",
      };
    }
  }

  return {
    allowed: true,
    reason: "",
  };
}

function inferTaskAssignee(taskTitle) {
  const automation = evaluateAgentAutomationText(taskTitle, {
    minWords: 3,
    requireScope: false,
  });
  return automation.allowed ? TASK_ASSIGNEES.AGENT : TASK_ASSIGNEES.HUMAN;
}

function normalizeTaskAssignee(rawAssignee, taskTitle = "", rawAutomatable = null) {
  const normalized = String(rawAssignee || "")
    .trim()
    .toLowerCase();
  if (normalized === TASK_ASSIGNEES.AGENT || normalized === TASK_ASSIGNEES.HUMAN) {
    return normalized;
  }
  if (rawAutomatable === true) {
    return TASK_ASSIGNEES.AGENT;
  }
  if (rawAutomatable === false) {
    return TASK_ASSIGNEES.HUMAN;
  }
  return inferTaskAssignee(taskTitle);
}

function taskAssigneeLabel(rawAssignee) {
  return normalizeTaskAssignee(rawAssignee) === TASK_ASSIGNEES.AGENT ? "Agent" : "Human";
}

function evaluateAgentExecutability(taskNode) {
  if (!taskNode || taskNode.type !== NODE_TYPES.SPEED1) {
    return {
      allowed: false,
      reason: "Only Actions are eligible for agent execution.",
    };
  }

  return evaluateAgentAutomationText(normalizeTaskExecutionText(taskNode), {
    minWords: 6,
    requireScope: true,
  });
}

function evaluateAttachedTaskExecutability(taskNode, checklistItem) {
  if (!taskNode || taskNode.type !== NODE_TYPES.SPEED1) {
    return {
      allowed: false,
      reason: "Attached tasks are only available on Actions.",
    };
  }
  const itemTitle = String(checklistItem?.title || "").trim();
  if (!itemTitle) {
    return {
      allowed: false,
      reason: "Attached task is missing a title.",
    };
  }
  if (checklistItem?.done) {
    return {
      allowed: false,
      reason: "This attached task is already completed.",
    };
  }
  const assignee = normalizeTaskAssignee(
    checklistItem?.assignee,
    itemTitle,
    typeof checklistItem?.automatable === "boolean" ? checklistItem.automatable : null
  );
  if (assignee !== TASK_ASSIGNEES.AGENT) {
    return {
      allowed: false,
      reason: `Assigned to ${taskAssigneeLabel(assignee)}.`,
    };
  }

  return {
    allowed: true,
    reason: "",
  };
}

const state = hydrateState(store.load());
const scrollState = {
  onboarding: {
    scrollTop: 0,
    stickToBottom: true,
    lastMessageCount: state.onboarding.chatMessages.length,
    pendingAutoScroll: true,
  },
  workspace: {
    scrollTop: 0,
    stickToBottom: true,
    lastMessageCount: state.messages.length,
    pendingAutoScroll: true,
  },
};
let forceGraphRuntimePromise = null;
let forceGraphInstance = null;
let forceGraphRenderToken = 0;
let hoveredGraphNodeId = "";
let homeForceGraphInstances = [];
let homeForceGraphRenderToken = 0;

function createEmptyAgentDocumentViewer() {
  return {
    open: false,
    loading: false,
    copied: false,
    deliverablesCopied: false,
    pathsCopied: false,
    resultId: "",
    title: "Task Result",
    content: "",
    deliverables: [],
    deliverablePaths: [],
    deliverablesFolderPath: "",
    error: "",
  };
}

function toIdentityLabel(profile, fallbackIndex = 1) {
  const firstRole = deriveLensCandidates(profile)[0];
  if (firstRole) {
    return firstRole;
  }

  return `Lens ${fallbackIndex}`;
}

function normalizeLensLabel(rawLabel) {
  const cleaned = String(rawLabel || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return "";
  }
  return cleaned
    .split(" ")
    .map((token) => {
      const raw = token.trim();
      const lower = raw.toLowerCase();
      if (["uc", "ai", "ml", "cs"].includes(lower)) {
        return lower.toUpperCase();
      }
      return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    })
    .join(" ");
}

function normalizeLensCandidate(rawLabel) {
  let cleaned = String(rawLabel || "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/^[\s"'`]+|[\s"'`]+$/g, "")
    .replace(/^[\-*+•]+/, "")
    .replace(/^\d+[\).:-]?\s*/, "")
    .replace(
      /^(?:core\s*identity|identity|primary\s*identity|role|roles|lens|profile)\s*[:\-]\s*/i,
      ""
    )
    .replace(/^(?:as a|as an)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "";
  }

  const lowered = cleaned.toLowerCase();
  const yearMatch = lowered.match(/\b(freshman|sophomore|junior|senior)\b/);
  if (yearMatch) {
    return normalizeLensLabel(yearMatch[1]);
  }
  if (
    /\baspiring\b/.test(lowered) &&
    /\bproduct\b/.test(lowered) &&
    /\bbuilder\b/.test(lowered)
  ) {
    return "Aspiring Product Builder";
  }
  if (
    (/\bproduct\b/.test(lowered) || /\bstartup\b/.test(lowered) || /\bcompany\b/.test(lowered)) &&
    (/\bbuilder\b/.test(lowered) || /\bfounder\b/.test(lowered) || /\bentrepreneur\b/.test(lowered))
  ) {
    return "Aspiring Product Builder";
  }
  if (
    /\bstudent\b/.test(lowered) ||
    /\bberkeley\b/.test(lowered) ||
    /\buniversity\b/.test(lowered) ||
    /\bcollege\b/.test(lowered)
  ) {
    return "Student";
  }

  return normalizeLensLabel(cleaned);
}

function splitLensCandidates(rawText) {
  const unique = [];
  String(rawText || "")
    .split(/[\/\n,;|]+/)
    .map((entry) => normalizeLensCandidate(entry))
    .filter(Boolean)
    .forEach((candidate) => {
      if (unique.some((entry) => entry.toLowerCase() === candidate.toLowerCase())) {
        return;
      }
      unique.push(candidate);
    });
  return unique;
}

function deriveLensCandidates(profile) {
  const labels = [];
  const push = (label) => {
    const normalized = normalizeLensCandidate(label);
    if (!normalized) {
      return;
    }
    if (labels.some((entry) => entry.toLowerCase() === normalized.toLowerCase())) {
      return;
    }
    labels.push(normalized);
  };

  splitLensCandidates(profile?.roles).forEach(push);

  const aboutText = String(profile?.aboutYourself || "").trim();
  const looksLikeStructuredIdentity =
    /[\/|;\n,]/.test(aboutText) ||
    /\bcore\s*identity\b/i.test(aboutText) ||
    /\bidentity\s*:/i.test(aboutText) ||
    /\broles?\s*:/i.test(aboutText);
  if (looksLikeStructuredIdentity) {
    splitLensCandidates(aboutText).forEach(push);
  }

  return labels;
}

function inferLensLabelsFromProfile(profile, primaryLabel) {
  const primaryText = normalizeLensLabel(primaryLabel).toLowerCase();
  const fullText = [
    profile?.roles,
    profile?.aboutYourself,
    profile?.currentPriorities,
    profile?.longTermAmbitions,
    profile?.creativeAspirations,
  ]
    .map((entry) => String(entry || "").toLowerCase())
    .join(" ");

  const labels = [];
  const pushLabel = (label) => {
    const normalized = normalizeLensLabel(label);
    if (!normalized) {
      return;
    }
    if (normalized.toLowerCase() === normalizeLensLabel(primaryLabel).toLowerCase()) {
      return;
    }
    if (labels.some((entry) => entry.toLowerCase() === normalized.toLowerCase())) {
      return;
    }
    labels.push(normalized);
  };

  deriveLensCandidates(profile).forEach(pushLabel);

  const primaryLooksStudent =
    /\bstudent|freshman|sophomore|junior|senior|school|class|college|university|berkeley\b/.test(
      primaryText
    );
  if (
    !primaryLooksStudent &&
    /\bstudent|freshman|sophomore|junior|senior|school|class|college|university|berkeley\b/.test(
      fullText
    )
  ) {
    pushLabel("Student");
  }
  if (/\bsquash\b/.test(fullText)) {
    pushLabel("Squash Player");
  } else if (/\bpickleball|athlete|fitness|training|exercise|sport\b/.test(fullText)) {
    pushLabel("Athlete");
  }
  if (/\btravel|trip|itinerary|flight|vacation|abroad|explore\b/.test(fullText)) {
    pushLabel("Traveler");
  }
  if (/\bbuilder|build|startup|found|entrepreneur|company|product|go to market|gtm\b/.test(fullText)) {
    pushLabel("Aspiring Product Builder");
  }
  if (/\bcreative|creator|cook|chef|art|music|writing\b/.test(fullText)) {
    pushLabel("Creator");
  }

  return labels.slice(0, 4);
}

function buildSeededAttachedTasks(nodeTitle) {
  const focus = normalizeTitleForDisplay(String(nodeTitle || "this action").trim(), "This Action");
  return normalizeChecklistItems([
    {
      id: uid("check"),
      title: ensureAttachedTaskTitle("", focus, 1),
      done: false,
      automatable: true,
      status: "todo",
    },
    {
      id: uid("check"),
      title: ensureAttachedTaskTitle("", focus, 2),
      done: false,
      automatable: true,
      status: "todo",
    },
    {
      id: uid("check"),
      title: normalizeTitleForDisplay(
        `Complete one 60-minute creative execution block for ${focus}`,
        "Complete One 60-Minute Creative Execution Block"
      ),
      done: false,
      automatable: false,
      status: "todo",
    },
  ]);
}

function normalizeRootIdentityTitleForGraph(graphEngine) {
  if (!graphEngine || typeof graphEngine.getRoot !== "function") {
    return;
  }

  const rootNode = graphEngine.getRoot();
  if (!rootNode?.id) {
    return;
  }

  const currentTitle = String(rootNode.title || "").trim();
  const roles = Array.isArray(rootNode.metadata?.roles)
    ? rootNode.metadata.roles
        .map((entry) => String(entry || "").trim())
        .filter(Boolean)
    : [];
  const strippedTitle = currentTitle
    .replace(/^core\s*identity\s*[:\-]\s*/i, "")
    .replace(/^core\s*identity$/i, "")
    .trim();
  const normalizedTitle = strippedTitle || roles.join(" / ") || "Identity";
  if (normalizedTitle === currentTitle) {
    return;
  }

  graphEngine.updateNode(
    rootNode.id,
    { title: normalizedTitle },
    "Root title normalized",
    { snapshot: false }
  );
}

function ensureChecklistScaffoldingForGraph(graphEngine) {
  if (!graphEngine || typeof graphEngine.getNodesByType !== "function") {
    return;
  }

  const speed1Nodes = graphEngine.getNodesByType(NODE_TYPES.SPEED1);
  let changed = false;
  speed1Nodes.forEach((node) => {
    const existingChecklist = normalizeChecklistItems(node?.metadata?.checklist);
    if (existingChecklist.length > 0) {
      return;
    }

    graphEngine.updateNode(
      node.id,
      {
        metadata: {
          ...(node.metadata || {}),
          checklist: buildSeededAttachedTasks(node.title),
        },
      },
      `Attached tasks seeded for ${node.title}`,
      { snapshot: false }
    );
    changed = true;
  });

  if (changed && typeof graphEngine.snapshot === "function") {
    graphEngine.snapshot("Attached tasks generated from action nodes");
  }
}

function normalizeIdentityRecord(input, fallbackIndex = 1, baseName = "") {
  if (!input || typeof input !== "object") {
    return null;
  }

  const graphEngine = new IntentGraphEngine(input.graph || null);
  normalizeRootIdentityTitleForGraph(graphEngine);
  ensureChecklistScaffoldingForGraph(graphEngine);
  const rootNode = graphEngine.getRoot();
  const normalizedProfile =
    input.profile && typeof input.profile === "object"
      ? normalizeStoredProfile(input.profile, baseName)
      : null;
  const selectedNodeId = String(input.selectedNodeId || rootNode?.id || "");
  const labelSource = String(input.label || input.name || "").trim();
  const id = String(input.id || uid("identity"));

  return {
    id,
    label: labelSource || toIdentityLabel(normalizedProfile, fallbackIndex),
    profile: normalizedProfile,
    graph: graphEngine.toJSON(),
    messages: Array.isArray(input.messages) ? deepClone(input.messages) : [],
    taskResults: Array.isArray(input.taskResults)
      ? deepClone(input.taskResults)
      : Array.isArray(input.actionLogs)
      ? deepClone(input.actionLogs)
      : [],
    summaries: Array.isArray(input.summaries) ? deepClone(input.summaries) : [],
    selectedNodeId: selectedNodeId || rootNode?.id || null,
    createdAt: String(input.createdAt || nowIso()),
    updatedAt: String(input.updatedAt || nowIso()),
  };
}

function createGeneratedLensRecord(baseProfile, lensLabel, baseName = "", fallbackIndex = 1) {
  const normalizedLabel = normalizeLensLabel(lensLabel) || `Lens ${fallbackIndex}`;
  const lensProfile = buildLensProfile(baseProfile || {}, normalizedLabel, baseName || "");
  const graphEngine = new IntentGraphEngine();
  graphEngine.initializeFromOnboarding(lensProfile);
  normalizeRootIdentityTitleForGraph(graphEngine);
  ensureChecklistScaffoldingForGraph(graphEngine);
  const rootNode = graphEngine.getRoot();

  return {
    id: uid("identity"),
    label: normalizedLabel,
    profile: lensProfile,
    graph: graphEngine.toJSON(),
    messages: [],
    taskResults: [],
    summaries: [],
    selectedNodeId: rootNode?.id || null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function backfillDerivedIdentityLenses(identityGraphs, baseName = "") {
  if (!Array.isArray(identityGraphs) || identityGraphs.length === 0) {
    return;
  }

  const normalizedBase = normalizeLensLabel(baseName).toLowerCase();
  const existingLabels = new Set(
    identityGraphs
      .map((entry) => normalizeLensLabel(entry?.label || "").toLowerCase())
      .filter(Boolean)
  );

  identityGraphs.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }

    const roleCandidates = deriveLensCandidates(entry.profile || {});
    if (roleCandidates.length === 0) {
      return;
    }

    if (entry.profile && typeof entry.profile === "object") {
      entry.profile = normalizeStoredProfile(
        {
          ...entry.profile,
          roles: roleCandidates.join("\n"),
        },
        baseName
      );
    }

    const currentLabel = normalizeLensLabel(entry.label || "");
    const shouldRetitleCurrent =
      !currentLabel ||
      currentLabel.toLowerCase() === normalizedBase ||
      /core\s*identity/i.test(currentLabel) ||
      /[\/|]/.test(currentLabel);
    if (shouldRetitleCurrent) {
      entry.label = roleCandidates[0];
      existingLabels.add(roleCandidates[0].toLowerCase());
    }

    const sourceProfile = normalizeStoredProfile(entry.profile || {}, baseName);
    roleCandidates.slice(1).forEach((candidate) => {
      const candidateKey = candidate.toLowerCase();
      if (existingLabels.has(candidateKey)) {
        return;
      }

      const generated = createGeneratedLensRecord(
        sourceProfile,
        candidate,
        baseName,
        identityGraphs.length + 1
      );
      identityGraphs.push(generated);
      existingLabels.add(candidateKey);
    });
  });
}

function captureTrackedScroll(element, tracker) {
  if (!element || !tracker) {
    return;
  }
  const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
  const distanceToBottom = maxTop - element.scrollTop;
  tracker.scrollTop = element.scrollTop;
  tracker.stickToBottom = distanceToBottom <= SCROLL_BOTTOM_THRESHOLD;
}

function attachTrackedScrollBehavior(element, tracker, messageCount) {
  if (!element || !tracker) {
    return;
  }

  const hasNewMessages = messageCount > tracker.lastMessageCount;
  const shouldAutoScroll = tracker.pendingAutoScroll || tracker.stickToBottom || hasNewMessages;
  if (shouldAutoScroll) {
    element.scrollTop = element.scrollHeight;
    tracker.stickToBottom = true;
  } else {
    const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTop = Math.min(tracker.scrollTop, maxTop);
  }

  tracker.lastMessageCount = messageCount;
  tracker.pendingAutoScroll = false;
  tracker.scrollTop = element.scrollTop;
  element.addEventListener("scroll", () => {
    captureTrackedScroll(element, tracker);
  });
}

function captureChatScrollState() {
  captureTrackedScroll(document.getElementById("onboarding-stream"), scrollState.onboarding);
  captureTrackedScroll(document.getElementById("chat-log"), scrollState.workspace);
}

function closeAgentDocumentViewer() {
  state.agentDocumentViewer = createEmptyAgentDocumentViewer();
}

async function openAgentDocumentViewer(resultId, fallbackTitle = "Task Result") {
  const normalizedResultId = String(resultId || "").trim();
  if (!normalizedResultId) {
    return;
  }
  const resultEntry = state.taskResults.find(
    (entry) => String(entry?.id || "") === normalizedResultId
  );
  const deliverables = Array.isArray(resultEntry?.outputs)
    ? resultEntry.outputs.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const deliverablePaths = Array.isArray(resultEntry?.deliverablePaths)
    ? resultEntry.deliverablePaths.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const deliverablesFolderPath = String(resultEntry?.artifactPath || "").trim();

  state.agentDocumentViewer = {
    ...createEmptyAgentDocumentViewer(),
    open: true,
    loading: true,
    resultId: normalizedResultId,
    title: fallbackTitle,
    deliverables,
    deliverablePaths,
    deliverablesFolderPath,
  };
  render();

  try {
    const documentPayload = await requestAgentResultDocument(normalizedResultId);
    state.agentDocumentViewer = {
      ...state.agentDocumentViewer,
      open: true,
      loading: false,
      copied: false,
      deliverablesCopied: false,
      pathsCopied: false,
      title: String(documentPayload.title || fallbackTitle).trim() || fallbackTitle,
      content: String(documentPayload.content || ""),
      error: "",
    };
  } catch (error) {
    state.agentDocumentViewer = {
      ...state.agentDocumentViewer,
      open: true,
      loading: false,
      content: "",
      error: `Could not load task result. ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  render();
}

async function performGlobalResetAndReload() {
  try {
    await resetModelContext();
  } catch {
    // Ignore reset endpoint failures and still clear local state.
  }

  store.clear();
  window.location.reload();
}

function hydrateState(savedState) {
  const legacyGraph = new IntentGraphEngine(savedState?.graph || null);
  normalizeRootIdentityTitleForGraph(legacyGraph);
  ensureChecklistScaffoldingForGraph(legacyGraph);
  const legacyRootNode = legacyGraph.getRoot();
  const savedOnboarding = savedState?.onboarding || {};
  const now = nowIso();
  const savedBaseName = String(savedState?.baseName || "").trim();
  const normalizedIdentityGraphs = Array.isArray(savedState?.identityGraphs)
    ? savedState.identityGraphs
        .map((entry, index) => normalizeIdentityRecord(entry, index + 1, savedBaseName))
        .filter(Boolean)
    : [];

  if (normalizedIdentityGraphs.length === 0 && legacyRootNode) {
    const legacyProfile =
      savedState?.profile && typeof savedState.profile === "object"
        ? normalizeStoredProfile(savedState.profile, savedBaseName)
        : null;
    normalizedIdentityGraphs.push({
      id: uid("identity"),
      label: toIdentityLabel(legacyProfile, 1),
      profile: legacyProfile,
      graph: legacyGraph.toJSON(),
      messages: Array.isArray(savedState?.messages) ? deepClone(savedState.messages) : [],
      taskResults: Array.isArray(savedState?.taskResults)
        ? deepClone(savedState.taskResults)
        : Array.isArray(savedState?.actionLogs)
        ? deepClone(savedState.actionLogs)
        : [],
      summaries: Array.isArray(savedState?.summaries) ? deepClone(savedState.summaries) : [],
      selectedNodeId: savedState?.selectedNodeId || legacyRootNode.id,
      createdAt: now,
      updatedAt: now,
    });
  }

  const activeIdentityId = String(savedState?.activeIdentityId || "");
  const activeIdentity =
    normalizedIdentityGraphs.find((entry) => entry.id === activeIdentityId) ||
    normalizedIdentityGraphs[0] ||
    null;
  const graph = new IntentGraphEngine(activeIdentity?.graph || null);
  const rootNode = graph.getRoot();
  const onboardingCompleted = normalizedIdentityGraphs.length > 0;

  let onboardingStage = onboardingCompleted
    ? "complete"
    : savedOnboarding.stage || "chat";
  if (onboardingStage === "processing") {
    onboardingStage = "chat";
  }
  if (onboardingStage === "name") {
    onboardingStage = "chat";
  }

  const baseNameCandidate = String(
    savedState?.baseName ||
      activeIdentity?.profile?.displayName ||
      activeIdentity?.profile?.accountName ||
      savedOnboarding.name ||
      ""
  ).trim();
  backfillDerivedIdentityLenses(normalizedIdentityGraphs, baseNameCandidate);

  const onboarding = {
    stage: onboardingStage,
    name: savedOnboarding.name || "",
    lensLabel: savedOnboarding.lensLabel || "",
    responses:
      savedOnboarding.responses && typeof savedOnboarding.responses === "object"
        ? savedOnboarding.responses
        : {},
    chatMessages: Array.isArray(savedOnboarding.chatMessages)
      ? savedOnboarding.chatMessages
      : [],
    awaitingResponse: false,
    resetting: false,
    showResetConfirm: false,
    sessionToken: Number(savedOnboarding.sessionToken || 0),
    targetIdentityId: String(savedOnboarding.targetIdentityId || ""),
  };
  if (!onboardingCompleted && !onboarding.targetIdentityId) {
    onboarding.targetIdentityId = uid("identity");
  }
  if (baseNameCandidate && !onboarding.name) {
    onboarding.name = baseNameCandidate;
  }

  const savedRoute = String(savedState?.route || "");
  const route =
    savedRoute === APP_ROUTES.HOME ||
    savedRoute === APP_ROUTES.WORKSPACE ||
    savedRoute === APP_ROUTES.ONBOARDING
      ? savedRoute
      : onboardingCompleted
      ? APP_ROUTES.HOME
      : APP_ROUTES.ONBOARDING;
  if (baseNameCandidate) {
    normalizedIdentityGraphs.forEach((entry, index) => {
      const currentLabel = String(entry.label || "").trim().toLowerCase();
      if (currentLabel !== baseNameCandidate.toLowerCase()) {
        return;
      }
      const roleSeed = deriveLensCandidates(entry.profile || {})[0];
      entry.label = roleSeed || `Lens ${index + 1}`;
    });
  }

  return {
    route,
    baseName: baseNameCandidate,
    identityGraphs: normalizedIdentityGraphs,
    activeIdentityId: activeIdentity?.id || null,
    onboardingCompleted,
    onboarding,
    profile: activeIdentity?.profile
      ? normalizeStoredProfile(activeIdentity.profile, baseNameCandidate)
      : null,
    graph,
    messages: Array.isArray(activeIdentity?.messages) ? deepClone(activeIdentity.messages) : [],
    taskResults: Array.isArray(activeIdentity?.taskResults)
      ? deepClone(activeIdentity.taskResults)
      : Array.isArray(activeIdentity?.actionLogs)
      ? deepClone(activeIdentity.actionLogs)
      : [],
    summaries: Array.isArray(activeIdentity?.summaries) ? deepClone(activeIdentity.summaries) : [],
    selectedNodeId: activeIdentity?.selectedNodeId || rootNode?.id || null,
    modelBusy: false,
    showWorkspaceResetConfirm: false,
    agentDocumentViewer: createEmptyAgentDocumentViewer(),
  };
}

function persistState() {
  syncActiveIdentityFromWorking();
  const onboardingForSave = {
    ...state.onboarding,
  };
  delete onboardingForSave.awaitingResponse;
  delete onboardingForSave.resetting;
  delete onboardingForSave.showResetConfirm;

  store.save({
    route: state.route,
    baseName: state.baseName || "",
    identityGraphs: deepClone(state.identityGraphs),
    activeIdentityId: state.activeIdentityId,
    onboardingCompleted: state.onboardingCompleted,
    onboarding: onboardingForSave,
    profile: state.profile,
    graph: state.graph.toJSON(),
    messages: state.messages,
    taskResults: state.taskResults,
    summaries: state.summaries,
    selectedNodeId: state.selectedNodeId,
  });
}

function addMessage(role, content, metadata = {}) {
  state.messages.push({
    id: uid("msg"),
    role,
    content,
    createdAt: new Date().toISOString(),
    metadata,
  });
  scrollState.workspace.pendingAutoScroll = true;
}

function addOnboardingMessage(role, content, metadata = {}) {
  state.onboarding.chatMessages.push({
    id: uid("onboard_msg"),
    role,
    content,
    createdAt: new Date().toISOString(),
    metadata,
  });
  scrollState.onboarding.pendingAutoScroll = true;
}

function escapeHtml(rawValue) {
  return String(rawValue || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function truncate(text, max = 28) {
  if (!text) {
    return "";
  }
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 3)}...`;
}

function toNodeTypeLabel(type) {
  if (type === NODE_TYPES.ROOT) {
    return "Identity";
  }
  if (type === NODE_TYPES.SPEED2) {
    return "Goal";
  }
  return "Action";
}

function summarizeExecutionLog(rawText, maxLength = 260) {
  const normalized = String(rawText || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "Execution completed.";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function renderMarkdownInline(escapedText) {
  let output = String(escapedText || "");
  output = output.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, url) => {
    const href = String(url || "").trim();
    const normalizedHref = href.replace(/&amp;/g, "&").toLowerCase();
    if (!normalizedHref.startsWith("https://") && !normalizedHref.startsWith("http://")) {
      return label;
    }
    return `<a href="${href}" target="_blank" rel="noreferrer noopener">${label}</a>`;
  });
  output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  output = output.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  output = output.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  output = output.replace(/_([^_]+)_/g, "<em>$1</em>");
  output = output.replace(/`([^`]+)`/g, "<code>$1</code>");
  return output;
}

function renderMarkdownDocument(rawMarkdown) {
  const source = String(rawMarkdown || "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!source) {
    return "<p>No content.</p>";
  }

  const htmlParts = [];
  let paragraphBuffer = [];
  let listType = "";
  let listItems = [];
  let inCodeBlock = false;
  let codeBlockLanguage = "";
  let codeBlockLines = [];

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) {
      return;
    }
    const paragraph = paragraphBuffer.join(" ").replace(/\s+/g, " ").trim();
    paragraphBuffer = [];
    if (!paragraph) {
      return;
    }
    htmlParts.push(`<p>${renderMarkdownInline(escapeHtml(paragraph))}</p>`);
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) {
      listType = "";
      listItems = [];
      return;
    }
    const itemsMarkup = listItems
      .map((item) => `<li>${renderMarkdownInline(escapeHtml(item))}</li>`)
      .join("");
    htmlParts.push(`<${listType}>${itemsMarkup}</${listType}>`);
    listType = "";
    listItems = [];
  };

  const flushCodeBlock = () => {
    const languageToken = String(codeBlockLanguage || "")
      .replace(/[^a-z0-9_-]/gi, "")
      .toLowerCase();
    const languageClass = languageToken ? ` class="language-${languageToken}"` : "";
    htmlParts.push(
      `<pre><code${languageClass}>${escapeHtml(codeBlockLines.join("\n"))}</code></pre>`
    );
    codeBlockLines = [];
    codeBlockLanguage = "";
  };

  source.split("\n").forEach((rawLine) => {
    const line = rawLine.replace(/\t/g, "  ");
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      flushList();
      if (inCodeBlock) {
        flushCodeBlock();
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeBlockLanguage = trimmed.slice(3).trim();
        codeBlockLines = [];
      }
      return;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      return;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      return;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const depth = headingMatch[1].length;
      htmlParts.push(`<h${depth}>${renderMarkdownInline(escapeHtml(headingMatch[2]))}</h${depth}>`);
      return;
    }

    const unorderedMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    if (unorderedMatch) {
      flushParagraph();
      if (listType && listType !== "ul") {
        flushList();
      }
      listType = "ul";
      listItems.push(unorderedMatch[1].trim());
      return;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      if (listType && listType !== "ol") {
        flushList();
      }
      listType = "ol";
      listItems.push(orderedMatch[1].trim());
      return;
    }

    const quoteMatch = trimmed.match(/^>\s?(.+)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      htmlParts.push(`<blockquote><p>${renderMarkdownInline(escapeHtml(quoteMatch[1]))}</p></blockquote>`);
      return;
    }

    paragraphBuffer.push(trimmed);
  });

  if (inCodeBlock) {
    flushCodeBlock();
  }
  flushParagraph();
  flushList();

  return htmlParts.join("\n");
}

function normalizeChecklistItems(rawItems) {
  if (!Array.isArray(rawItems)) {
    return [];
  }

  return rawItems
    .map((item) => {
      const title = normalizeTitleForDisplay(String(item?.title || "").trim(), "");
      if (!title) {
        return null;
      }
      const status = String(item?.status || "").trim().toLowerCase();
      const normalizedStatus =
        status === "completed" || status === "running" || status === "blocked"
          ? status
          : "todo";
      const automatable =
        typeof item?.automatable === "boolean"
          ? item.automatable
          : evaluateAgentAutomationText(title, {
              minWords: 3,
              requireScope: false,
            }).allowed;
      return {
        id: String(item?.id || uid("check")),
        title,
        done: Boolean(item?.done),
        status: Boolean(item?.done) ? "completed" : normalizedStatus,
        automatable,
        lastResultId: String(item?.lastResultId || item?.lastLogId || ""),
        lastRunAt: String(item?.lastRunAt || ""),
      };
    })
    .filter(Boolean);
}

function getChecklistForNode(node) {
  return normalizeChecklistItems(node?.metadata?.checklist);
}

function updateSpeed1Checklist(nodeId, updater, reason) {
  const node = state.graph.getNode(nodeId);
  if (!node || node.type !== NODE_TYPES.SPEED1) {
    return;
  }

  const currentChecklist = getChecklistForNode(node);
  const nextChecklist = normalizeChecklistItems(updater(currentChecklist) || []);

  state.graph.updateNode(
    nodeId,
    {
      metadata: {
        ...(node.metadata || {}),
        checklist: nextChecklist,
      },
    },
    reason
  );
}

function toTitleKey(rawTitle) {
  return normalizeTitleKey(rawTitle);
}

function findSpeed2GoalByTitle(rawTitle) {
  const target = toTitleKey(rawTitle);
  if (!target) {
    return null;
  }
  return (
    state.graph
      .getNodesByType(NODE_TYPES.SPEED2)
      .find((node) => toTitleKey(node.title) === target) || null
  );
}

function findSpeed1ActionByTitle(rawTitle, parentGoalId = "") {
  const target = toTitleKey(rawTitle);
  if (!target) {
    return null;
  }

  const speed1Nodes = state.graph.getNodesByType(NODE_TYPES.SPEED1);
  const filtered = parentGoalId
    ? speed1Nodes.filter((node) => String(node.parentId || "") === String(parentGoalId))
    : speed1Nodes;
  return filtered.find((node) => toTitleKey(node.title) === target) || null;
}

function resolveGoalParentForGraphUpdate(update, selectedNode) {
  if (update?.parentGoal) {
    const explicit = findSpeed2GoalByTitle(update.parentGoal);
    if (explicit) {
      return explicit;
    }
  }

  if (selectedNode?.type === NODE_TYPES.SPEED2) {
    return selectedNode;
  }
  if (selectedNode?.type === NODE_TYPES.SPEED1) {
    const parent = state.graph.getParent(selectedNode.id);
    if (parent?.type === NODE_TYPES.SPEED2) {
      return parent;
    }
  }

  return state.graph.getNodesByType(NODE_TYPES.SPEED2)[0] || null;
}

function resolveActionParentForGraphUpdate(update, selectedNode) {
  const goalParent = resolveGoalParentForGraphUpdate(update, selectedNode);

  if (update?.parentAction) {
    const explicit = findSpeed1ActionByTitle(update.parentAction, goalParent?.id || "");
    if (explicit) {
      return explicit;
    }
  }

  if (selectedNode?.type === NODE_TYPES.SPEED1) {
    return selectedNode;
  }
  if (selectedNode?.type === NODE_TYPES.SPEED2) {
    return (
      state.graph
        .getChildren(selectedNode.id)
        .filter((node) => node.type === NODE_TYPES.SPEED1)[0] || null
    );
  }

  const scoped = goalParent
    ? state.graph
        .getChildren(goalParent.id)
        .filter((node) => node.type === NODE_TYPES.SPEED1)
    : [];
  if (scoped.length > 0) {
    return scoped[0];
  }

  return state.graph.getNodesByType(NODE_TYPES.SPEED1)[0] || null;
}

function inferConversationGraphUpdates(message) {
  const text = String(message || "").trim();
  if (!text) {
    return [];
  }
  if (!/\b(add|create|include|insert)\b/i.test(text)) {
    return [];
  }

  const extractTitle = (regex) => {
    const match = text.match(regex);
    if (!match) {
      return "";
    }
    return String(match[1] || "")
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim();
  };

  const quoted = text.match(/["'`](.+?)["'`]/);
  const quotedTitle = quoted ? String(quoted[1] || "").trim() : "";

  const goalTitle =
    quotedTitle ||
    extractTitle(/\b(?:add|create|include|insert)\s+(?:a|an|new|another)?\s*(?:speed[-\s]?2\s+)?goal\s*(?:called|named|:|-)?\s*(.+)$/i);
  if (goalTitle && /\bgoal\b/i.test(text)) {
    return [{ op: "add_speed2_goal", title: goalTitle }];
  }

  const actionTitle =
    quotedTitle ||
    extractTitle(
      /\b(?:add|create|include|insert)\s+(?:a|an|new|another)?\s*(?:speed[-\s]?1\s+)?action(?:\s+node)?\s*(?:called|named|:|-)?\s*(.+)$/i
    );
  if (actionTitle && /\baction\b/i.test(text)) {
    return [{ op: "add_speed1_action", title: actionTitle }];
  }

  const taskTitle =
    quotedTitle ||
    extractTitle(/\b(?:add|create|include|insert)\s+(?:a|an|new|another)?\s*(?:attached\s+)?task\s*(?:called|named|:|-)?\s*(.+)$/i);
  if (taskTitle && /\btask\b/i.test(text)) {
    return [{ op: "add_attached_task", title: taskTitle }];
  }

  return [];
}

function applyConversationGraphUpdates(updates, selectedNode) {
  const candidates = Array.isArray(updates) ? updates.slice(0, 8) : [];
  if (candidates.length === 0) {
    return [];
  }

  const rootNode = state.graph.getRoot();
  if (!rootNode) {
    return [];
  }

  const appliedNotes = [];

  candidates.forEach((update) => {
    const activeSelectedNode = state.graph.getNode(state.selectedNodeId) || selectedNode;
    const op = String(update?.op || "").trim();
    const incomingTitle = String(update?.title || "").trim();
    if (!op || !incomingTitle) {
      return;
    }

    if (op === "add_speed2_goal") {
      const title = ensureSpeed2GoalTitle(
        incomingTitle,
        rootNode.title,
        state.graph.getNodesByType(NODE_TYPES.SPEED2).length + 1
      );
      const existingGoal = findSpeed2GoalByTitle(title);
      if (existingGoal) {
        return;
      }

      const createdGoal = state.graph.addNode(
        {
          type: NODE_TYPES.SPEED2,
          parentId: rootNode.id,
          title,
          description:
            String(update?.description || "").trim() || "Long-horizon goal added from conversation.",
          priorityWeight: 0.62,
          temporalHorizon: "long",
          confidenceScore: 0.56,
          emotionalValence: 0.22,
          constraints: Array.isArray(rootNode.constraints) ? rootNode.constraints : [],
        },
        `Goal added from conversation: ${title}`
      );
      state.selectedNodeId = createdGoal.id;
      appliedNotes.push(`Added goal "${createdGoal.title}"`);
      return;
    }

    if (op === "add_speed1_action") {
      const parentGoal = resolveGoalParentForGraphUpdate(update, activeSelectedNode);
      if (!parentGoal) {
        return;
      }
      const title = ensureSpeed1ActionTitle(
        incomingTitle,
        parentGoal.title,
        state.graph.getChildren(parentGoal.id).filter((node) => node.type === NODE_TYPES.SPEED1).length +
          1
      );
      const existingAction = findSpeed1ActionByTitle(title, parentGoal.id);
      if (existingAction) {
        return;
      }

      const createdAction = state.graph.addNode(
        {
          type: NODE_TYPES.SPEED1,
          parentId: parentGoal.id,
          title,
          description:
            String(update?.description || "").trim() || `Action node under "${parentGoal.title}".`,
          priorityWeight: Math.max(0.25, Number(parentGoal.priorityWeight ?? 0.6) - 0.12),
          temporalHorizon: "short",
          confidenceScore: 0.58,
          emotionalValence: 0.1,
          constraints: Array.isArray(parentGoal.constraints) ? parentGoal.constraints : [],
          executionMode: EXECUTION_MODES.HYBRID,
        },
        `Action added from conversation: ${title}`
      );
      ensureChecklistScaffoldingForGraph(state.graph);
      state.selectedNodeId = createdAction.id;
      appliedNotes.push(`Added action "${createdAction.title}"`);
      return;
    }

    if (op === "add_attached_task") {
      const targetAction = resolveActionParentForGraphUpdate(update, activeSelectedNode);
      if (!targetAction || targetAction.type !== NODE_TYPES.SPEED1) {
        return;
      }

      const existingChecklist = getChecklistForNode(targetAction);
      const title = ensureAttachedTaskTitle(incomingTitle, targetAction.title, existingChecklist.length + 1);
      const alreadyExists = existingChecklist.some((item) => toTitleKey(item.title) === toTitleKey(title));
      if (alreadyExists) {
        return;
      }

      const automatable = evaluateAgentAutomationText(title, {
        minWords: 3,
        requireScope: false,
      }).allowed;

      updateSpeed1Checklist(
        targetAction.id,
        (currentChecklist) => [
          ...currentChecklist,
          {
            id: uid("check"),
            title,
            done: false,
            status: "todo",
            automatable,
          },
        ],
        `Attached task added from conversation: ${title}`
      );
      state.selectedNodeId = targetAction.id;
      appliedNotes.push(`Added task "${title}"`);
    }
  });

  return appliedNotes;
}

function normalizeProfile(profileInput = {}) {
  const profile = {};
  for (const field of PROFILE_FIELDS) {
    const value = profileInput?.[field];
    profile[field] = typeof value === "string" ? value.trim() : "";
  }
  return profile;
}

function normalizeStoredProfile(profileInput = {}, baseName = "") {
  const base = normalizeProfile(profileInput);
  const displayName = String(profileInput?.displayName || baseName || "").trim();
  const accountName = String(profileInput?.accountName || baseName || "").trim();
  const profileSource = String(profileInput?.profileSource || "").trim();
  return {
    ...base,
    ...(displayName ? { displayName } : {}),
    ...(accountName ? { accountName } : {}),
    ...(profileSource ? { profileSource } : {}),
  };
}

function getActiveIdentityRecord() {
  if (!state.activeIdentityId) {
    return null;
  }
  return state.identityGraphs.find((entry) => entry.id === state.activeIdentityId) || null;
}

function upsertIdentityRecord(record) {
  const normalized = normalizeIdentityRecord(
    record,
    state.identityGraphs.length + 1,
    state.baseName || ""
  );
  if (!normalized) {
    return;
  }

  const index = state.identityGraphs.findIndex((entry) => entry.id === normalized.id);
  if (index >= 0) {
    state.identityGraphs[index] = normalized;
    return;
  }
  state.identityGraphs.push(normalized);
}

function buildActiveIdentitySnapshot(overrides = {}) {
  const rootNode = state.graph.getRoot();
  const existing = getActiveIdentityRecord();
  const fallbackIndex = state.identityGraphs.length + 1;
  return {
    id: overrides.id || existing?.id || state.activeIdentityId || uid("identity"),
    label:
      overrides.label ||
      existing?.label ||
      toIdentityLabel(state.profile, fallbackIndex),
    profile: normalizeStoredProfile(state.profile || {}, state.baseName || ""),
    graph: state.graph.toJSON(),
    messages: deepClone(state.messages),
    taskResults: deepClone(state.taskResults),
    summaries: deepClone(state.summaries),
    selectedNodeId: state.selectedNodeId || rootNode?.id || null,
    createdAt: overrides.createdAt || existing?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
}

function syncActiveIdentityFromWorking() {
  if (!state.activeIdentityId) {
    return;
  }
  upsertIdentityRecord(buildActiveIdentitySnapshot({ id: state.activeIdentityId }));
}

function activateIdentity(identityId) {
  const targetId = String(identityId || "");
  if (!targetId) {
    return false;
  }

  syncActiveIdentityFromWorking();
  const identity = state.identityGraphs.find((entry) => entry.id === targetId);
  if (!identity) {
    return false;
  }

  state.activeIdentityId = identity.id;
  state.profile = normalizeStoredProfile(identity.profile || {}, state.baseName || "");
  state.graph = new IntentGraphEngine(identity.graph || null);
  normalizeRootIdentityTitleForGraph(state.graph);
  ensureChecklistScaffoldingForGraph(state.graph);
  const rootNode = state.graph.getRoot();
  state.messages = Array.isArray(identity.messages) ? deepClone(identity.messages) : [];
  state.taskResults = Array.isArray(identity.taskResults)
    ? deepClone(identity.taskResults)
    : Array.isArray(identity.actionLogs)
    ? deepClone(identity.actionLogs)
    : [];
  state.summaries = Array.isArray(identity.summaries) ? deepClone(identity.summaries) : [];
  state.selectedNodeId = identity.selectedNodeId || rootNode?.id || null;
  state.onboardingCompleted = true;
  state.route = APP_ROUTES.WORKSPACE;
  state.modelBusy = false;

  scrollState.workspace.scrollTop = 0;
  scrollState.workspace.stickToBottom = true;
  scrollState.workspace.lastMessageCount = state.messages.length;
  scrollState.workspace.pendingAutoScroll = true;
  return true;
}

function createIdentityLens(lensLabel, options = {}) {
  const label = normalizeLensLabel(lensLabel);
  if (!label) {
    return false;
  }

  const existing = state.identityGraphs.find(
    (entry) => normalizeLensLabel(entry.label).toLowerCase() === label.toLowerCase()
  );
  if (existing) {
    if (options.activate !== false) {
      activateIdentity(existing.id);
    }
    return true;
  }

  const baseProfile = normalizeStoredProfile(
    state.profile || getActiveIdentityRecord()?.profile || {},
    state.baseName || state.onboarding.name || ""
  );
  if (!state.baseName) {
    state.baseName = String(baseProfile.displayName || baseProfile.accountName || "").trim();
  }
  const now = nowIso();
  const lensProfile = buildLensProfile(baseProfile, label, state.baseName || "");

  const engine = new IntentGraphEngine();
  engine.initializeFromOnboarding(lensProfile);
  const firstGoal = engine.getNodesByType(NODE_TYPES.SPEED2)[0];
  const root = engine.getRoot();
  const lensId = uid("identity");
  const record = normalizeIdentityRecord(
    {
      id: lensId,
      label,
      profile: lensProfile,
      graph: engine.toJSON(),
      selectedNodeId: firstGoal?.id || root?.id || null,
      messages: [
        {
          id: uid("msg"),
          role: "system",
          content: WORKSPACE_INITIAL_MESSAGE,
          createdAt: now,
          metadata: {},
        },
      ],
      taskResults: [],
      summaries: [],
      createdAt: now,
      updatedAt: now,
    },
    state.identityGraphs.length + 1,
    state.baseName || ""
  );

  if (!record) {
    return false;
  }
  state.identityGraphs.push(record);
  if (options.activate !== false) {
    activateIdentity(record.id);
  }
  return true;
}

function startNewIdentityOnboarding(preferredLensLabel = "") {
  syncActiveIdentityFromWorking();
  state.route = APP_ROUTES.ONBOARDING;
  state.onboardingCompleted = state.identityGraphs.length === 0 ? false : true;
  state.onboarding.stage = "chat";
  const fixedBaseName =
    state.baseName ||
    String(state.profile?.displayName || state.profile?.accountName || state.onboarding.name || "").trim();
  if (fixedBaseName) {
    state.baseName = fixedBaseName;
  }
  state.onboarding.name = state.baseName || "";
  state.onboarding.lensLabel = normalizeLensLabel(preferredLensLabel);
  state.onboarding.responses = normalizeProfile({
    ...(state.onboarding.lensLabel ? { roles: state.onboarding.lensLabel } : {}),
  });
  state.onboarding.chatMessages = [];
  state.onboarding.awaitingResponse = false;
  state.onboarding.resetting = false;
  state.onboarding.showResetConfirm = false;
  state.onboarding.sessionToken += 1;
  state.onboarding.targetIdentityId = uid("identity");
  scrollState.onboarding.scrollTop = 0;
  scrollState.onboarding.stickToBottom = true;
  scrollState.onboarding.lastMessageCount = 0;
  scrollState.onboarding.pendingAutoScroll = true;
}

function toNodeSummary(node) {
  if (!node) {
    return null;
  }
  return {
    title: node.title || "",
    type: toNodeTypeLabel(node.type),
    description: node.description || "",
    status: node.status || "",
    executionMode: node.executionMode || "",
    temporalHorizon: node.temporalHorizon || "",
  };
}

function toAgentRunNode(node) {
  if (!node) {
    return null;
  }

  return {
    id: node.id,
    type: node.type || "",
    title: node.title || "",
    description: node.description || "",
    status: node.status || "",
    executionMode: node.executionMode || "",
    priorityWeight: Number(node.priorityWeight ?? 0.5),
    confidenceScore: Number(node.confidenceScore ?? 0.5),
    conflicts: Array.isArray(node.conflicts)
      ? node.conflicts.map((entry) => ({
          nodeId: String(entry?.nodeId || ""),
          reason: String(entry?.reason || ""),
          weight: Number(entry?.weight ?? 0.2),
        }))
      : [],
  };
}

function buildWorkspaceGraphContext(selectedNode) {
  const root = state.graph.getRoot();
  const speed2Goals = state.graph
    .getNodesByType(NODE_TYPES.SPEED2)
    .slice(0, 8)
    .map((node) => node.title);

  let nearbyTasks = [];
  if (selectedNode?.type === NODE_TYPES.SPEED2) {
    nearbyTasks = state.graph
      .getChildren(selectedNode.id)
      .filter((node) => node.type === NODE_TYPES.SPEED1)
      .slice(0, 8)
      .map((node) => node.title);
  } else if (selectedNode?.type === NODE_TYPES.SPEED1) {
    const parent = state.graph.getParent(selectedNode.id);
    if (parent) {
      nearbyTasks = state.graph
        .getChildren(parent.id)
        .filter((node) => node.type === NODE_TYPES.SPEED1)
        .slice(0, 8)
        .map((node) => node.title);
    }
  }

  return {
    identity: root?.title || "",
    speed2Goals,
    nearbyTasks,
  };
}

function render() {
  captureChatScrollState();
  teardownForceGraph();
  teardownHomeForceGraphs();

  if (state.route === APP_ROUTES.ONBOARDING) {
    renderOnboarding();
    return;
  }

  if (state.identityGraphs.length === 0) {
    state.route = APP_ROUTES.ONBOARDING;
    renderOnboarding();
    return;
  }

  if (state.route === APP_ROUTES.HOME) {
    renderIdentityHome();
    return;
  }

  renderWorkspace();
}

function graphPendingActionCount(serializedGraph) {
  const nodes = Array.isArray(serializedGraph?.nodes) ? serializedGraph.nodes : [];
  return nodes.filter((node) => {
    if (node?.type !== NODE_TYPES.SPEED1) {
      return false;
    }
    const status = String(node?.status || "").trim().toLowerCase();
    return status !== "completed";
  }).length;
}

function buildLayeredRowLayout(nodes, options = {}) {
  const minX = Number(options.minX ?? 0);
  const maxX = Number(options.maxX ?? 100);
  const yStart = Number(options.yStart ?? 0);
  const rowGap = Number(options.rowGap ?? 32);
  const preferredSlot = Number(options.preferredSlot ?? 150);
  const maxCharsCap = Number(options.maxCharsCap ?? 24);
  const span = Math.max(1, maxX - minX);
  const safeNodes = Array.isArray(nodes) ? nodes : [];
  if (safeNodes.length === 0) {
    return [];
  }

  const colsPerRow = Math.max(1, Math.floor(span / Math.max(90, preferredSlot)));
  const rows = Math.max(1, Math.ceil(safeNodes.length / colsPerRow));
  const placements = [];

  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    const rowNodes = safeNodes.slice(rowIndex * colsPerRow, (rowIndex + 1) * colsPerRow);
    const slot = span / Math.max(1, rowNodes.length + 1);
    const maxChars = Math.max(10, Math.min(maxCharsCap, Math.floor(slot / 7) - 1));
    const y = yStart - rowIndex * rowGap;

    rowNodes.forEach((node, nodeIndex) => {
      placements.push({
        id: node.id,
        x: minX + slot * (nodeIndex + 1),
        y,
        label: truncate(node.title, maxChars),
      });
    });
  }

  return placements;
}

function buildHierarchicalNodeLayout(rootNode, speed2Nodes, speed1Nodes, options = {}) {
  const minX = Number(options.minX ?? 0);
  const maxX = Number(options.maxX ?? 100);
  const centerX = Number(options.centerX ?? (minX + maxX) / 2);
  const rootY = Number(options.rootY ?? 0);
  const speed2Y = Number(options.speed2Y ?? rootY - 120);
  const speed1YStart = Number(options.speed1YStart ?? speed2Y - 120);

  const positions = new Map();
  const labels = new Map();

  if (rootNode?.id) {
    positions.set(rootNode.id, { x: centerX, y: rootY });
    labels.set(rootNode.id, truncate(rootNode.title, Number(options.rootMaxCharsCap ?? 26)));
  }

  const sortedSpeed2 = [...(Array.isArray(speed2Nodes) ? speed2Nodes : [])].sort((left, right) =>
    String(left?.title || "").localeCompare(String(right?.title || ""))
  );
  const speed2Layout = buildLayeredRowLayout(sortedSpeed2, {
    minX,
    maxX,
    yStart: speed2Y,
    rowGap: Number(options.speed2RowGap ?? 44),
    preferredSlot: Number(options.speed2PreferredSlot ?? 220),
    maxCharsCap: Number(options.speed2MaxCharsCap ?? 24),
  });
  speed2Layout.forEach((entry) => {
    positions.set(entry.id, { x: entry.x, y: entry.y });
    labels.set(entry.id, entry.label);
  });

  const speed2XById = new Map(speed2Layout.map((entry) => [entry.id, entry.x]));
  const sortedSpeed1 = [...(Array.isArray(speed1Nodes) ? speed1Nodes : [])].sort((left, right) => {
    const leftParent = speed2XById.get(left?.parentId) ?? 0;
    const rightParent = speed2XById.get(right?.parentId) ?? 0;
    if (leftParent !== rightParent) {
      return leftParent - rightParent;
    }
    return String(left?.title || "").localeCompare(String(right?.title || ""));
  });
  const speed1Layout = buildLayeredRowLayout(sortedSpeed1, {
    minX,
    maxX,
    yStart: speed1YStart,
    rowGap: Number(options.speed1RowGap ?? 42),
    preferredSlot: Number(options.speed1PreferredSlot ?? 170),
    maxCharsCap: Number(options.speed1MaxCharsCap ?? 20),
  });
  speed1Layout.forEach((entry) => {
    positions.set(entry.id, { x: entry.x, y: entry.y });
    labels.set(entry.id, entry.label);
  });

  return { positions, labels };
}

function renderIdentityPreview(identity) {
  const identityId = String(identity?.id || "").trim();
  if (!identityId) {
    return `<div class="home-force-graph-host"><p class="subtle graph-loading">Graph unavailable.</p></div>`;
  }

  return `
    <div class="home-force-graph-host" data-home-graph="${escapeHtml(identityId)}">
      <p class="subtle graph-loading">Loading graph...</p>
    </div>
  `;
}

function buildHomeForceGraphData(identity) {
  const graphData = identity?.graph || {};
  const nodes = Array.isArray(graphData.nodes) ? graphData.nodes : [];
  const edges = Array.isArray(graphData.edges) ? graphData.edges : [];

  if (!nodes.length) {
    return { nodes: [], links: [] };
  }

  const root = nodes.find((node) => node.type === NODE_TYPES.ROOT) || nodes[0];
  if (!root) {
    return { nodes: [], links: [] };
  }

  const speed2Nodes = nodes.filter((node) => node.type === NODE_TYPES.SPEED2);
  const speed1Nodes = nodes.filter((node) => node.type === NODE_TYPES.SPEED1);
  const visibleSpeed1 = [...speed1Nodes];
  const visibleNodes = [root, ...speed2Nodes, ...visibleSpeed1];
  const visibleIds = new Set(visibleNodes.map((node) => String(node.id || "")).filter(Boolean));

  const layout = buildHierarchicalNodeLayout(root, speed2Nodes, visibleSpeed1, {
    minX: -150,
    maxX: 150,
    centerX: 0,
    rootY: 82,
    speed2Y: -8,
    speed1YStart: -78,
    speed2PreferredSlot: 110,
    speed1PreferredSlot: 94,
    speed2MaxCharsCap: 22,
    speed1MaxCharsCap: 18,
    rootMaxCharsCap: 22,
  });
  const positions = layout.positions;
  const labels = layout.labels;

  const links = edges
    .filter(
      (edge) =>
        visibleIds.has(String(edge?.from || "")) && visibleIds.has(String(edge?.to || ""))
    )
    .map((edge) => ({ source: edge.from, target: edge.to }));

  if (links.length === 0) {
    visibleNodes.forEach((node) => {
      if (node?.parentId && visibleIds.has(String(node.parentId || ""))) {
        links.push({ source: node.parentId, target: node.id });
      }
    });
  }

  return {
    nodes: visibleNodes.map((node) => ({
      id: node.id,
      title: node.title,
      displayTitle: labels.get(node.id) || truncate(node.title, 20),
      type: node.type,
      ...(positions.has(node.id)
        ? {
            x: positions.get(node.id).x,
            y: positions.get(node.id).y,
          }
        : {}),
    })),
    links,
  };
}

async function mountHomeForceGraphs() {
  const hosts = Array.from(document.querySelectorAll("[data-home-graph]"));
  if (!hosts.length) {
    return;
  }

  const mountToken = ++homeForceGraphRenderToken;
  teardownHomeForceGraphs();

  try {
    const forceGraphFactory = await ensureForceGraphRuntime();
    if (mountToken !== homeForceGraphRenderToken) {
      return;
    }

    const typeColor = {
      [NODE_TYPES.ROOT]: "#8fb8ff",
      [NODE_TYPES.SPEED2]: "#63d6ad",
      [NODE_TYPES.SPEED1]: "#f5c57c",
    };

    hosts.forEach((host) => {
      const identityId = String(host.dataset.homeGraph || "").trim();
      const identity = state.identityGraphs.find((entry) => String(entry.id || "") === identityId);
      if (!identity) {
        host.innerHTML = `<p class="subtle graph-loading">Graph unavailable.</p>`;
        return;
      }

      const graphData = buildHomeForceGraphData(identity);
      if (!graphData.nodes.length) {
        host.innerHTML = `<p class="subtle graph-loading">No graph data yet.</p>`;
        return;
      }

      const width = Math.max(220, Math.floor(host.clientWidth || 520));
      const height = Math.max(180, Math.floor(host.clientHeight || 280));
      host.innerHTML = "";

      let hoveredNodeId = "";
      const graph = forceGraphFactory()(host);
      graph
        .graphData(graphData)
        .width(width)
        .height(height)
        .backgroundColor("rgba(0,0,0,0)")
        .nodeRelSize(5)
        .nodeVal((node) => (node.type === NODE_TYPES.ROOT ? 1.95 : node.type === NODE_TYPES.SPEED2 ? 1.35 : 1.08))
        .nodeLabel((node) => node.title)
        .linkColor(() => "rgba(168, 196, 228, 0.34)")
        .linkWidth(1)
        .d3AlphaDecay(0.08)
        .d3VelocityDecay(0.34)
        .warmupTicks(60)
        .cooldownTicks(180)
        .onEngineStop(() => {
          if (typeof graph.zoomToFit === "function") {
            try {
              graph.zoomToFit(300, 28);
            } catch {
              // Ignore transient fit errors.
            }
          }
        })
        .onNodeHover((node) => {
          hoveredNodeId = String(node?.id || "");
          if (typeof graph?.refresh === "function") {
            graph.refresh();
          }
        })
        .nodeCanvasObject((node, ctx, globalScale) => {
          const label = String(node.displayTitle || truncate(String(node.title || ""), 20));
          const radius =
            node.type === NODE_TYPES.ROOT ? 6 : node.type === NODE_TYPES.SPEED2 ? 4.8 : 4;
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
          ctx.fillStyle = typeColor[node.type] || "#cfd7e2";
          ctx.fill();

          const shouldShowLabel = Boolean(label) && hoveredNodeId === String(node.id || "");
          if (!shouldShowLabel) {
            return;
          }

          const fontSize = Math.max(8, 10 / globalScale);
          ctx.font = `${fontSize}px "Plus Jakarta Sans", "Avenir Next", sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const textWidth = ctx.measureText(label).width;
          const labelY = node.y + radius + 11;
          const boxPaddingX = 4;
          const boxHeight = fontSize + 4;
          const boxWidth = textWidth + boxPaddingX * 2;
          const boxX = node.x - boxWidth / 2;
          const boxY = labelY - boxHeight / 2;

          ctx.fillStyle = "rgba(236, 246, 255, 0.9)";
          ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
          ctx.fillStyle = "#284564";
          ctx.fillText(label, node.x, labelY);
        });

      if (typeof graph.enableNodeDrag === "function") {
        graph.enableNodeDrag(false);
      }
      if (typeof graph.enableZoomInteraction === "function") {
        graph.enableZoomInteraction(false);
      }
      if (typeof graph.enablePanInteraction === "function") {
        graph.enablePanInteraction(false);
      }

      const linkForce = graph.d3Force("link");
      if (linkForce && typeof linkForce.distance === "function") {
        linkForce
          .distance((link) => {
            const sourceType = String(link?.source?.type || "");
            const targetType = String(link?.target?.type || "");
            if (sourceType === NODE_TYPES.ROOT || targetType === NODE_TYPES.ROOT) {
              return 84;
            }
            return 64;
          })
          .strength(0.24);
      }

      const chargeForce = graph.d3Force("charge");
      if (chargeForce && typeof chargeForce.strength === "function") {
        chargeForce.strength((node) => (node?.type === NODE_TYPES.ROOT ? -250 : -150));
      }

      const centerForce = graph.d3Force("center");
      if (centerForce && typeof centerForce.strength === "function") {
        centerForce.strength(0.12);
      }

      if (typeof graph.zoomToFit === "function") {
        try {
          graph.zoomToFit(120, 28);
        } catch {
          // Ignore transient fit errors.
        }
      }

      homeForceGraphInstances.push(graph);
    });
  } catch (error) {
    if (mountToken !== homeForceGraphRenderToken) {
      return;
    }
    hosts.forEach((host) => {
      host.innerHTML = `<p class="subtle graph-loading">Graph unavailable: ${escapeHtml(
        error instanceof Error ? error.message : String(error)
      )}</p>`;
    });
  }
}

function renderIdentityHome() {
  const baseName = state.baseName || "You";
  const galleryClass = state.identityGraphs.length === 1 ? "identity-gallery single-lens" : "identity-gallery";
  const cardsMarkup = state.identityGraphs
    .map((identity) => {
      const pendingActions = graphPendingActionCount(identity.graph);
      return `
        <article class="identity-card">
          <button class="identity-open-btn" data-open-identity="${identity.id}">
            <div class="identity-card-top">
              <h3>${escapeHtml(identity.label)}</h3>
              <span class="pill">${pendingActions} pending actions</span>
            </div>
            <div class="identity-preview">
              ${renderIdentityPreview(identity)}
            </div>
          </button>
        </article>
      `;
    })
    .join("");

  appRoot.innerHTML = `
    <div class="page identity-home-page">
      <header class="identity-home-header reveal">
        <div>
          <h1>telos</h1>
          <p>${escapeHtml(baseName)}'s identity lenses</p>
        </div>
        <div class="identity-home-actions">
          <button id="new-lens-btn" type="button">New Lens</button>
          <button id="home-reset-btn" class="danger-btn" type="button">Reset</button>
        </div>
      </header>
      <section class="${galleryClass} reveal delay-1">
        ${cardsMarkup}
      </section>
    </div>
  `;

  attachIdentityHomeHandlers();
  void mountHomeForceGraphs();
}

function renderOnboarding() {
  renderOnboardingChat();
}

function renderOnboardingChat() {
  const isProcessing = state.onboarding.stage === "processing";
  const isBusy =
    isProcessing || state.onboarding.awaitingResponse || state.onboarding.resetting;

  appRoot.innerHTML = `
    <div class="page onboarding-page">
      <div class="onboarding-chat-app">
        <header class="onboarding-chat-header">
          <div class="onboarding-header-spacer">
            ${
              state.identityGraphs.length > 0
                ? `<button id="onboarding-home-btn" type="button" class="ghost-btn">Home</button>`
                : ""
            }
          </div>
          <h1>telos</h1>
          <button id="onboarding-reset-btn" class="danger-btn onboarding-reset-btn" type="button">
            ${state.onboarding.resetting ? "Resetting..." : "Reset"}
          </button>
        </header>

        <section id="onboarding-stream" class="onboarding-stream">
          ${
            state.onboarding.chatMessages.length === 0
              ? `<article class="chat-row assistant">
                  <div class="chat-bubble assistant">
                    <p>Starting onboarding...</p>
                  </div>
                </article>`
              : state.onboarding.chatMessages
                  .map((message) => {
                    return `
                      <article class="chat-row ${escapeHtml(message.role)}">
                        <div class="chat-bubble ${escapeHtml(message.role)}">
                          <p>${escapeHtml(message.content)}</p>
                        </div>
                      </article>
                    `;
                  })
                  .join("")
          }
        </section>

        <form id="onboarding-chat-form" class="onboarding-composer">
          <div class="onboarding-composer-inner">
            <textarea
              name="message"
              rows="2"
              required
              placeholder="${isBusy ? "Thinking..." : "Message Telos"}"
              ${isBusy ? "disabled" : ""}
            ></textarea>
            <button type="submit" class="primary-btn" ${isBusy ? "disabled" : ""}>
              ${isBusy ? "Thinking..." : "Send"}
            </button>
          </div>
        </form>

        ${
          state.onboarding.showResetConfirm
            ? `
              <div class="reset-dialog-backdrop" id="reset-dialog-backdrop">
                <div class="reset-dialog" role="dialog" aria-modal="true" aria-label="Confirm reset">
                  <h3>Reset onboarding?</h3>
                  <p class="subtle">This restarts the conversation and clears saved context.</p>
                  <div class="reset-dialog-actions">
                    <button id="reset-cancel-btn" type="button">Cancel</button>
                    <button id="reset-confirm-btn" class="danger-btn" type="button">Reset</button>
                  </div>
                </div>
              </div>
            `
            : ""
        }
      </div>
    </div>
  `;

  attachTrackedScrollBehavior(
    document.getElementById("onboarding-stream"),
    scrollState.onboarding,
    state.onboarding.chatMessages.length
  );

  const onboardingResetButton = document.getElementById("onboarding-reset-btn");
  onboardingResetButton?.addEventListener("click", async () => {
    if (state.onboarding.resetting) {
      return;
    }
    state.onboarding.showResetConfirm = true;
    persistState();
    render();
  });

  const onboardingHomeButton = document.getElementById("onboarding-home-btn");
  onboardingHomeButton?.addEventListener("click", () => {
    state.route = APP_ROUTES.HOME;
    state.onboarding.awaitingResponse = false;
    state.onboarding.showResetConfirm = false;
    state.onboarding.resetting = false;
    state.showWorkspaceResetConfirm = false;
    persistState();
    render();
  });

  const resetCancelButton = document.getElementById("reset-cancel-btn");
  resetCancelButton?.addEventListener("click", () => {
    state.onboarding.showResetConfirm = false;
    persistState();
    render();
  });

  const resetDialogBackdrop = document.getElementById("reset-dialog-backdrop");
  resetDialogBackdrop?.addEventListener("click", (event) => {
    if (event.target !== resetDialogBackdrop) {
      return;
    }
    state.onboarding.showResetConfirm = false;
    persistState();
    render();
  });

  const resetConfirmButton = document.getElementById("reset-confirm-btn");
  resetConfirmButton?.addEventListener("click", async () => {
    await restartOnboardingConversation();
  });

  if (isBusy) {
    return;
  }

  const chatForm = document.getElementById("onboarding-chat-form");
  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(chatForm);
    const message = String(formData.get("message") || "").trim();
    if (!message) {
      return;
    }

    handleOnboardingUserMessage(message);
  });

  if (state.onboarding.chatMessages.length === 0) {
    void ensureOnboardingConversationStarted();
  }
}

async function restartOnboardingConversation() {
  state.onboarding.showResetConfirm = false;
  state.onboarding.resetting = true;
  state.onboarding.sessionToken += 1;
  persistState();
  render();

  let resetErrorMessage = "";
  try {
    await resetModelContext();
  } catch (error) {
    resetErrorMessage = `Could not fully clear persisted context: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }

  const targetIdentityId = String(state.onboarding.targetIdentityId || "") || uid("identity");
  state.route = APP_ROUTES.ONBOARDING;
  state.onboarding.stage = "chat";
  state.onboarding.name = state.baseName || "";
  state.onboarding.lensLabel = "";
  state.onboarding.responses = {};
  state.onboarding.chatMessages = [];
  state.onboarding.awaitingResponse = false;
  state.onboarding.resetting = false;
  state.onboarding.showResetConfirm = false;
  state.showWorkspaceResetConfirm = false;
  state.onboarding.targetIdentityId = targetIdentityId;

  if (state.identityGraphs.length === 0) {
    state.onboardingCompleted = false;
    state.profile = null;
    state.messages = [];
    state.taskResults = [];
    state.summaries = [];
    state.selectedNodeId = null;
    state.modelBusy = false;
    state.graph.reset();
  }
  if (state.identityGraphs.length > 0) {
    state.onboardingCompleted = true;
  }

  scrollState.onboarding.scrollTop = 0;
  scrollState.onboarding.stickToBottom = true;
  scrollState.onboarding.lastMessageCount = 0;
  scrollState.onboarding.pendingAutoScroll = true;

  if (resetErrorMessage) {
    addOnboardingMessage("system", resetErrorMessage);
    scrollState.onboarding.lastMessageCount = 0;
  }

  persistState();
  render();
}

async function ensureOnboardingConversationStarted() {
  if (state.onboarding.awaitingResponse || state.onboarding.chatMessages.length > 0) {
    return;
  }

  const token = state.onboarding.sessionToken;
  state.onboarding.awaitingResponse = true;
  persistState();
  render();

  try {
    const modelResult = await requestModelTurn({
      phase: "onboarding",
      init: true,
      onboarding: {
        name: state.onboarding.name || "",
        profile: normalizeProfile(state.onboarding.responses),
      },
    });

    if (token !== state.onboarding.sessionToken) {
      return;
    }

    if (modelResult?.reply) {
      addOnboardingMessage("assistant", modelResult.reply, { stage: "chat" });
    }

    if (modelResult?.onboarding?.name) {
      const suggestedName = String(modelResult.onboarding.name || "").trim();
      if (!state.baseName && suggestedName) {
        state.baseName = suggestedName;
      }
      state.onboarding.name = state.baseName || suggestedName || state.onboarding.name;
    } else if (state.baseName) {
      state.onboarding.name = state.baseName;
    }
    if (modelResult?.onboarding?.profile) {
      state.onboarding.responses = normalizeProfile(modelResult.onboarding.profile);
    }
  } catch (error) {
    if (token !== state.onboarding.sessionToken) {
      return;
    }
    addOnboardingMessage(
      "system",
      `Model unavailable: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    if (token !== state.onboarding.sessionToken) {
      return;
    }
    state.onboarding.awaitingResponse = false;
    persistState();
    render();
  }
}

async function handleOnboardingUserMessage(message) {
  addOnboardingMessage("user", message, { stage: "chat" });
  const token = state.onboarding.sessionToken;
  state.onboarding.awaitingResponse = true;
  persistState();
  render();

  let completed = false;
  try {
    const modelResult = await requestModelTurn({
      phase: "onboarding",
      message,
      onboarding: {
        name: state.onboarding.name || "",
        profile: normalizeProfile(state.onboarding.responses),
      },
    });

    if (token !== state.onboarding.sessionToken) {
      return;
    }

    if (modelResult?.reply) {
      addOnboardingMessage("assistant", modelResult.reply, { stage: "chat" });
    }
    if (modelResult?.onboarding?.name) {
      const suggestedName = String(modelResult.onboarding.name || "").trim();
      if (!state.baseName && suggestedName) {
        state.baseName = suggestedName;
      }
      state.onboarding.name = state.baseName || suggestedName || state.onboarding.name;
    } else if (state.baseName) {
      state.onboarding.name = state.baseName;
    }
    if (modelResult?.onboarding?.profile) {
      state.onboarding.responses = normalizeProfile(modelResult.onboarding.profile);
    }

    if (modelResult?.onboardingComplete) {
      completed = true;
      state.onboarding.awaitingResponse = false;
      finalizeOnboarding(normalizeProfile(state.onboarding.responses));
      return;
    }
  } catch (error) {
    if (token !== state.onboarding.sessionToken) {
      return;
    }
    addOnboardingMessage(
      "system",
      `Model unavailable: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    if (token !== state.onboarding.sessionToken) {
      return;
    }
    if (completed) {
      return;
    }
    state.onboarding.awaitingResponse = false;
    persistState();
    render();
  }
}

function finalizeOnboarding(profileFromModel) {
  const isFirstOnboarding = state.identityGraphs.length === 0;
  const normalizedProfile = normalizeProfile(profileFromModel);
  const fixedBaseName =
    state.baseName ||
    String(state.onboarding.name || "").trim() ||
    String(state.profile?.displayName || state.profile?.accountName || "").trim();
  if (fixedBaseName) {
    state.baseName = fixedBaseName;
    state.onboarding.name = fixedBaseName;
  }
  const identityId = String(state.onboarding.targetIdentityId || "").trim() || uid("identity");
  const existingIdentity = state.identityGraphs.find((entry) => entry.id === identityId);
  const explicitLensLabel = normalizeLensLabel(state.onboarding.lensLabel || "");
  const roleLensCandidates = deriveLensCandidates(normalizedProfile);
  if (roleLensCandidates.length > 0) {
    normalizedProfile.roles = roleLensCandidates.join("\n");
  }
  const roleLensLabel = roleLensCandidates[0] || "";
  const fallbackLabel = toIdentityLabel(
    {
      ...normalizedProfile,
      displayName: state.baseName || "",
      accountName: state.baseName || "",
    },
    state.identityGraphs.length + 1
  );

  state.profile = {
    ...normalizedProfile,
    displayName: state.baseName || "",
    accountName: state.baseName || "",
    profileSource: "model_conversation",
  };
  state.graph.initializeFromOnboarding(state.profile);
  normalizeRootIdentityTitleForGraph(state.graph);
  ensureChecklistScaffoldingForGraph(state.graph);
  state.onboarding.stage = "complete";
  state.onboardingCompleted = true;
  state.onboarding.targetIdentityId = "";
  state.onboarding.lensLabel = "";

  const firstGoal = state.graph.getNodesByType(NODE_TYPES.SPEED2)[0];
  state.selectedNodeId = firstGoal?.id || state.graph.getRoot()?.id || null;
  state.messages = [];
  state.taskResults = [];
  state.summaries = [];

  addMessage("system", WORKSPACE_INITIAL_MESSAGE);
  scrollState.workspace.scrollTop = 0;
  scrollState.workspace.stickToBottom = true;
  scrollState.workspace.lastMessageCount = 0;
  scrollState.workspace.pendingAutoScroll = true;
  state.route = APP_ROUTES.WORKSPACE;
  state.activeIdentityId = identityId;
  const primaryLabel =
    explicitLensLabel || existingIdentity?.label || roleLensLabel || fallbackLabel;
  upsertIdentityRecord(
    buildActiveIdentitySnapshot({
      id: identityId,
      label: primaryLabel,
      createdAt: existingIdentity?.createdAt || nowIso(),
    })
  );

  if (isFirstOnboarding) {
    const autoLensLabels = inferLensLabelsFromProfile(state.profile, primaryLabel);
    autoLensLabels.forEach((label) => {
      createIdentityLens(label, { activate: false });
    });
  }
  persistState();
  render();
}

function renderAgentDocumentDialog() {
  const viewer = state.agentDocumentViewer;
  if (!viewer?.open) {
    return "";
  }
  const deliverables = Array.isArray(viewer.deliverables) ? viewer.deliverables : [];
  const deliverablePaths = Array.isArray(viewer.deliverablePaths) ? viewer.deliverablePaths : [];
  const deliverablesFolderPath = String(viewer.deliverablesFolderPath || "").trim();
  const hasSavedPaths = deliverablePaths.length > 0 || Boolean(deliverablesFolderPath);

  return `
    <div class="artifact-dialog-backdrop" id="artifact-dialog-backdrop">
      <div class="artifact-dialog" role="dialog" aria-modal="true" aria-label="Task result document">
        <header class="artifact-dialog-header">
          <div>
            <h3>${escapeHtml(viewer.title || "Task Result")}</h3>
            <p class="subtle">Readable result from this task run.</p>
          </div>
          <button type="button" class="ghost-btn" id="artifact-close-btn">Close</button>
        </header>
        <div class="artifact-dialog-content">
          ${
            viewer.loading
              ? `<p class="subtle">Loading task result...</p>`
              : viewer.error
              ? `<p class="subtle">${escapeHtml(viewer.error)}</p>`
              : `
                ${
                  deliverables.length
                    ? `
                      <section class="artifact-deliverables">
                        <h4>Deliverables</h4>
                        <ul class="clean-list artifact-deliverables-list">
                          ${deliverables
                            .map((item) => `<li>${escapeHtml(item)}</li>`)
                            .join("")}
                        </ul>
                      </section>
                    `
                    : ""
                }
                ${
                  hasSavedPaths
                    ? `
                      <section class="artifact-deliverables artifact-saved-files">
                        <h4>Saved Files (Desktop)</h4>
                        ${
                          deliverablesFolderPath
                            ? `<p class="artifact-file-path"><strong>Folder:</strong> ${escapeHtml(
                                deliverablesFolderPath
                              )}</p>`
                            : ""
                        }
                        ${
                          deliverablePaths.length
                            ? `
                                <ul class="clean-list artifact-deliverables-list">
                                  ${deliverablePaths
                                    .map((item) => `<li>${escapeHtml(item)}</li>`)
                                    .join("")}
                                </ul>
                              `
                            : "<p class='subtle'>No file paths returned.</p>"
                        }
                      </section>
                    `
                    : ""
                }
                <article class="artifact-document">${renderMarkdownDocument(
                  viewer.content || ""
                )}</article>
              `
          }
        </div>
        <footer class="artifact-dialog-actions">
          <button
            type="button"
            id="artifact-copy-paths-btn"
            ${viewer.loading || viewer.error || !hasSavedPaths ? "disabled" : ""}
          >
            ${viewer.pathsCopied ? "Paths Copied" : "Copy File Paths"}
          </button>
          <button
            type="button"
            id="artifact-copy-deliverables-btn"
            ${viewer.loading || viewer.error || deliverables.length === 0 ? "disabled" : ""}
          >
            ${viewer.deliverablesCopied ? "Deliverables Copied" : "Copy Deliverables"}
          </button>
          <button type="button" id="artifact-copy-btn" ${
            viewer.loading || viewer.error || !viewer.content ? "disabled" : ""
          }>
            ${viewer.copied ? "Copied" : "Copy Text"}
          </button>
        </footer>
      </div>
    </div>
  `;
}

function renderWorkspace() {
  ensureChecklistScaffoldingForGraph(state.graph);
  const selectedNode = state.graph.getNode(state.selectedNodeId) || state.graph.getRoot();
  const activeIdentity = getActiveIdentityRecord();
  const baseName = state.baseName || state.profile?.displayName || "You";
  const identityOptions = state.identityGraphs
    .map((identity) => {
      return `<option value="${identity.id}" ${
        identity.id === state.activeIdentityId ? "selected" : ""
      }>${escapeHtml(identity.label)}</option>`;
    })
    .join("");

  if (selectedNode && selectedNode.id !== state.selectedNodeId) {
    state.selectedNodeId = selectedNode.id;
  }

  appRoot.innerHTML = `
    <div class="page workspace-page">
      <header class="topbar reveal">
        <div>
          <h2>${escapeHtml(baseName)} · ${escapeHtml(activeIdentity?.label || "Lens")}</h2>
        </div>
        <div class="topbar-actions">
          <button id="home-btn" type="button">Home</button>
          <label class="lens-switcher-btn" for="identity-switcher">
            <span>Lens</span>
            <span class="lens-switcher-chevron" aria-hidden="true"></span>
            <select id="identity-switcher" aria-label="Switch lens">${identityOptions}</select>
          </label>
        </div>
      </header>

      <main class="workspace-grid reveal delay-1">
        <aside class="panel task-panel">${renderTaskPanel(selectedNode)}</aside>
        <section class="panel graph-panel">${renderGraphPanel(selectedNode)}</section>
        <aside class="panel chat-panel">${renderChatPanel()}</aside>
      </main>
      ${renderAgentDocumentDialog()}
    </div>
  `;

  attachTrackedScrollBehavior(
    document.getElementById("chat-log"),
    scrollState.workspace,
    state.messages.length
  );
  attachWorkspaceHandlers();
  void mountWorkspaceForceGraph(selectedNode);
}

function renderTaskPanel(selectedNode) {
  if (!selectedNode) {
    return `<h3>Tasks</h3><p>Select a node from the graph.</p>`;
  }

  if (selectedNode.type === NODE_TYPES.ROOT) {
    const goals = state.graph.getNodesByType(NODE_TYPES.SPEED2);
    return `
      <h3>Goals</h3>
      <p class="subtle">Choose a long-horizon direction to focus your execution plan.</p>
      <ul class="clean-list task-list speed2-goal-list">
        ${goals
          .map((goal) => {
            return `
              <li class="task-row goal-row">
                <button type="button" data-node-select="${goal.id}" class="goal-select-btn">
                  <span class="goal-select-text">${escapeHtml(goal.title)}</span>
                  <span class="goal-select-meta">View actions</span>
                </button>
              </li>
            `;
          })
          .join("")}
      </ul>
    `;
  }

  if (selectedNode.type === NODE_TYPES.SPEED2) {
    const speed1Nodes = state.graph
      .getChildren(selectedNode.id)
      .filter((node) => node.type === NODE_TYPES.SPEED1);
    const completedActionCount = speed1Nodes.filter((node) => node.status === "completed").length;
    const hasActions = speed1Nodes.length > 0;
    const allActionsCompleted = hasActions && completedActionCount === speed1Nodes.length;
    const goalAlreadyCompleted = selectedNode.status === "completed";
    const canMarkGoalDone = allActionsCompleted && !goalAlreadyCompleted;
    const goalDoneButtonLabel = goalAlreadyCompleted ? "Goal Completed" : "Mark Goal Done";
    const goalProgressLabel = hasActions
      ? `${completedActionCount}/${speed1Nodes.length} Actions completed`
      : "No Actions added yet";
    const goalCompletionHint = goalAlreadyCompleted
      ? "This Goal is already complete."
      : allActionsCompleted
      ? "All Actions are complete. You can now mark this Goal done."
      : "Complete every Action before marking this Goal as done.";

    return `
      <h3>${escapeHtml(selectedNode.title)}</h3>
      <p class="subtle">Strategic layer only. Choose an Action to execute concrete work.</p>
      <div class="detail-grid">
        <div>
          <p class="label">Status</p>
          <p>${escapeHtml(selectedNode.status || "todo")}</p>
        </div>
        <div>
          <p class="label">Progress</p>
          <p>${escapeHtml(goalProgressLabel)}</p>
        </div>
      </div>
      <div class="task-actions">
        <button data-goal-done="${selectedNode.id}" ${canMarkGoalDone ? "" : "disabled"}>
          ${escapeHtml(goalDoneButtonLabel)}
        </button>
      </div>
      <p class="subtle">${escapeHtml(goalCompletionHint)}</p>
      <ul class="clean-list speed1-quick-list">
        ${
          speed1Nodes.length === 0
            ? "<li><p class='subtle'>No Actions yet for this Goal.</p></li>"
            : speed1Nodes
                .map((node) => {
                  const statusLabel = node.status === "completed" ? "Done" : "Active";
                  const statusClass = node.status === "completed" ? "is-done" : "is-active";
                  return `
                    <li>
                      <button type="button" data-node-select="${node.id}" class="speed1-select-btn">
                        <span>${escapeHtml(node.title)}</span>
                        <span class="status-chip ${statusClass}">${escapeHtml(statusLabel)}</span>
                      </button>
                    </li>
                  `;
                })
                .join("")
        }
      </ul>
      <p class="subtle">
        Select an Action in the graph to execute, manage attached Tasks, and track outcomes.
      </p>
    `;
  }

  if (selectedNode.type === NODE_TYPES.SPEED1) {
    const parent = state.graph.getParent(selectedNode.id);
    const results = state.taskResults.filter((entry) => entry.taskId === selectedNode.id);
    const checklist = getChecklistForNode(selectedNode);

    return `
      <h3>${escapeHtml(selectedNode.title)}</h3>
      <p class="subtle">Parent goal: ${escapeHtml(parent?.title || "None")}</p>

      <div class="detail-grid">
        <div>
          <p class="label">Execution Mode</p>
          <p>${escapeHtml(selectedNode.executionMode || EXECUTION_MODES.HYBRID)}</p>
        </div>
        <div>
          <p class="label">Status</p>
          <p>${escapeHtml(selectedNode.status)}</p>
        </div>
      </div>

      <div class="task-actions">
        <button data-task-done="${selectedNode.id}">Mark Done</button>
        ${
          parent
            ? `<button data-node-select="${parent.id}" class="ghost-btn">Back to Goal</button>`
            : ""
        }
      </div>
      <p class="subtle">
        Agent automation is task-level. Run specific attached tasks so the assistant handles routine execution.
      </p>

      <section class="checklist-section">
        <h4>Attached Tasks</h4>
        ${
          checklist.length === 0
            ? "<p class='subtle checklist-empty'>No attached tasks yet. Add one clear, specific step.</p>"
            : `
                <ul class="clean-list checklist-list">
                  ${checklist
                    .map((item) => {
                      const taskAutomation = evaluateAttachedTaskExecutability(selectedNode, item);
                      const runButton = taskAutomation.allowed
                        ? `<button type="button" data-check-run="${selectedNode.id}|${item.id}">Run</button>`
                        : "";
                      return `
                        <li class="checklist-row">
                          <label>
                            <input
                              type="checkbox"
                              data-check-toggle="${selectedNode.id}|${item.id}"
                              ${item.done ? "checked" : ""}
                            />
                            <span>${escapeHtml(item.title)}</span>
                            ${
                              taskAutomation.allowed
                                ? ""
                                : `<span class="subtle checklist-hint">${escapeHtml(
                                    taskAutomation.reason
                                  )}</span>`
                            }
                          </label>
                          <div class="checklist-actions">
                            ${runButton}
                            <button type="button" class="ghost-btn" data-check-remove="${
                              selectedNode.id
                            }|${item.id}">
                              Remove
                            </button>
                          </div>
                        </li>
                      `;
                    })
                    .join("")}
                </ul>
              `
        }
        <form id="checklist-form" data-checklist-node="${selectedNode.id}" class="inline-form checklist-form">
          <input
            type="text"
            name="title"
            class="checklist-input"
            required
            placeholder="Add attached task"
          />
          <button type="submit" class="primary-btn checklist-add-btn">Add</button>
        </form>
      </section>

      <section class="log-section">
        <h4>Results</h4>
        ${
          results.length === 0
            ? "<p class='subtle'>No results yet.</p>"
            : results
                .map((entry) => {
                  const deliverables = Array.isArray(entry.outputs)
                    ? entry.outputs.map((item) => String(item || "").trim()).filter(Boolean)
                    : [];
                  const previewDeliverables = deliverables.slice(0, 2);
                  const deliverablePaths = Array.isArray(entry.deliverablePaths)
                    ? entry.deliverablePaths.map((item) => String(item || "").trim()).filter(Boolean)
                    : [];
                  const hasSavedPaths = Boolean(String(entry.artifactPath || "").trim()) || deliverablePaths.length > 0;
                  return `
                    <article class="log-card">
                      <p class="label">${escapeHtml(entry.status || "unknown")}</p>
                      <p class="log-summary">${escapeHtml(
                        summarizeExecutionLog(entry.actionSummary || "Execution completed.")
                      )}</p>
                      ${
                        previewDeliverables.length > 0
                          ? `
                            <div class="result-deliverables">
                              <p class="label">Deliverables</p>
                              <ul class="clean-list result-deliverables-list">
                                ${previewDeliverables
                                  .map((item) => `<li>${escapeHtml(item)}</li>`)
                                  .join("")}
                              </ul>
                            </div>
                          `
                          : ""
                      }
                      ${
                        hasSavedPaths
                          ? `<p class="subtle">Saved in Desktop/Telos Deliverables</p>`
                          : ""
                      }
                      <div class="log-card-actions">
                        <button
                          type="button"
                          class="ghost-btn"
                          data-result-view="${String(entry.id || "")}"
                          ${entry.id ? "" : "disabled"}
                        >
                          Open Result
                        </button>
                        <button
                          type="button"
                          class="ghost-btn"
                          data-result-copy-deliverables="${String(entry.id || "")}"
                          ${deliverables.length > 0 ? "" : "disabled"}
                        >
                          Copy Deliverables
                        </button>
                        <button
                          type="button"
                          class="ghost-btn"
                          data-result-copy-paths="${String(entry.id || "")}"
                          ${hasSavedPaths ? "" : "disabled"}
                        >
                          Copy File Paths
                        </button>
                      </div>
                    </article>
                  `;
                })
                .join("")
        }
      </section>
    `;
  }

  return `<h3>Tasks</h3><p>Unsupported node type.</p>`;
}

function teardownForceGraph() {
  hoveredGraphNodeId = "";
  if (forceGraphInstance) {
    if (typeof forceGraphInstance._destructor === "function") {
      forceGraphInstance._destructor();
    } else if (typeof forceGraphInstance.pauseAnimation === "function") {
      forceGraphInstance.pauseAnimation();
    }
    forceGraphInstance = null;
  }
}

function teardownHomeForceGraphs() {
  if (!homeForceGraphInstances.length) {
    return;
  }

  homeForceGraphInstances.forEach((instance) => {
    if (!instance) {
      return;
    }
    if (typeof instance._destructor === "function") {
      instance._destructor();
    } else if (typeof instance.pauseAnimation === "function") {
      instance.pauseAnimation();
    }
  });
  homeForceGraphInstances = [];
}

async function ensureForceGraphRuntime() {
  if (!forceGraphRuntimePromise) {
    forceGraphRuntimePromise = import("https://esm.sh/force-graph@1.49.2")
      .then((forceGraphModule) => forceGraphModule.default || forceGraphModule)
      .catch((error) => {
        forceGraphRuntimePromise = null;
        throw error;
      });
  }
  return forceGraphRuntimePromise;
}

function buildVisibleSpeed1Nodes(speed1Nodes, speed2Nodes, maxNodes = 36) {
  const limit = Math.max(1, Number(maxNodes || 36));
  if (!Array.isArray(speed1Nodes) || speed1Nodes.length === 0) {
    return [];
  }

  const grouped = new Map();
  speed1Nodes.forEach((node) => {
    const parentId = String(node?.parentId || "");
    if (!parentId) {
      return;
    }
    if (!grouped.has(parentId)) {
      grouped.set(parentId, []);
    }
    grouped.get(parentId).push(node);
  });
  grouped.forEach((nodes) => {
    nodes.sort((left, right) => String(left?.title || "").localeCompare(String(right?.title || "")));
  });

  const speed2Order = [...(Array.isArray(speed2Nodes) ? speed2Nodes : [])]
    .sort((left, right) => String(left?.title || "").localeCompare(String(right?.title || "")))
    .map((node) => String(node.id || ""))
    .filter(Boolean);
  const parentOrder = speed2Order.filter((parentId) => grouped.has(parentId));
  if (parentOrder.length === 0) {
    parentOrder.push(...Array.from(grouped.keys()));
  }

  const selected = [];
  while (selected.length < limit) {
    let addedThisPass = false;
    for (const parentId of parentOrder) {
      const queue = grouped.get(parentId);
      if (!queue || queue.length === 0) {
        continue;
      }
      selected.push(queue.shift());
      addedThisPass = true;
      if (selected.length >= limit) {
        break;
      }
    }
    if (!addedThisPass) {
      break;
    }
  }

  return selected;
}

function buildForceGraphData(selectedNode) {
  const root = state.graph.getRoot();
  const speed2 = state.graph.getNodesByType(NODE_TYPES.SPEED2);
  const speed1 = state.graph.getNodesByType(NODE_TYPES.SPEED1);
  if (!root) {
    return { nodes: [], links: [] };
  }

  const visibleNodes = [root, ...speed2];
  const visibleSpeed1 = buildVisibleSpeed1Nodes(speed1, speed2, 36);
  visibleNodes.push(...visibleSpeed1);

  const visibleSpeed2 = visibleNodes.filter((node) => node.type === NODE_TYPES.SPEED2);
  const layout = buildHierarchicalNodeLayout(root, visibleSpeed2, visibleSpeed1, {
    minX: -320,
    maxX: 320,
    centerX: 0,
    rootY: 220,
    speed2Y: 42,
    speed1YStart: -132,
    speed2PreferredSlot: 190,
    speed1PreferredSlot: 160,
    speed2MaxCharsCap: 28,
    speed1MaxCharsCap: 24,
    rootMaxCharsCap: 30,
  });
  const initialPositions = layout.positions;
  const labels = layout.labels;

  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const links = visibleNodes
    .filter((node) => node.parentId && visibleIds.has(node.parentId))
    .map((node) => ({ source: node.parentId, target: node.id }));

  return {
    nodes: visibleNodes.map((node) => ({
      id: node.id,
      title: node.title,
      displayTitle: labels.get(node.id) || truncate(node.title, 22),
      type: node.type,
      selected: node.id === state.selectedNodeId,
      ...(initialPositions.has(node.id)
        ? {
            x: initialPositions.get(node.id).x,
            y: initialPositions.get(node.id).y,
          }
        : {}),
    })),
    links,
  };
}

async function mountWorkspaceForceGraph(selectedNode) {
  const host = document.getElementById("force-graph-host");
  if (!host) {
    return;
  }

  const mountToken = ++forceGraphRenderToken;
  teardownForceGraph();
  host.innerHTML = `<p class="subtle graph-loading">Loading graph...</p>`;

  try {
    const forceGraphFactory = await ensureForceGraphRuntime();
    if (mountToken !== forceGraphRenderToken) {
      return;
    }

    const graphData = buildForceGraphData(selectedNode);
    const width = Math.max(360, Math.floor(host.clientWidth || 900));
    const height = Math.max(420, Math.floor(host.clientHeight || 540));
    const typeColor = {
      [NODE_TYPES.ROOT]: "#8fb8ff",
      [NODE_TYPES.SPEED2]: "#63d6ad",
      [NODE_TYPES.SPEED1]: "#f5c57c",
    };
    host.innerHTML = "";
    forceGraphInstance = forceGraphFactory()(host);
    forceGraphInstance
      .graphData(graphData)
      .width(width)
      .height(height)
      .backgroundColor("rgba(0,0,0,0)")
      .nodeRelSize(6)
      .nodeVal((node) => (node.type === NODE_TYPES.ROOT ? 2.5 : node.type === NODE_TYPES.SPEED2 ? 1.6 : 1.2))
      .nodeLabel((node) => node.title)
      .linkColor(() => "rgba(168, 196, 228, 0.40)")
      .linkWidth(1.25)
      .d3AlphaDecay(0.08)
      .d3VelocityDecay(0.34)
      .warmupTicks(60)
      .cooldownTicks(180)
      .onNodeHover((node) => {
        hoveredGraphNodeId = String(node?.id || "");
        if (typeof forceGraphInstance?.refresh === "function") {
          forceGraphInstance.refresh();
        }
      })
      .onNodeClick((node) => {
        if (!node?.id) {
          return;
        }
        state.selectedNodeId = String(node.id);
        persistState();
        render();
      })
      .onNodeDrag(() => {
        if (typeof forceGraphInstance?.d3ReheatSimulation === "function") {
          forceGraphInstance.d3ReheatSimulation();
        }
      })
      .onNodeDragEnd((node) => {
        if (!node) {
          return;
        }
        node.fx = undefined;
        node.fy = undefined;
        if (typeof forceGraphInstance?.d3ReheatSimulation === "function") {
          forceGraphInstance.d3ReheatSimulation();
        }
      })
      .nodeCanvasObject((node, ctx, globalScale) => {
        const label = String(node.displayTitle || truncate(String(node.title || ""), 22));
        const fontSize = Math.max(9, 12 / globalScale);
        const radius = node.type === NODE_TYPES.ROOT ? 8 : node.type === NODE_TYPES.SPEED2 ? 6 : 5;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
        ctx.fillStyle = typeColor[node.type] || "#cfd7e2";
        ctx.fill();
        if (node.selected) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#7aaeff";
          ctx.stroke();
        }

        const shouldShowLabel = Boolean(label);
        const showOnHoverOnly = hoveredGraphNodeId === String(node.id || "");
        if (!shouldShowLabel || !showOnHoverOnly) {
          return;
        }

        ctx.font = `${fontSize}px "Plus Jakarta Sans", "Avenir Next", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const textWidth = ctx.measureText(label).width;
        const labelY = node.y + radius + 12;
        const boxPaddingX = 4;
        const boxHeight = fontSize + 4;
        const boxWidth = textWidth + boxPaddingX * 2;
        const boxX = node.x - boxWidth / 2;
        const boxY = labelY - boxHeight / 2;

        ctx.fillStyle = "rgba(236, 246, 255, 0.92)";
        ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
        ctx.fillStyle = hoveredGraphNodeId === node.id || node.selected ? "#1c3653" : "#284564";
        ctx.fillText(label, node.x, labelY);
      });

    const linkForce = forceGraphInstance.d3Force("link");
    if (linkForce && typeof linkForce.distance === "function") {
      linkForce
        .distance((link) => {
          const sourceType = String(link?.source?.type || "");
          const targetType = String(link?.target?.type || "");
          if (sourceType === NODE_TYPES.ROOT || targetType === NODE_TYPES.ROOT) {
            return 150;
          }
          return 110;
        })
        .strength(0.22);
    }

    const chargeForce = forceGraphInstance.d3Force("charge");
    if (chargeForce && typeof chargeForce.strength === "function") {
      chargeForce.strength((node) => (node?.type === NODE_TYPES.ROOT ? -420 : -250));
    }

    const centerForce = forceGraphInstance.d3Force("center");
    if (centerForce && typeof centerForce.strength === "function") {
      centerForce.strength(0.08);
    }
    if (typeof forceGraphInstance.zoomToFit === "function") {
      try {
        forceGraphInstance.zoomToFit(240, 42);
      } catch {
        // Ignore transient zoom errors during remounts.
      }
    }
  } catch (error) {
    if (mountToken !== forceGraphRenderToken) {
      return;
    }
    host.innerHTML = `<p class="subtle graph-loading">Graph view unavailable: ${escapeHtml(
      error instanceof Error ? error.message : String(error)
    )}</p>`;
  }
}

function renderGraphPanel(selectedNode) {
  return `
    <h3>Intent Graph</h3>
    <p class="subtle">
      Connect long-horizon goals to near-term action. Select a node to focus the assistant.
    </p>
    <div class="graph-wrapper force-graph-wrapper">
      <div id="force-graph-host" class="force-graph-host">
        <p class="subtle graph-loading">Loading graph...</p>
      </div>
    </div>

    <section class="inspector">
      <h4>Selected Node</h4>
      ${
        selectedNode
          ? `
            <p><strong>${escapeHtml(selectedNode.title)}</strong> (${escapeHtml(
              toNodeTypeLabel(selectedNode.type)
            )})</p>
            <p class="subtle">${escapeHtml(selectedNode.description || "No description")}</p>
          `
          : "<p class='subtle'>No node selected.</p>"
      }
    </section>
  `;
}

function renderChatPanel() {
  const isBusy = state.modelBusy;
  return `
    <h3>Conversation</h3>
    <p class="subtle">Talk to Telos to prioritize, unblock work, and shape your next actions.</p>
    <div class="chat-log" id="chat-log">
      ${
        state.messages.length === 0
          ? `<article class="chat-bubble system">
              <p>${escapeHtml(WORKSPACE_INITIAL_MESSAGE)}</p>
            </article>`
          : state.messages
              .map((message) => {
                return `
                  <article class="chat-bubble ${escapeHtml(message.role)}">
                    <p>${escapeHtml(message.content)}</p>
                  </article>
                `;
              })
              .join("")
      }
    </div>

    <form id="chat-form" class="chat-input">
      <textarea
        name="message"
        rows="3"
        required
        placeholder="${isBusy ? "Thinking..." : "Refine intent, add constraints, or adjust priorities"}"
        ${isBusy ? "disabled" : ""}
      ></textarea>
      <button type="submit" class="primary-btn" ${isBusy ? "disabled" : ""}>
        ${isBusy ? "Thinking..." : "Send"}
      </button>
    </form>
  `;
}

function attachIdentityHomeHandlers() {
  document.querySelectorAll("[data-open-identity]").forEach((button) => {
    button.addEventListener("click", () => {
      const identityId = String(button.dataset.openIdentity || "");
      if (!identityId) {
        return;
      }
      activateIdentity(identityId);
      persistState();
      render();
    });
  });

  const newLensButton = document.getElementById("new-lens-btn");
  newLensButton?.addEventListener("click", () => {
    startNewIdentityOnboarding();
    persistState();
    render();
  });

  const homeResetButton = document.getElementById("home-reset-btn");
  homeResetButton?.addEventListener("click", async () => {
    const confirmed = window.confirm("Reset all Telos data and restart onboarding?");
    if (!confirmed) {
      return;
    }
    await performGlobalResetAndReload();
  });
}

function attachWorkspaceHandlers() {
  const homeButton = document.getElementById("home-btn");
  homeButton?.addEventListener("click", () => {
    state.route = APP_ROUTES.HOME;
    state.showWorkspaceResetConfirm = false;
    persistState();
    render();
  });

  const identitySwitcher = document.getElementById("identity-switcher");
  identitySwitcher?.addEventListener("change", () => {
    const selectedIdentityId = String(identitySwitcher.value || "");
    if (!selectedIdentityId || selectedIdentityId === state.activeIdentityId) {
      return;
    }
    activateIdentity(selectedIdentityId);
    persistState();
    render();
  });

  document.querySelectorAll("[data-node-id]").forEach((element) => {
    element.addEventListener("click", () => {
      state.selectedNodeId = element.dataset.nodeId;
      persistState();
      render();
    });
  });

  document.querySelectorAll("[data-node-select]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedNodeId = button.dataset.nodeSelect;
      persistState();
      render();
    });
  });

  document.querySelectorAll("[data-task-run]").forEach((button) => {
    button.addEventListener("click", () => {
      void runAgentTask(button.dataset.taskRun);
    });
  });

  document.querySelectorAll("[data-goal-done]").forEach((button) => {
    button.addEventListener("click", () => {
      const goalId = String(button.dataset.goalDone || "").trim();
      if (!goalId) {
        return;
      }
      const goalNode = state.graph.getNode(goalId);
      if (!goalNode || goalNode.type !== NODE_TYPES.SPEED2) {
        return;
      }

      const goalActions = state.graph
        .getChildren(goalId)
        .filter((node) => node.type === NODE_TYPES.SPEED1);
      if (goalActions.length === 0) {
        addMessage("system", `Cannot complete "${goalNode.title}" yet: add at least one Action.`);
        persistState();
        render();
        return;
      }

      const incompleteActions = goalActions.filter((node) => node.status !== "completed");
      if (incompleteActions.length > 0) {
        addMessage(
          "system",
          `Cannot complete "${goalNode.title}" yet: ${incompleteActions.length} Action(s) still active.`
        );
        persistState();
        render();
        return;
      }

      if (goalNode.status === "completed") {
        addMessage("system", `Goal already completed: ${goalNode.title}.`);
        persistState();
        render();
        return;
      }

      state.graph.updateNode(
        goalId,
        {
          status: "completed",
          confidenceScore: Math.min(Number(goalNode.confidenceScore || 0.5) + 0.05, 1),
        },
        `Goal marked done by user: ${goalNode.title}`
      );
      addMessage("system", `Goal marked completed: ${goalNode.title}.`);
      persistState();
      render();
    });
  });

  document.querySelectorAll("[data-task-done]").forEach((button) => {
    button.addEventListener("click", () => {
      const taskId = button.dataset.taskDone;
      const taskNode = state.graph.getNode(taskId);
      if (!taskNode) {
        return;
      }

      state.graph.updateNode(
        taskId,
        { status: "completed", confidenceScore: Math.min(taskNode.confidenceScore + 0.05, 1) },
        `Task marked done by user: ${taskNode.title}`
      );
      addMessage("system", `Task marked completed: ${taskNode.title}.`);
      persistState();
      render();
    });
  });

  document.querySelectorAll("[data-result-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const resultId = String(button.dataset.resultView || "").trim();
      if (!resultId) {
        return;
      }
      const selectedNode = state.graph.getNode(state.selectedNodeId);
      void openAgentDocumentViewer(resultId, selectedNode?.title || "Task Result");
    });
  });

  const artifactCloseButton = document.getElementById("artifact-close-btn");
  artifactCloseButton?.addEventListener("click", () => {
    closeAgentDocumentViewer();
    render();
  });

  const artifactBackdrop = document.getElementById("artifact-dialog-backdrop");
  artifactBackdrop?.addEventListener("click", (event) => {
    if (event.target !== artifactBackdrop) {
      return;
    }
    closeAgentDocumentViewer();
    render();
  });

  const artifactCopyButton = document.getElementById("artifact-copy-btn");
  artifactCopyButton?.addEventListener("click", async () => {
    const content = String(state.agentDocumentViewer?.content || "");
    if (!content) {
      return;
    }
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
        state.agentDocumentViewer = {
          ...state.agentDocumentViewer,
          copied: true,
        };
        render();
      }
    } catch {
      // Ignore clipboard failures in restricted environments.
    }
  });

  const artifactCopyDeliverablesButton = document.getElementById("artifact-copy-deliverables-btn");
  artifactCopyDeliverablesButton?.addEventListener("click", async () => {
    const deliverables = Array.isArray(state.agentDocumentViewer?.deliverables)
      ? state.agentDocumentViewer.deliverables.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [];
    if (!deliverables.length) {
      return;
    }

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(deliverables.map((item) => `- ${item}`).join("\n"));
        state.agentDocumentViewer = {
          ...state.agentDocumentViewer,
          deliverablesCopied: true,
        };
        render();
      }
    } catch {
      // Ignore clipboard failures in restricted environments.
    }
  });

  const artifactCopyPathsButton = document.getElementById("artifact-copy-paths-btn");
  artifactCopyPathsButton?.addEventListener("click", async () => {
    const deliverablePaths = Array.isArray(state.agentDocumentViewer?.deliverablePaths)
      ? state.agentDocumentViewer.deliverablePaths.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [];
    const folderPath = String(state.agentDocumentViewer?.deliverablesFolderPath || "").trim();
    const lines = [];
    if (folderPath) {
      lines.push(`Folder: ${folderPath}`);
    }
    if (deliverablePaths.length > 0) {
      lines.push(...deliverablePaths);
    }
    if (lines.length === 0) {
      return;
    }

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(lines.join("\n"));
        state.agentDocumentViewer = {
          ...state.agentDocumentViewer,
          pathsCopied: true,
        };
        render();
      }
    } catch {
      // Ignore clipboard failures in restricted environments.
    }
  });

  document.querySelectorAll("[data-result-copy-deliverables]").forEach((button) => {
    button.addEventListener("click", async () => {
      const resultId = String(button.dataset.resultCopyDeliverables || "").trim();
      if (!resultId) {
        return;
      }
      const entry = state.taskResults.find((result) => String(result?.id || "") === resultId);
      const deliverables = Array.isArray(entry?.outputs)
        ? entry.outputs.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      if (!deliverables.length) {
        return;
      }

      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(deliverables.map((item) => `- ${item}`).join("\n"));
          const originalText = button.textContent;
          button.textContent = "Copied";
          window.setTimeout(() => {
            button.textContent = originalText || "Copy Deliverables";
          }, 1200);
        }
      } catch {
        // Ignore clipboard failures in restricted environments.
      }
    });
  });

  document.querySelectorAll("[data-result-copy-paths]").forEach((button) => {
    button.addEventListener("click", async () => {
      const resultId = String(button.dataset.resultCopyPaths || "").trim();
      if (!resultId) {
        return;
      }
      const entry = state.taskResults.find((result) => String(result?.id || "") === resultId);
      const deliverablePaths = Array.isArray(entry?.deliverablePaths)
        ? entry.deliverablePaths.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      const folderPath = String(entry?.artifactPath || "").trim();
      const lines = [];
      if (folderPath) {
        lines.push(`Folder: ${folderPath}`);
      }
      if (deliverablePaths.length > 0) {
        lines.push(...deliverablePaths);
      }
      if (lines.length === 0) {
        return;
      }

      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(lines.join("\n"));
          const originalText = button.textContent;
          button.textContent = "Copied";
          window.setTimeout(() => {
            button.textContent = originalText || "Copy File Paths";
          }, 1200);
        }
      } catch {
        // Ignore clipboard failures in restricted environments.
      }
    });
  });

  const chatForm = document.getElementById("chat-form");
  if (chatForm) {
    chatForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(chatForm);
      const message = String(formData.get("message") || "").trim();
      if (!message) {
        return;
      }
      await handleWorkspaceUserMessage(message);
    });
  }

  const checklistForm = document.getElementById("checklist-form");
  checklistForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const nodeId = String(checklistForm.dataset.checklistNode || "");
    if (!nodeId) {
      return;
    }

    const formData = new FormData(checklistForm);
    const title = String(formData.get("title") || "").trim();
    if (!title) {
      return;
    }

    updateSpeed1Checklist(
      nodeId,
      (currentChecklist) => [
        ...currentChecklist,
        {
          id: uid("check"),
          title,
          done: false,
          status: "todo",
          automatable: evaluateAgentAutomationText(title, {
            minWords: 3,
            requireScope: false,
          }).allowed,
        },
      ],
      `Attached task created for ${state.graph.getNode(nodeId)?.title || nodeId}: ${title}`
    );
    persistState();
    render();
  });

  document.querySelectorAll("[data-check-run]").forEach((button) => {
    button.addEventListener("click", () => {
      const [nodeId, itemId] = String(button.dataset.checkRun || "").split("|");
      if (!nodeId || !itemId) {
        return;
      }
      void runAgentTask(nodeId, false, itemId);
    });
  });

  document.querySelectorAll("[data-check-toggle]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const [nodeId, itemId] = String(checkbox.dataset.checkToggle || "").split("|");
      if (!nodeId || !itemId) {
        return;
      }

      updateSpeed1Checklist(
        nodeId,
        (currentChecklist) =>
          currentChecklist.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  done: Boolean(checkbox.checked),
                  status: Boolean(checkbox.checked) ? "completed" : "todo",
                }
              : item
          ),
        `Attached task state updated for ${state.graph.getNode(nodeId)?.title || nodeId}`
      );
      persistState();
      render();
    });
  });

  document.querySelectorAll("[data-check-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      const [nodeId, itemId] = String(button.dataset.checkRemove || "").split("|");
      if (!nodeId || !itemId) {
        return;
      }

      updateSpeed1Checklist(
        nodeId,
        (currentChecklist) => currentChecklist.filter((item) => item.id !== itemId),
        `Attached task removed from ${state.graph.getNode(nodeId)?.title || nodeId}`
      );
      persistState();
      render();
    });
  });
}

async function handleWorkspaceUserMessage(message) {
  addMessage("user", message);
  state.modelBusy = true;
  persistState();
  render();

  try {
    const selectedNode = state.graph.getNode(state.selectedNodeId);
    const modelResult = await requestModelTurn({
      phase: "workspace",
      message,
      profile: normalizeProfile(state.profile || {}),
      selectedNode: toNodeSummary(selectedNode),
      graphContext: buildWorkspaceGraphContext(selectedNode),
    });

    addMessage(
      "assistant",
      String(modelResult?.reply || "I need a little more detail to help with this decision.")
    );

    const modelGraphUpdates = Array.isArray(modelResult?.graphUpdates)
      ? modelResult.graphUpdates
      : [];
    const fallbackGraphUpdates =
      modelGraphUpdates.length === 0 ? inferConversationGraphUpdates(message) : [];
    const updatesToApply = modelGraphUpdates.length > 0 ? modelGraphUpdates : fallbackGraphUpdates;
    if (updatesToApply.length > 0) {
      const refreshedSelectedNode = state.graph.getNode(state.selectedNodeId);
      const applied = applyConversationGraphUpdates(updatesToApply, refreshedSelectedNode);
      if (applied.length > 0) {
        addMessage("system", `Graph updated: ${applied.join(" | ")}`);
      }
    }
  } catch (error) {
    addMessage(
      "system",
      `Model unavailable: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    state.modelBusy = false;
    persistState();
    render();
  }
}

async function runAgentTask(taskId, approvalToken = false, checklistItemId = "") {
  if (!taskId) {
    return;
  }

  const taskNode = state.graph.getNode(taskId);
  if (!taskNode) {
    addMessage("system", `Task not found: ${taskId}`);
    persistState();
    render();
    return;
  }

  const checklistItems = getChecklistForNode(taskNode);
  const targetChecklistItem = checklistItemId
    ? checklistItems.find((item) => item.id === checklistItemId)
    : null;
  if (checklistItemId && !targetChecklistItem) {
    addMessage("system", `Attached task not found for "${taskNode.title || taskId}".`);
    persistState();
    render();
    return;
  }

  const agentEligibility = targetChecklistItem
    ? evaluateAttachedTaskExecutability(taskNode, targetChecklistItem)
    : evaluateAgentExecutability(taskNode);
  if (!agentEligibility.allowed) {
    const blockedSubject = targetChecklistItem?.title || taskNode.title || taskId;
    addMessage(
      "system",
      `Agent run unavailable for "${blockedSubject}": ${agentEligibility.reason}`
    );
    persistState();
    render();
    return;
  }

  const parentNode = state.graph.getParent(taskId);
  state.modelBusy = true;
  persistState();
  render();

  try {
    const result = await requestAgentRun({
      taskId,
      task: toAgentRunNode(taskNode),
      parentTask: toAgentRunNode(parentNode),
      profile: normalizeProfile(state.profile || {}),
      approvalToken,
      requestedAction: targetChecklistItem?.title || "",
    });

    if (result.status === "needs_approval") {
      const approved = window.confirm(
        "This task may involve irreversible actions. Approve agent execution?"
      );
      if (!approved) {
        const canceledSubject = targetChecklistItem?.title || taskNode.title || taskId;
        addMessage("system", `Execution canceled for task: ${canceledSubject}.`);
        return;
      }
      await runAgentTask(taskId, true, checklistItemId);
      return;
    }

    if (result.status === "blocked") {
      addMessage(
        "system",
        String(result.message || "Task is blocked and cannot be fully automated.")
      );
      return;
    }

    if (result.status === "error") {
      addMessage("system", String(result.message || "Agent execution failed."));
      return;
    }

    if (result.result) {
      const taskDelta = Number(result.taskConfidenceDelta ?? 0.08);
      const parentDelta = Number(result.parentConfidenceDelta ?? 0.03);

      if (targetChecklistItem) {
        updateSpeed1Checklist(
          taskId,
          (currentChecklist) =>
            currentChecklist.map((item) =>
              item.id === checklistItemId
                ? {
                    ...item,
                    done: true,
                    status: "completed",
                    lastResultId: String(result.result.id || ""),
                    lastRunAt: nowIso(),
                  }
                : item
            ),
          `Attached task completed via agent for ${taskNode.title}: ${targetChecklistItem.title}`
        );

        const refreshedTaskNode = state.graph.getNode(taskId);
        const refreshedChecklist = getChecklistForNode(refreshedTaskNode);
        const allDone = refreshedChecklist.length > 0 && refreshedChecklist.every((item) => item.done);
        state.graph.updateNode(
          taskId,
          {
            status: allDone ? "completed" : taskNode.status,
            confidenceScore: Math.min(Number(taskNode.confidenceScore || 0.5) + taskDelta * 0.75, 1),
          },
          `Agent attached-task execution updated ${taskNode.title}`
        );
      } else {
        state.graph.updateNode(
          taskId,
          {
            status: "completed",
            confidenceScore: Math.min(Number(taskNode.confidenceScore || 0.5) + taskDelta, 1),
          },
          `Agent action completed for ${taskNode.title}`
        );
      }

      if (parentNode) {
        state.graph.updateNode(
          parentNode.id,
          {
            confidenceScore: Math.min(
              Number(parentNode.confidenceScore || 0.5) + parentDelta,
              1
            ),
          },
          `Parent confidence updated after child execution (${taskNode.title})`
        );
      }

      state.taskResults.unshift(result.result);
      state.selectedNodeId = taskId;
      const completionSubject = targetChecklistItem?.title || taskNode.title || taskId;
      addMessage("system", `Agent completed "${completionSubject}": ${result.result.actionSummary}`);
      return;
    }

    addMessage("system", "Agent execution completed without a result payload.");
  } catch (error) {
    addMessage(
      "system",
      `Agent unavailable: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    state.modelBusy = false;
    persistState();
    render();
  }
}

render();
