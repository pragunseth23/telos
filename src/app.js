import { EXECUTION_MODES, IntentGraphEngine, NODE_TYPES } from "./intentGraph.js";
import { MemoryStore } from "./memory.js";
import { requestAgentRun, requestModelTurn, resetModelContext } from "./api.js";
import { deepClone, nowIso, uid } from "./utils.js";

const appRoot = document.getElementById("app");
const store = new MemoryStore();
const SCROLL_BOTTOM_THRESHOLD = 64;

const WORKSPACE_INITIAL_MESSAGE =
  "Workspace ready. Select a Speed-1 node to execute, or chat to refine your direction.";

const APP_ROUTES = Object.freeze({
  HOME: "home",
  WORKSPACE: "workspace",
  ONBOARDING: "onboarding",
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

function toIdentityLabel(profile, fallbackIndex = 1) {
  const firstRole = String(profile?.roles || "")
    .split(/\n|,|;/)
    .map((entry) => entry.trim())
    .find(Boolean);
  if (firstRole) {
    return firstRole;
  }

  return `Identity ${fallbackIndex}`;
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
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function normalizeIdentityRecord(input, fallbackIndex = 1, baseName = "") {
  if (!input || typeof input !== "object") {
    return null;
  }

  const graphEngine = new IntentGraphEngine(input.graph || null);
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
    actionLogs: Array.isArray(input.actionLogs) ? deepClone(input.actionLogs) : [],
    summaries: Array.isArray(input.summaries) ? deepClone(input.summaries) : [],
    selectedNodeId: selectedNodeId || rootNode?.id || null,
    createdAt: String(input.createdAt || nowIso()),
    updatedAt: String(input.updatedAt || nowIso()),
  };
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

function hydrateState(savedState) {
  const legacyGraph = new IntentGraphEngine(savedState?.graph || null);
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
      actionLogs: Array.isArray(savedState?.actionLogs) ? deepClone(savedState.actionLogs) : [],
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

  const baseNameCandidate = String(
    savedState?.baseName ||
      activeIdentity?.profile?.displayName ||
      activeIdentity?.profile?.accountName ||
      savedOnboarding.name ||
      ""
  ).trim();

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
    actionLogs: Array.isArray(activeIdentity?.actionLogs) ? deepClone(activeIdentity.actionLogs) : [],
    summaries: Array.isArray(activeIdentity?.summaries) ? deepClone(activeIdentity.summaries) : [],
    selectedNodeId: activeIdentity?.selectedNodeId || rootNode?.id || null,
    modelBusy: false,
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
    actionLogs: state.actionLogs,
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
    return "Speed-2 Goal";
  }
  return "Speed-1 Node";
}

function toPriorityLabel(node) {
  const value = Number(node?.priorityWeight ?? 0.5);
  if (value >= 0.75) {
    return "Core Focus";
  }
  if (value >= 0.45) {
    return "Active Focus";
  }
  return "Background Focus";
}

function toConfidenceLabel(node) {
  const value = Number(node?.confidenceScore ?? 0.5);
  if (value >= 0.75) {
    return "Clear";
  }
  if (value >= 0.45) {
    return "Emerging";
  }
  return "Needs Refinement";
}

function toAlignmentLabel(report = {}) {
  const breaches = Array.isArray(report.constraintBreaches)
    ? report.constraintBreaches.length
    : 0;
  const approached = Array.isArray(report.constraintsApproached)
    ? report.constraintsApproached.length
    : 0;
  const tensions = Array.isArray(report.tensionsActivated)
    ? report.tensionsActivated.length
    : 0;
  const reward = Number(report.reward || 0);

  if (breaches > 0) {
    return "Constraint Breach";
  }
  if (reward >= 0.25 && tensions === 0) {
    return "Strong Alignment";
  }
  if (reward > 0 || approached > 0) {
    return "Partial Alignment";
  }
  if (tensions > 0) {
    return "Tension Activated";
  }
  return "Neutral Alignment";
}

function toConstraintTone(report = {}) {
  const breaches = Array.isArray(report.constraintBreaches)
    ? report.constraintBreaches.length
    : 0;
  const approached = Array.isArray(report.constraintsApproached)
    ? report.constraintsApproached.length
    : 0;
  if (breaches > 0) {
    return "Hard boundary crossed";
  }
  if (approached > 0) {
    return "Boundary approached";
  }
  return "Within boundaries";
}

function normalizeChecklistItems(rawItems) {
  if (!Array.isArray(rawItems)) {
    return [];
  }

  return rawItems
    .map((item) => {
      const title = String(item?.title || "").trim();
      if (!title) {
        return null;
      }
      return {
        id: String(item?.id || uid("check")),
        title,
        done: Boolean(item?.done),
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
    actionLogs: deepClone(state.actionLogs),
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
  const rootNode = state.graph.getRoot();
  state.messages = Array.isArray(identity.messages) ? deepClone(identity.messages) : [];
  state.actionLogs = Array.isArray(identity.actionLogs) ? deepClone(identity.actionLogs) : [];
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
  const lensProfile = {
    ...baseProfile,
    roles: label,
  };

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
      actionLogs: [],
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
    ...(state.profile || {}),
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

function hashString(value) {
  const input = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomFromSeed(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function graphNodeCount(serializedGraph, type) {
  const nodes = Array.isArray(serializedGraph?.nodes) ? serializedGraph.nodes : [];
  return nodes.filter((node) => node?.type === type).length;
}

function renderIdentityPreview(identity, width = 540, height = 320) {
  const graphData = identity?.graph || {};
  const nodes = Array.isArray(graphData.nodes) ? graphData.nodes.slice(0, 36) : [];
  const edges = Array.isArray(graphData.edges) ? graphData.edges : [];

  if (!nodes.length) {
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Empty identity graph"></svg>`;
  }

  const root = nodes.find((node) => node.type === NODE_TYPES.ROOT) || nodes[0];
  const positions = new Map();
  positions.set(root.id, { x: width * 0.5, y: height * 0.5 });

  const speed2Nodes = nodes.filter((node) => node.type === NODE_TYPES.SPEED2);
  speed2Nodes.forEach((node, index) => {
    const seed = hashString(`${identity.id}_${node.id}_${index}`);
    const angle = (Math.PI * 2 * (index + 1)) / Math.max(speed2Nodes.length + 1, 2);
    const jitter = (randomFromSeed(seed) - 0.5) * 0.35;
    const radius = Math.min(width, height) * (0.22 + randomFromSeed(seed + 2) * 0.07);
    positions.set(node.id, {
      x: width * 0.5 + Math.cos(angle + jitter) * radius,
      y: height * 0.5 + Math.sin(angle + jitter) * radius,
    });
  });

  const speed1Nodes = nodes.filter((node) => node.type === NODE_TYPES.SPEED1);
  speed1Nodes.forEach((node, index) => {
    const seed = hashString(`${identity.id}_${node.parentId}_${node.id}_${index}`);
    const parent = positions.get(node.parentId) || positions.get(root.id);
    const angle = randomFromSeed(seed + 1) * Math.PI * 2;
    const radius = Math.min(width, height) * (0.22 + randomFromSeed(seed + 7) * 0.18);
    const jitterX = (randomFromSeed(seed + 11) - 0.5) * 16;
    const jitterY = (randomFromSeed(seed + 17) - 0.5) * 16;
    const x = Math.min(width - 24, Math.max(24, parent.x + Math.cos(angle) * radius + jitterX));
    const y = Math.min(height - 24, Math.max(24, parent.y + Math.sin(angle) * radius + jitterY));
    positions.set(node.id, { x, y });
  });

  const edgeMarkup = edges
    .filter((edge) => positions.has(edge.from) && positions.has(edge.to))
    .slice(0, 42)
    .map((edge) => {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" class="identity-preview-edge" />`;
    })
    .join("");

  const nodeMarkup = nodes
    .filter((node) => positions.has(node.id))
    .map((node) => {
      const point = positions.get(node.id);
      const radius = node.type === NODE_TYPES.ROOT ? 7 : node.type === NODE_TYPES.SPEED2 ? 5 : 4;
      return `
        <g class="identity-preview-node ${node.type}">
          <circle cx="${point.x}" cy="${point.y}" r="${radius}" />
          <text x="${point.x + 7}" y="${point.y + 4}">${escapeHtml(truncate(node.title, 26))}</text>
        </g>
      `;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(identity.label)} graph preview">
      ${edgeMarkup}
      ${nodeMarkup}
    </svg>
  `;
}

function renderIdentityHome() {
  const cardsMarkup = state.identityGraphs
    .map((identity) => {
      const speed2Count = graphNodeCount(identity.graph, NODE_TYPES.SPEED2);
      const speed1Count = graphNodeCount(identity.graph, NODE_TYPES.SPEED1);
      const isActive = identity.id === state.activeIdentityId;
      return `
        <article class="identity-card ${isActive ? "active" : ""}">
          <button class="identity-open-btn" data-open-identity="${identity.id}">
            <div class="identity-card-top">
              <h3>${escapeHtml(identity.label)}</h3>
              <span class="pill">${speed2Count} goals</span>
            </div>
            <p class="identity-card-subtle">${speed1Count} action nodes</p>
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
          <p>Choose an identity graph to continue, or start a new one.</p>
        </div>
        <div class="identity-home-actions">
          <button id="new-identity-btn" class="primary-btn">New Identity Graph</button>
          <button id="open-active-btn">Open Current Workspace</button>
        </div>
      </header>
      <section class="identity-gallery reveal delay-1">
        ${cardsMarkup}
      </section>
    </div>
  `;

  attachIdentityHomeHandlers();
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
  state.onboarding.targetIdentityId = targetIdentityId;

  if (state.identityGraphs.length === 0) {
    state.onboardingCompleted = false;
    state.profile = null;
    state.messages = [];
    state.actionLogs = [];
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
  const normalizedProfile = normalizeProfile(profileFromModel);
  const fixedBaseName =
    state.baseName ||
    String(state.onboarding.name || "").trim() ||
    String(state.profile?.displayName || state.profile?.accountName || "").trim();
  if (fixedBaseName) {
    state.baseName = fixedBaseName;
    state.onboarding.name = fixedBaseName;
  }
  const identityId =
    String(state.onboarding.targetIdentityId || state.activeIdentityId || "") || uid("identity");
  const existingIdentity = state.identityGraphs.find((entry) => entry.id === identityId);
  const explicitLensLabel = normalizeLensLabel(state.onboarding.lensLabel || "");
  const roleLensLabel = normalizeLensLabel(normalizedProfile.roles.split(",")[0] || "");
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
  state.onboarding.stage = "complete";
  state.onboardingCompleted = true;
  state.onboarding.targetIdentityId = "";
  state.onboarding.lensLabel = "";

  const firstGoal = state.graph.getNodesByType(NODE_TYPES.SPEED2)[0];
  state.selectedNodeId = firstGoal?.id || state.graph.getRoot()?.id || null;
  state.messages = [];
  state.actionLogs = [];
  state.summaries = [];

  addMessage("system", WORKSPACE_INITIAL_MESSAGE);
  scrollState.workspace.scrollTop = 0;
  scrollState.workspace.stickToBottom = true;
  scrollState.workspace.lastMessageCount = 0;
  scrollState.workspace.pendingAutoScroll = true;
  state.route = APP_ROUTES.WORKSPACE;
  state.activeIdentityId = identityId;
  upsertIdentityRecord(
    buildActiveIdentitySnapshot({
      id: identityId,
      label: explicitLensLabel || existingIdentity?.label || roleLensLabel || fallbackLabel,
      createdAt: existingIdentity?.createdAt || nowIso(),
    })
  );
  persistState();
  render();
}

function renderWorkspace() {
  const selectedNode = state.graph.getNode(state.selectedNodeId) || state.graph.getRoot();
  const activeIdentity = getActiveIdentityRecord();
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
          <h2>${escapeHtml(activeIdentity?.label || "Telos Workspace")}</h2>
        </div>
        <div class="topbar-actions">
          <button id="home-btn">Home</button>
          <label class="identity-switcher">
            <span>Identity</span>
            <select id="identity-switcher">${identityOptions}</select>
          </label>
          <button id="snapshot-btn">Snapshot</button>
          <button id="reset-btn" class="danger-btn">Reset</button>
        </div>
      </header>

      <main class="workspace-grid reveal delay-1">
        <aside class="panel task-panel">${renderTaskPanel(selectedNode)}</aside>
        <section class="panel graph-panel">${renderGraphPanel(selectedNode)}</section>
        <aside class="panel chat-panel">${renderChatPanel()}</aside>
      </main>
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
      <h3>Speed-2 Goals</h3>
      <p class="subtle">Choose a long-horizon direction to focus your execution plan.</p>
      <ul class="clean-list task-list">
        ${goals
          .map((goal) => {
            return `
              <li class="task-row">
                <button data-node-select="${goal.id}" class="ghost-btn">${escapeHtml(goal.title)}</button>
                <span class="pill">${toPriorityLabel(goal)}</span>
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
    const completedNodes = speed1Nodes.filter((node) => node.status === "completed");

    return `
      <h3>${escapeHtml(selectedNode.title)}</h3>
      <p class="subtle">Strategic layer only. Speed-1 nodes hold executable work and attached tasks.</p>
      <section class="inspector">
        <p class="label">Speed-1 Nodes</p>
        <p>${speed1Nodes.length}</p>
        <p class="label">Completed</p>
        <p>${completedNodes.length}</p>
      </section>
      <p class="subtle">
        Select a Speed-1 node in the graph to execute actions, manage attached tasks, and track outcomes.
      </p>
    `;
  }

  if (selectedNode.type === NODE_TYPES.SPEED1) {
    const parent = state.graph.getParent(selectedNode.id);
    const logs = state.actionLogs.filter((log) => log.taskId === selectedNode.id);
    const checklist = getChecklistForNode(selectedNode);

    return `
      <h3>${escapeHtml(selectedNode.title)}</h3>
      <p class="subtle">Parent goal: ${escapeHtml(parent?.title || "None")}</p>

      <div class="detail-grid">
        <div>
          <p class="label">Execution Mode</p>
          <select data-mode-select="${selectedNode.id}">
            ${Object.values(EXECUTION_MODES)
              .map((mode) => {
                return `<option value="${mode}" ${
                  selectedNode.executionMode === mode ? "selected" : ""
                }>${mode}</option>`;
              })
              .join("")}
          </select>
        </div>
        <div>
          <p class="label">Status</p>
          <p>${escapeHtml(selectedNode.status)}</p>
        </div>
        <div>
          <p class="label">Focus</p>
          <p>${escapeHtml(toPriorityLabel(selectedNode))}</p>
        </div>
        <div>
          <p class="label">Clarity</p>
          <p>${escapeHtml(toConfidenceLabel(selectedNode))}</p>
        </div>
      </div>

      <div class="task-actions">
        <button data-task-run="${selectedNode.id}">Run Agent</button>
        <button data-task-done="${selectedNode.id}">Mark Done</button>
        ${
          parent
            ? `<button data-node-select="${parent.id}" class="ghost-btn">Back to Goal</button>`
            : ""
        }
      </div>

      <section class="checklist-section">
        <h4>Attached Tasks</h4>
        ${
          checklist.length === 0
            ? "<p class='subtle'>No attached tasks yet. Add one to break this down.</p>"
            : `
                <ul class="clean-list checklist-list">
                  ${checklist
                    .map((item) => {
                      return `
                        <li class="checklist-row">
                          <label>
                            <input
                              type="checkbox"
                              data-check-toggle="${selectedNode.id}|${item.id}"
                              ${item.done ? "checked" : ""}
                            />
                            <span>${escapeHtml(item.title)}</span>
                          </label>
                          <button type="button" class="ghost-btn" data-check-remove="${
                            selectedNode.id
                          }|${item.id}">
                            Remove
                          </button>
                        </li>
                      `;
                    })
                    .join("")}
                </ul>
              `
        }
        <form id="checklist-form" data-checklist-node="${selectedNode.id}" class="inline-form">
          <input type="text" name="title" required placeholder="Add attached task" />
          <button type="submit">Add</button>
        </form>
      </section>

      <section class="log-section">
        <h4>Execution Logs</h4>
        ${
          logs.length === 0
            ? "<p class='subtle'>No executions yet.</p>"
            : logs
                .map((log) => {
                  const report = log.intentAlignmentReport || {};
                  const advanced = Array.isArray(report.advancedNodes)
                    ? report.advancedNodes.map((node) => escapeHtml(node.title)).join(", ")
                    : "-";

                  return `
                    <article class="log-card">
                      <p class="label">${escapeHtml(log.status || "unknown")}</p>
                      <p>${escapeHtml(log.actionSummary || "-")}</p>
                      <p class="subtle"><strong>Justification:</strong> ${escapeHtml(
                        log.justification || "-"
                      )}</p>
                      <p class="subtle"><strong>Advanced:</strong> ${advanced}</p>
                      <p class="subtle">
                        <strong>Plan Fit:</strong>
                        ${toAlignmentLabel(report)}. ${toConstraintTone(report)}.
                      </p>
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
  if (forceGraphInstance) {
    if (typeof forceGraphInstance._destructor === "function") {
      forceGraphInstance._destructor();
    } else if (typeof forceGraphInstance.pauseAnimation === "function") {
      forceGraphInstance.pauseAnimation();
    }
    forceGraphInstance = null;
  }
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

function buildForceGraphData(selectedNode) {
  const root = state.graph.getRoot();
  const speed2 = state.graph.getNodesByType(NODE_TYPES.SPEED2);
  const speed1 = state.graph.getNodesByType(NODE_TYPES.SPEED1);
  if (!root) {
    return { nodes: [], links: [] };
  }

  const focusSpeed2Id =
    selectedNode?.type === NODE_TYPES.SPEED2
      ? selectedNode.id
      : selectedNode?.type === NODE_TYPES.SPEED1
      ? selectedNode.parentId
      : null;

  const visibleNodes = [root, ...speed2];
  const visibleSpeed1 = focusSpeed2Id
    ? speed1.filter((node) => node.parentId === focusSpeed2Id)
    : speed1;
  visibleNodes.push(...visibleSpeed1.slice(0, 28));

  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const links = visibleNodes
    .filter((node) => node.parentId && visibleIds.has(node.parentId))
    .map((node) => ({ source: node.parentId, target: node.id }));

  return {
    nodes: visibleNodes.map((node) => ({
      id: node.id,
      title: node.title,
      type: node.type,
      selected: node.id === state.selectedNodeId,
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
      [NODE_TYPES.ROOT]: "#8fb7ff",
      [NODE_TYPES.SPEED2]: "#7bd7b8",
      [NODE_TYPES.SPEED1]: "#f2cd88",
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
      .linkColor(() => "rgba(155, 176, 205, 0.38)")
      .linkWidth(1.3)
      .d3AlphaDecay(0.06)
      .d3VelocityDecay(0.34)
      .cooldownTicks(120)
      .onNodeClick((node) => {
        if (!node?.id) {
          return;
        }
        state.selectedNodeId = String(node.id);
        persistState();
        render();
      })
      .nodeCanvasObject((node, ctx, globalScale) => {
        const label = truncate(String(node.title || ""), 30);
        const fontSize = Math.max(10, 14 / globalScale);
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

        ctx.font = `${fontSize}px "IBM Plex Sans", "Avenir Next", sans-serif`;
        ctx.fillStyle = "#dce8ff";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(label, node.x + radius + 4, node.y);
      });

    forceGraphInstance.onEngineStop(() => {
      if (!host.isConnected || typeof forceGraphInstance?.zoomToFit !== "function") {
        return;
      }
      try {
        forceGraphInstance.zoomToFit(250, 36);
      } catch {
        // Ignore transient zoom errors during remounts.
      }
    });
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
            <p class="subtle">
              Focus ${escapeHtml(toPriorityLabel(selectedNode))} | Clarity ${escapeHtml(
              toConfidenceLabel(selectedNode)
            )} | Horizon ${escapeHtml(selectedNode.temporalHorizon)}
            </p>
            <p class="subtle">
              Conflicts: ${
                (selectedNode.conflicts || []).length
                  ? (selectedNode.conflicts || [])
                      .map((entry) => escapeHtml(entry.reason || "Tension"))
                      .join(", ")
                  : "none"
              }
            </p>
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

  const openActiveButton = document.getElementById("open-active-btn");
  openActiveButton?.addEventListener("click", () => {
    const fallbackId = state.activeIdentityId || state.identityGraphs[0]?.id || "";
    if (!fallbackId) {
      startNewIdentityOnboarding();
      persistState();
      render();
      return;
    }
    activateIdentity(fallbackId);
    persistState();
    render();
  });

  const newIdentityButton = document.getElementById("new-identity-btn");
  newIdentityButton?.addEventListener("click", () => {
    startNewIdentityOnboarding();
    persistState();
    render();
  });
}

function attachWorkspaceHandlers() {
  const homeButton = document.getElementById("home-btn");
  homeButton?.addEventListener("click", () => {
    state.route = APP_ROUTES.HOME;
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

  document.querySelectorAll("[data-mode-select]").forEach((select) => {
    select.addEventListener("change", () => {
      const nodeId = select.dataset.modeSelect;
      const executionMode = select.value;
      state.graph.setExecutionMode(nodeId, executionMode, "Manual execution label update");
      addMessage(
        "system",
        `Execution mode for "${state.graph.getNode(nodeId)?.title || "task"}" set to ${executionMode}.`
      );
      persistState();
      render();
    });
  });

  document.querySelectorAll("[data-task-run]").forEach((button) => {
    button.addEventListener("click", () => {
      void runAgentTask(button.dataset.taskRun);
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

  const snapshotButton = document.getElementById("snapshot-btn");
  snapshotButton?.addEventListener("click", () => {
    state.graph.snapshot("Manual snapshot from user");
    addMessage("system", "Graph snapshot saved.");
    persistState();
    render();
  });

  const resetButton = document.getElementById("reset-btn");
  resetButton?.addEventListener("click", async () => {
    const confirmed = window.confirm(
      "Reset all Telos data (browser state and persisted model context)?"
    );
    if (!confirmed) {
      return;
    }

    try {
      await resetModelContext();
    } catch {
      // Ignore reset endpoint failures and still clear local state.
    }

    store.clear();
    window.location.reload();
  });

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
        },
      ],
      `Attached task created for ${state.graph.getNode(nodeId)?.title || nodeId}: ${title}`
    );
    persistState();
    render();
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
            item.id === itemId ? { ...item, done: Boolean(checkbox.checked) } : item
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

async function runAgentTask(taskId, approvalToken = false) {
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
    });

    if (result.status === "needs_approval") {
      const approved = window.confirm(
        "This task may involve irreversible actions. Approve agent execution?"
      );
      if (!approved) {
        addMessage("system", `Execution canceled for task: ${taskNode.title || taskId}.`);
        return;
      }
      await runAgentTask(taskId, true);
      return;
    }

    if (result.status === "blocked") {
      if (result.log) {
        state.actionLogs.unshift(result.log);
      }
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

    if (result.log) {
      const taskDelta = Number(result.taskConfidenceDelta ?? 0.08);
      const parentDelta = Number(result.parentConfidenceDelta ?? 0.03);

      state.graph.updateNode(
        taskId,
        {
          status: "completed",
          confidenceScore: Math.min(Number(taskNode.confidenceScore || 0.5) + taskDelta, 1),
        },
        `Agent action completed for ${taskNode.title}`
      );

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

      state.actionLogs.unshift(result.log);
      state.selectedNodeId = taskId;
      addMessage("system", `Agent execution completed: ${result.log.actionSummary}`);
      return;
    }

    addMessage("system", "Agent execution completed without a log payload.");
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
