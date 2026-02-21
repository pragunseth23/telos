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

function toObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toStringValue(value, fallback = "") {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (Array.isArray(value)) {
    const joined = value
      .map((entry) => toStringValue(entry, ""))
      .filter(Boolean)
      .join(", ");
    return joined || fallback;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value && typeof value === "object") {
    const obj = value;
    return (
      toStringValue(obj.text, "") ||
      toStringValue(obj.output_text, "") ||
      fallback
    );
  }
  return fallback;
}

function toBooleanValue(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1"].includes(normalized)) {
      return true;
    }
    if (["false", "no", "0"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function toNumberValue(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  return fallback;
}

function toStringList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => toStringValue(entry, "")).filter(Boolean);
  }
  const single = toStringValue(value, "");
  return single ? [single] : [];
}

function normalizeProfileSnapshot(rawProfile) {
  const profileInput = toObject(rawProfile);
  const normalized = {};
  for (const field of PROFILE_FIELDS) {
    normalized[field] = toStringValue(profileInput[field], "");
  }
  return normalized;
}

function normalizeSelectedNode(rawNode) {
  const node = toObject(rawNode);
  return {
    title: toStringValue(node.title, ""),
    type: toStringValue(node.type, ""),
    description: toStringValue(node.description, ""),
    status: toStringValue(node.status, ""),
    executionMode: toStringValue(node.executionMode, ""),
    temporalHorizon: toStringValue(node.temporalHorizon, ""),
  };
}

function normalizeGraphContext(rawGraphContext) {
  const graphContext = toObject(rawGraphContext);
  return {
    identity: toStringValue(graphContext.identity, ""),
    speed2Goals: toStringList(graphContext.speed2Goals),
    nearbyTasks: toStringList(graphContext.nearbyTasks),
  };
}

function normalizeOnboardingState(rawOnboarding) {
  const onboarding = toObject(rawOnboarding);
  return {
    name: toStringValue(onboarding.name, ""),
    profile: normalizeProfileSnapshot(onboarding.profile),
  };
}

export function normalizeModelTurnRequest(rawPayload) {
  const payload = toObject(rawPayload);
  const phase = toStringValue(payload.phase, "").toLowerCase();
  if (phase !== "onboarding" && phase !== "workspace") {
    throw new Error("Invalid model payload phase.");
  }

  const normalized = { phase };
  if ("init" in payload) {
    normalized.init = toBooleanValue(payload.init, false);
  }

  const message = toStringValue(payload.message, "");
  if (message) {
    normalized.message = message;
  }

  if (phase === "onboarding") {
    normalized.onboarding = normalizeOnboardingState(payload.onboarding);
    return normalized;
  }

  normalized.profile = normalizeProfileSnapshot(payload.profile);
  normalized.selectedNode = normalizeSelectedNode(payload.selectedNode);
  normalized.graphContext = normalizeGraphContext(payload.graphContext);
  return normalized;
}

export function normalizeModelTurnResponse(rawResponse, phaseFallback = "workspace") {
  const response = toObject(rawResponse);
  const onboardingRaw = toObject(response.onboarding);
  const phase = toStringValue(response.phase, phaseFallback || "workspace");
  const normalized = {
    phase,
    reply: toStringValue(
      response.reply,
      "I need a little more context before I can respond."
    ),
  };

  if ("onboardingComplete" in response || "onboarding_complete" in response) {
    normalized.onboardingComplete = toBooleanValue(
      response.onboardingComplete ?? response.onboarding_complete,
      false
    );
  }

  if (Object.keys(onboardingRaw).length > 0) {
    normalized.onboarding = {
      name: toStringValue(onboardingRaw.name, ""),
      profile: normalizeProfileSnapshot(onboardingRaw.profile),
    };
  }

  return normalized;
}

function normalizeAgentNode(rawNode) {
  const node = toObject(rawNode);
  const conflictsRaw = Array.isArray(node.conflicts) ? node.conflicts : [];
  return {
    id: toStringValue(node.id, ""),
    type: toStringValue(node.type, ""),
    title: toStringValue(node.title, ""),
    description: toStringValue(node.description, ""),
    status: toStringValue(node.status, "todo"),
    executionMode: toStringValue(node.executionMode, "Hybrid"),
    priorityWeight: toNumberValue(node.priorityWeight, 0.5),
    confidenceScore: toNumberValue(node.confidenceScore, 0.5),
    conflicts: conflictsRaw.map((entry) => {
      const conflict = toObject(entry);
      return {
        nodeId: toStringValue(conflict.nodeId, ""),
        reason: toStringValue(conflict.reason, ""),
        weight: toNumberValue(conflict.weight, 0.2),
      };
    }),
  };
}

export function normalizeAgentRunRequest(rawPayload) {
  const payload = toObject(rawPayload);
  const taskId = toStringValue(payload.taskId, "");
  if (!taskId) {
    throw new Error("Agent payload is missing taskId.");
  }

  const task = normalizeAgentNode(payload.task);
  if (!task.id) {
    task.id = taskId;
  }
  if (!task.title) {
    throw new Error("Agent payload is missing task title.");
  }

  const normalized = {
    taskId,
    task,
    profile: normalizeProfileSnapshot(payload.profile),
    approvalToken: toBooleanValue(payload.approvalToken, false),
  };

  if (payload.parentTask) {
    normalized.parentTask = normalizeAgentNode(payload.parentTask);
  }

  const requestedAction = toStringValue(payload.requestedAction, "");
  if (requestedAction) {
    normalized.requestedAction = requestedAction;
  }

  return normalized;
}

export function normalizeAgentRunResponse(rawResponse) {
  const response = toObject(rawResponse);
  const status = toStringValue(response.status, "error");
  const allowedStatus = new Set(["needs_approval", "blocked", "error", "completed"]);
  const safeStatus = allowedStatus.has(status) ? status : "error";

  const normalized = {
    status: safeStatus,
    message: toStringValue(response.message, "Agent response unavailable."),
  };

  if (response.approvalContext) {
    const approval = toObject(response.approvalContext);
    normalized.approvalContext = {
      taskTitle: toStringValue(approval.taskTitle, ""),
      irreversibleTriggers: toStringList(approval.irreversibleTriggers),
    };
  }

  if (response.log) {
    const log = toObject(response.log);
    const report = toObject(log.intentAlignmentReport ?? log.intent_alignment_report);
    normalized.log = {
      id: toStringValue(log.id, ""),
      taskId: toStringValue(log.taskId ?? log.task_id, ""),
      createdAt: toStringValue(log.createdAt ?? log.created_at, ""),
      status: toStringValue(log.status, "unknown"),
      executedBy: toStringValue(log.executedBy ?? log.executed_by, "telos-agent-1"),
      actionSummary: toStringValue(
        log.actionSummary ?? log.action_summary,
        "Execution completed."
      ),
      outputs: toStringList(log.outputs),
      justification: toStringValue(log.justification, ""),
      estimatedHours: toNumberValue(log.estimatedHours ?? log.estimated_hours, 0),
      estimatedCost: toNumberValue(log.estimatedCost ?? log.estimated_cost, 0),
      intentAlignmentReport: {
        advancedNodes: Array.isArray(report.advancedNodes ?? report.advanced_nodes)
          ? (report.advancedNodes ?? report.advanced_nodes).map((entry) => {
              const node = toObject(entry);
              return {
                nodeId: toStringValue(node.nodeId ?? node.node_id, ""),
                title: toStringValue(node.title, ""),
                delta: toNumberValue(node.delta, 0),
              };
            })
          : [],
        tensionsActivated: Array.isArray(
          report.tensionsActivated ?? report.tensions_activated
        )
          ? (report.tensionsActivated ?? report.tensions_activated).map((entry) => {
              const tension = toObject(entry);
              return {
                nodeId: toStringValue(tension.nodeId ?? tension.node_id, ""),
                reason: toStringValue(tension.reason, ""),
                weight: toNumberValue(tension.weight, 0.2),
              };
            })
          : [],
        constraintsApproached: toStringList(
          report.constraintsApproached ?? report.constraints_approached
        ),
        constraintBreaches: toStringList(
          report.constraintBreaches ?? report.constraint_breaches
        ),
        reward: toNumberValue(report.reward, 0),
      },
    };
  }

  if ("taskConfidenceDelta" in response || "task_confidence_delta" in response) {
    normalized.taskConfidenceDelta = toNumberValue(
      response.taskConfidenceDelta ?? response.task_confidence_delta,
      0
    );
  }

  if ("parentConfidenceDelta" in response || "parent_confidence_delta" in response) {
    normalized.parentConfidenceDelta = toNumberValue(
      response.parentConfidenceDelta ?? response.parent_confidence_delta,
      0
    );
  }

  return normalized;
}

async function postJson(url, payload, errorPrefix) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `${errorPrefix} ${response.status}`);
  }
  return data;
}

export async function requestModelTurn(payload) {
  const normalizedPayload = normalizeModelTurnRequest(payload);
  const invoke = window?.__TAURI__?.core?.invoke;
  if (typeof invoke === "function") {
    const raw = await invoke("chat_with_model", { payload: normalizedPayload });
    return normalizeModelTurnResponse(raw, normalizedPayload.phase);
  }

  const raw = await postJson("/api/chat", normalizedPayload, "Model request failed with status");
  return normalizeModelTurnResponse(raw, normalizedPayload.phase);
}

export async function resetModelContext() {
  const invoke = window?.__TAURI__?.core?.invoke;
  if (typeof invoke === "function") {
    return invoke("reset_model_context");
  }

  return postJson("/api/context/reset", {}, "Context reset failed with status");
}

export async function requestAgentRun(payload) {
  const normalizedPayload = normalizeAgentRunRequest(payload);
  const invoke = window?.__TAURI__?.core?.invoke;
  if (typeof invoke === "function") {
    const raw = await invoke("run_agent_task", { payload: normalizedPayload });
    return normalizeAgentRunResponse(raw);
  }

  const raw = await postJson(
    "/api/agent/run",
    normalizedPayload,
    "Agent request failed with status"
  );
  return normalizeAgentRunResponse(raw);
}
