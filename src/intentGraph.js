import { clamp, deepClone, nowIso, splitList, uid } from "./utils.js";
import {
  ensureSpeed1ActionTitle,
  ensureSpeed2GoalTitle,
  normalizeTitleForDisplay,
  normalizeTitleKey,
} from "./naming.js";

export const NODE_TYPES = Object.freeze({
  ROOT: "root",
  SPEED2: "speed2",
  SPEED1: "speed1",
});

export const EXECUTION_MODES = Object.freeze({
  AGENT: "Agent",
  HUMAN: "Human",
  HYBRID: "Hybrid",
});

const ALLOWED_NODE_TYPES = new Set(Object.values(NODE_TYPES));
const ALLOWED_EXECUTION_MODES = new Set(Object.values(EXECUTION_MODES));

function inferExecutionMode(taskTitle) {
  const title = (taskTitle || "").toLowerCase();

  if (/practice|complete|attend|exercise|call|meet|write/.test(title)) {
    return EXECUTION_MODES.HUMAN;
  }

  if (/research|find|organize|summarize|schedule|draft|compile/.test(title)) {
    return EXECUTION_MODES.AGENT;
  }

  return EXECUTION_MODES.HYBRID;
}

function normalizeRootRoleLabel(rawRole) {
  const cleaned = String(rawRole || "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/^[\s"'`]+|[\s"'`]+$/g, "")
    .replace(/^[\-*+•]+/, "")
    .replace(/^\d+[\).:-]?\s*/, "")
    .replace(
      /^(?:core\s*identity|identity|primary\s*identity|role|roles|lens|profile)\s*[:\-]\s*/i,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || /^(?:core\s*identity|identity)$/i.test(cleaned)) {
    return "";
  }

  return normalizeTitleForDisplay(cleaned, "");
}

function defaultNode(input = {}) {
  return {
    id: input.id || uid(input.type || "node"),
    type: input.type || NODE_TYPES.SPEED1,
    title: input.title || "Untitled",
    description: input.description || "",
    parentId: input.parentId || null,
    priorityWeight: clamp(Number(input.priorityWeight ?? 0.5), 0.05, 1),
    temporalHorizon: input.temporalHorizon || "short",
    confidenceScore: clamp(Number(input.confidenceScore ?? 0.6), 0, 1),
    emotionalValence: clamp(Number(input.emotionalValence ?? 0), -1, 1),
    dependencies: Array.isArray(input.dependencies) ? input.dependencies : [],
    conflicts: Array.isArray(input.conflicts) ? input.conflicts : [],
    constraints: Array.isArray(input.constraints) ? input.constraints : [],
    executionMode:
      input.executionMode && ALLOWED_EXECUTION_MODES.has(input.executionMode)
        ? input.executionMode
        : inferExecutionMode(input.title),
    status: input.status || "todo",
    metadata: input.metadata || {},
    createdAt: input.createdAt || nowIso(),
    updatedAt: input.updatedAt || nowIso(),
  };
}

function defaultEdge(input = {}) {
  return {
    id: input.id || uid("edge"),
    from: input.from,
    to: input.to,
    kind: input.kind || "contains",
    weight: clamp(Number(input.weight ?? 1), 0, 1),
    directed: input.directed ?? true,
    createdAt: input.createdAt || nowIso(),
  };
}

export class IntentGraphEngine {
  constructor(serializedState = null) {
    this.nodes = new Map();
    this.edges = new Map();
    this.versions = [];
    this.meta = {
      onboardingCompletedAt: null,
      lastDecayAppliedAt: null,
    };

    if (serializedState) {
      this.load(serializedState);
    }
  }

  reset() {
    this.nodes.clear();
    this.edges.clear();
    this.versions = [];
    this.meta = {
      onboardingCompletedAt: null,
      lastDecayAppliedAt: null,
    };
  }

  load(serializedState) {
    this.reset();

    const nodes = Array.isArray(serializedState.nodes) ? serializedState.nodes : [];
    const edges = Array.isArray(serializedState.edges) ? serializedState.edges : [];
    const versions = Array.isArray(serializedState.versions) ? serializedState.versions : [];

    for (const node of nodes) {
      this.nodes.set(node.id, defaultNode(node));
    }

    for (const edge of edges) {
      if (this.nodes.has(edge.from) && this.nodes.has(edge.to)) {
        this.edges.set(edge.id, defaultEdge(edge));
      }
    }

    this.versions = versions;
    this.meta = serializedState.meta || this.meta;
  }

  toJSON() {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values()),
      versions: this.versions,
      meta: this.meta,
    };
  }

  snapshot(reason = "Graph updated") {
    const weights = {};
    for (const node of this.nodes.values()) {
      weights[node.id] = {
        priorityWeight: node.priorityWeight,
        confidenceScore: node.confidenceScore,
        status: node.status,
      };
    }

    this.versions.push({
      id: uid("version"),
      timestamp: nowIso(),
      reason,
      nodeCount: this.nodes.size,
      edgeCount: this.edges.size,
      weights,
    });

    if (this.versions.length > 100) {
      this.versions = this.versions.slice(-100);
    }
  }

  getRecentVersions(limit = 8) {
    return deepClone(this.versions.slice(-limit).reverse());
  }

  getNode(nodeId) {
    const node = this.nodes.get(nodeId);
    return node ? deepClone(node) : null;
  }

  getAllNodes() {
    return deepClone(Array.from(this.nodes.values()));
  }

  getNodesByType(type) {
    return deepClone(
      Array.from(this.nodes.values()).filter((node) => node.type === type)
    );
  }

  getRoot() {
    return this.getNodesByType(NODE_TYPES.ROOT)[0] || null;
  }

  findNodeByTitle(rawTitle) {
    if (!rawTitle) {
      return null;
    }

    const title = rawTitle.trim().toLowerCase();
    for (const node of this.nodes.values()) {
      if (node.title.trim().toLowerCase() === title) {
        return deepClone(node);
      }
    }

    return null;
  }

  getChildren(parentId) {
    return deepClone(
      Array.from(this.nodes.values()).filter((node) => node.parentId === parentId)
    );
  }

  getParent(childId) {
    const node = this.nodes.get(childId);
    if (!node || !node.parentId) {
      return null;
    }

    return this.getNode(node.parentId);
  }

  addNode(input, reason = "Node added", options = {}) {
    const snapshot = options.snapshot ?? true;
    const node = defaultNode(input);

    if (!ALLOWED_NODE_TYPES.has(node.type)) {
      throw new Error(`Invalid node type: ${node.type}`);
    }

    if (node.parentId && !this.nodes.has(node.parentId)) {
      throw new Error(`Parent node does not exist: ${node.parentId}`);
    }

    this.nodes.set(node.id, node);

    if (node.parentId) {
      this.addEdge(
        {
          from: node.parentId,
          to: node.id,
          kind: "contains",
          weight: 1,
        },
        `Edge added for ${node.title}`,
        { snapshot: false }
      );
    }

    if (snapshot) {
      this.snapshot(reason);
    }

    return deepClone(node);
  }

  addEdge(input, reason = "Edge added", options = {}) {
    const snapshot = options.snapshot ?? true;
    const edge = defaultEdge(input);

    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) {
      throw new Error("Edge endpoints must exist in graph");
    }

    this.edges.set(edge.id, edge);
    if (snapshot) {
      this.snapshot(reason);
    }

    return deepClone(edge);
  }

  updateNode(nodeId, patch, reason = "Node updated", options = {}) {
    const snapshot = options.snapshot ?? true;
    const currentNode = this.nodes.get(nodeId);

    if (!currentNode) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    const merged = {
      ...currentNode,
      ...patch,
      id: currentNode.id,
      type: currentNode.type,
      parentId: patch.parentId ?? currentNode.parentId,
      priorityWeight: clamp(
        Number(patch.priorityWeight ?? currentNode.priorityWeight),
        0.05,
        1
      ),
      confidenceScore: clamp(
        Number(patch.confidenceScore ?? currentNode.confidenceScore),
        0,
        1
      ),
      emotionalValence: clamp(
        Number(patch.emotionalValence ?? currentNode.emotionalValence),
        -1,
        1
      ),
      updatedAt: nowIso(),
    };

    if (patch.executionMode && !ALLOWED_EXECUTION_MODES.has(patch.executionMode)) {
      throw new Error(`Invalid execution mode: ${patch.executionMode}`);
    }

    this.nodes.set(nodeId, merged);
    if (snapshot) {
      this.snapshot(reason);
    }

    return deepClone(merged);
  }

  adjustPriority(nodeId, delta, reason = "Priority adjusted") {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    return this.updateNode(
      nodeId,
      {
        priorityWeight: clamp(node.priorityWeight + delta, 0.05, 1),
        confidenceScore: clamp(node.confidenceScore + Math.abs(delta) * 0.3, 0, 1),
      },
      reason
    );
  }

  setExecutionMode(nodeId, executionMode, reason = "Execution mode updated") {
    if (!ALLOWED_EXECUTION_MODES.has(executionMode)) {
      throw new Error(`Invalid execution mode: ${executionMode}`);
    }

    return this.updateNode(nodeId, { executionMode }, reason);
  }

  addConflict(
    nodeId,
    conflictingNodeId,
    conflictReason = "Tension encoded",
    weight = 0.2,
    reason = "Conflict added"
  ) {
    const node = this.nodes.get(nodeId);
    const conflictingNode = this.nodes.get(conflictingNodeId);

    if (!node || !conflictingNode) {
      throw new Error("Both nodes must exist to register a conflict");
    }

    const nodeConflicts = Array.isArray(node.conflicts) ? [...node.conflicts] : [];
    const conflictExists = nodeConflicts.some(
      (entry) => entry.nodeId === conflictingNodeId
    );

    if (!conflictExists) {
      nodeConflicts.push({
        nodeId: conflictingNodeId,
        reason: conflictReason,
        weight: clamp(weight, 0, 1),
      });
      node.conflicts = nodeConflicts;
      node.updatedAt = nowIso();
      this.nodes.set(nodeId, node);
    }

    this.snapshot(reason);
  }

  applyTemporalDecay(options = {}) {
    const rate = Number(options.rate ?? 0.02);
    const minWeight = Number(options.minWeight ?? 0.1);

    for (const node of this.nodes.values()) {
      if (node.type === NODE_TYPES.ROOT) {
        continue;
      }

      node.priorityWeight = clamp(node.priorityWeight * (1 - rate), minWeight, 1);
      node.updatedAt = nowIso();
      this.nodes.set(node.id, node);
    }

    this.meta.lastDecayAppliedAt = nowIso();
    this.snapshot("Temporal decay applied");
  }

  computeReward(input = {}) {
    const advancedNodes = Array.isArray(input.advancedNodes)
      ? input.advancedNodes
      : [];
    const tensionsActivated = Array.isArray(input.tensionsActivated)
      ? input.tensionsActivated
      : [];
    const constraintsApproached = Array.isArray(input.constraintsApproached)
      ? input.constraintsApproached
      : [];
    const constraintBreaches = Array.isArray(input.constraintBreaches)
      ? input.constraintBreaches
      : [];

    const progressScore = advancedNodes.reduce((acc, entry) => {
      const node = this.nodes.get(entry.nodeId);
      if (!node) {
        return acc;
      }

      const delta = Number(entry.delta ?? 0);
      return acc + delta * node.priorityWeight;
    }, 0);

    const tensionPenalty = tensionsActivated.reduce((acc, entry) => {
      return acc + Number(entry.weight ?? 0.2);
    }, 0);

    const approachPenalty = constraintsApproached.length * 0.15;
    const breachPenalty = constraintBreaches.length * 0.8;
    const penalty = tensionPenalty + approachPenalty + breachPenalty;

    return {
      reward: Number((progressScore - penalty).toFixed(3)),
      progressScore: Number(progressScore.toFixed(3)),
      penalty: Number(penalty.toFixed(3)),
      components: {
        tensionPenalty: Number(tensionPenalty.toFixed(3)),
        approachPenalty: Number(approachPenalty.toFixed(3)),
        breachPenalty: Number(breachPenalty.toFixed(3)),
      },
    };
  }

  generateEvolutionSummary(limit = 4) {
    const versions = this.getRecentVersions(limit).reverse();
    if (!versions.length) {
      return "No graph updates recorded yet.";
    }

    const details = versions.map((version) => {
      const when = new Date(version.timestamp).toLocaleString();
      return `${when}: ${version.reason}`;
    });

    return details.join("\n");
  }

  initializeFromOnboarding(profile) {
    this.reset();

    const roles = [];
    splitList(profile.roles).forEach((entry) => {
      const normalizedRole = normalizeRootRoleLabel(entry);
      if (!normalizedRole) {
        return;
      }
      if (roles.some((role) => normalizeTitleKey(role) === normalizeTitleKey(normalizedRole))) {
        return;
      }
      roles.push(normalizedRole);
    });
    const priorities = splitList(profile.currentPriorities);
    const ambitions = splitList(profile.longTermAmbitions);
    const constraints = splitList(profile.constraints);
    const values = splitList(profile.values);
    const tensions = splitList(profile.tensions);
    const relationships = splitList(profile.relationships);

    const rootTitle = roles.length ? roles.join(" / ") : "Identity";
    const rootNode = this.addNode(
      {
        type: NODE_TYPES.ROOT,
        title: rootTitle,
        description: profile.aboutYourself || "User profile root node",
        priorityWeight: 1,
        temporalHorizon: "lifelong",
        confidenceScore: 0.75,
        emotionalValence: 0.3,
        constraints,
        metadata: {
          roles,
          values,
          relationships,
          riskTolerance: profile.riskTolerance || "medium",
          workStyle: profile.workStyle || "",
          creativeAspirations: profile.creativeAspirations || "",
        },
      },
      "Root identity created",
      { snapshot: false }
    );

    const rawSpeed2Ambitions =
      ambitions.length > 0
        ? ambitions
        : ["Define a long-term direction with measurable milestones"];
    const speed2Ambitions = [];
    rawSpeed2Ambitions.forEach((ambition) => {
      const normalizedAmbition = ensureSpeed2GoalTitle(
        ambition,
        rootTitle,
        speed2Ambitions.length + 1
      );
      if (!normalizedAmbition) {
        return;
      }
      if (
        speed2Ambitions.some(
          (existingAmbition) => normalizeTitleKey(existingAmbition) === normalizeTitleKey(normalizedAmbition)
        )
      ) {
        return;
      }
      speed2Ambitions.push(normalizedAmbition);
    });
    if (speed2Ambitions.length === 0) {
      speed2Ambitions.push(ensureSpeed2GoalTitle("", rootTitle, 1));
    }

    const speed2Nodes = speed2Ambitions.map((ambition, index) =>
      this.addNode(
        {
          type: NODE_TYPES.SPEED2,
          parentId: rootNode.id,
          title: ambition,
          description: `Long-horizon objective (${index + 1})`,
          priorityWeight: clamp(0.9 - index * 0.08, 0.35, 1),
          temporalHorizon: "long",
          confidenceScore: 0.55,
          emotionalValence: 0.25,
          constraints,
        },
        `Goal created: ${ambition}`,
        { snapshot: false }
      )
    );

    const speed1Tasks =
      priorities.length > 0
        ? priorities
        : ["Draft a 2-week execution plan for your highest-priority goal"];
    const speed1KeysByParent = new Map();
    speed1Tasks.forEach((task, index) => {
      const parent = speed2Nodes[index % speed2Nodes.length];
      const parentKey = String(parent.id || "");
      if (!speed1KeysByParent.has(parentKey)) {
        speed1KeysByParent.set(parentKey, new Set());
      }
      const keyBucket = speed1KeysByParent.get(parentKey);

      let normalizedTaskTitle = ensureSpeed1ActionTitle(task, parent.title, keyBucket.size + 1);
      let attempt = 0;
      while (attempt < 4 && keyBucket.has(normalizeTitleKey(normalizedTaskTitle))) {
        attempt += 1;
        normalizedTaskTitle = ensureSpeed1ActionTitle(
          "",
          parent.title,
          keyBucket.size + 1 + attempt
        );
      }
      keyBucket.add(normalizeTitleKey(normalizedTaskTitle));

      this.addNode(
        {
          type: NODE_TYPES.SPEED1,
          parentId: parent.id,
          title: normalizedTaskTitle,
          description: `Actionable child of "${parent.title}"`,
          priorityWeight: clamp(parent.priorityWeight - 0.12, 0.2, 1),
          temporalHorizon: "short",
          confidenceScore: 0.6,
          emotionalValence: 0.1,
          constraints,
          executionMode: inferExecutionMode(normalizedTaskTitle),
        },
        `Action created: ${normalizedTaskTitle}`,
        { snapshot: false }
      );
    });

    for (let index = 0; index < speed2Nodes.length; index += 1) {
      const speed2Node = speed2Nodes[index];
      const hasChildAction = this.getChildren(speed2Node.id).some(
        (node) => node.type === NODE_TYPES.SPEED1
      );
      if (hasChildAction) {
        continue;
      }
      const starterTask = ensureSpeed1ActionTitle("", speed2Node.title, index + 1);
      this.addNode(
        {
          type: NODE_TYPES.SPEED1,
          parentId: speed2Node.id,
          title: starterTask,
          description: "Specific starter action generated during onboarding",
          priorityWeight: clamp(speed2Node.priorityWeight - 0.18, 0.2, 1),
          temporalHorizon: "short",
          confidenceScore: 0.58,
          emotionalValence: 0.08,
          constraints,
          executionMode: inferExecutionMode(starterTask),
        },
        `Starter Action created for ${speed2Node.title}`,
        { snapshot: false }
      );
    }

    // Basic conflict encoding from onboarding tensions.
    for (const tension of tensions) {
      const [left, right] = tension.split(/vs|VERSUS|\|/i).map((part) => part.trim());
      if (!left || !right) {
        continue;
      }

      const leftNode = speed2Nodes.find((node) =>
        node.title.toLowerCase().includes(left.toLowerCase())
      );
      const rightNode = speed2Nodes.find((node) =>
        node.title.toLowerCase().includes(right.toLowerCase())
      );

      if (leftNode && rightNode && leftNode.id !== rightNode.id) {
        this.addConflict(
          leftNode.id,
          rightNode.id,
          tension,
          0.25,
          `Conflict encoded: ${tension}`
        );
        this.addConflict(
          rightNode.id,
          leftNode.id,
          tension,
          0.25,
          `Conflict encoded: ${tension}`
        );
      }
    }

    this.meta.onboardingCompletedAt = nowIso();
    this.snapshot("Intent Graph constructed from onboarding");
  }
}
