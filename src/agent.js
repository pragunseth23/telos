import { NODE_TYPES } from "./intentGraph.js";
import { clamp, nowIso, splitList, uid } from "./utils.js";

const IRREVERSIBLE_KEYWORDS = [
  "submit",
  "send",
  "pay",
  "purchase",
  "delete",
  "file taxes",
  "apply",
  "sign contract",
  "enroll",
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

function evaluateAgentExecutability(taskNode) {
  if (!taskNode || taskNode.type !== NODE_TYPES.SPEED1) {
    return {
      allowed: false,
      reason: "Only Actions are eligible for agent execution.",
    };
  }

  if (taskNode.executionMode === "Human") {
    return {
      allowed: false,
      reason: "Task is labeled Human-executable and cannot be fully automated.",
    };
  }

  const normalizedText = `${taskNode.title || ""} ${taskNode.description || ""}`
    .trim()
    .toLowerCase();

  const hasAllowSignal = AGENT_RUN_ALLOW_PATTERNS.some((pattern) => pattern.test(normalizedText));
  if (!hasAllowSignal) {
    return {
      allowed: false,
      reason: "Task is not specific enough for agent automation.",
    };
  }

  const hasBlockSignal = AGENT_RUN_BLOCK_PATTERNS.some((pattern) => pattern.test(normalizedText));
  if (hasBlockSignal) {
    return {
      allowed: false,
      reason: "Task appears to require human or real-world execution.",
    };
  }

  const wordCount = normalizedText.split(/\s+/).filter(Boolean).length;
  const hasActionSignal = AGENT_RUN_ACTION_PATTERNS.some((pattern) =>
    pattern.test(normalizedText)
  );
  if (!hasActionSignal || wordCount < 6) {
    return {
      allowed: false,
      reason:
        "Task must be specific and actionable: include a concrete research action and clear scope.",
    };
  }

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
      reason: "Task must specify expected output or explicit scope.",
    };
  }

  return {
    allowed: true,
    reason: "",
  };
}

function estimateTemplate(taskTitle, taskDescription) {
  const text = `${taskTitle || ""} ${taskDescription || ""}`.toLowerCase();

  if (/study|sat|exam|practice/.test(text)) {
    return {
      summary:
        "Compiled a focused prep packet with ranked resources, milestones, and a two-week study sequence.",
      outputs: [
        "Prioritized study materials",
        "2-week calendar draft",
        "Practice block recommendations",
      ],
      estimatedHours: 4,
      estimatedCost: 0,
    };
  }

  if (/scholarship|research|competitor|market|find/.test(text)) {
    return {
      summary:
        "Researched high-fit options and organized them into a shortlist with eligibility and next-step fields.",
      outputs: [
        "Opportunity shortlist",
        "Comparison table",
        "Next-action checklist",
      ],
      estimatedHours: 2,
      estimatedCost: 0,
    };
  }

  if (/schedule|workout|health|fitness/.test(text)) {
    return {
      summary:
        "Created a realistic weekly routine that balances progress with existing constraints and recovery.",
      outputs: ["Weekly schedule draft", "Load progression notes", "Habit trigger ideas"],
      estimatedHours: 1.5,
      estimatedCost: 0,
    };
  }

  return {
    summary:
      "Drafted an execution-ready action plan, organized dependencies, and produced a concise next-step set.",
    outputs: ["Action plan", "Dependency checklist", "Execution notes"],
    estimatedHours: 2,
    estimatedCost: 0,
  };
}

function detectIrreversibleAction(taskTitle, taskDescription, requestedAction) {
  const combined = `${taskTitle || ""} ${taskDescription || ""} ${requestedAction || ""}`.toLowerCase();
  return IRREVERSIBLE_KEYWORDS.some((keyword) => combined.includes(keyword));
}

function parseConstraints(profile) {
  if (!profile) {
    return [];
  }

  return splitList(profile.constraints);
}

function evaluateConstraintPressure(constraints, template) {
  const approached = [];
  const breached = [];

  for (const rawConstraint of constraints) {
    const constraint = rawConstraint.toLowerCase();

    const hourMatch = constraint.match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?)/);
    if (hourMatch) {
      const hourBudget = Number(hourMatch[1]);
      if (!Number.isNaN(hourBudget)) {
        if (template.estimatedHours > hourBudget) {
          breached.push(rawConstraint);
          continue;
        }
        if (template.estimatedHours > hourBudget * 0.75) {
          approached.push(rawConstraint);
        }
      }
    }

    const moneyMatch = constraint.match(/\$?\s*(\d+(?:\.\d+)?)\s*(dollars|usd|\$|budget)?/);
    if (moneyMatch && /budget|cost|spend|\$|usd|dollar/.test(constraint)) {
      const budget = Number(moneyMatch[1]);
      if (!Number.isNaN(budget)) {
        if (template.estimatedCost > budget) {
          breached.push(rawConstraint);
          continue;
        }
        if (template.estimatedCost > budget * 0.75) {
          approached.push(rawConstraint);
        }
      }
    }

    if (/no purchases|do not spend/.test(constraint) && template.estimatedCost > 0) {
      breached.push(rawConstraint);
    }
  }

  return { approached, breached };
}

function buildJustification(taskNode, parentNode, advancedNodes) {
  const nodeReferences = advancedNodes.map((entry) => entry.title);

  const parentLabel = parentNode ? ` under "${parentNode.title}"` : "";

  return `Action executed for "${taskNode.title}"${parentLabel}. Advanced nodes: ${nodeReferences.join(
    ", "
  )}.`;
}

export class SingleAgentExecutor {
  constructor(agentId = "telos-agent-1") {
    this.agentId = agentId;
  }

  executeTask(input) {
    const { taskId, graph, profile, requestedAction, approvalToken = false } = input;
    const taskNode = graph.getNode(taskId);

    if (!taskNode) {
      return {
        status: "error",
        message: `Task not found: ${taskId}`,
      };
    }

    if (taskNode.type !== NODE_TYPES.SPEED1) {
      return {
        status: "error",
        message: `Only Actions are executable. Node type is ${taskNode.type}.`,
      };
    }

    const executionPolicy = evaluateAgentExecutability(taskNode);
    if (!executionPolicy.allowed) {
      return {
        status: "blocked",
        message: executionPolicy.reason,
        log: {
          id: uid("log"),
          taskId,
          status: "blocked",
          createdAt: nowIso(),
          actionSummary: "Execution blocked by agent eligibility policy.",
          intentAlignmentReport: {
            advancedNodes: [],
            tensionsActivated: [],
            constraintsApproached: [],
            constraintBreaches: [],
            reward: 0,
          },
        },
      };
    }

    const needsApproval = detectIrreversibleAction(
      taskNode.title,
      taskNode.description,
      requestedAction
    );

    if (needsApproval && !approvalToken) {
      return {
        status: "needs_approval",
        message:
          "Task appears to involve an irreversible action. Explicit confirmation is required.",
        approvalContext: {
          taskTitle: taskNode.title,
          irreversibleTriggers: IRREVERSIBLE_KEYWORDS.filter((keyword) =>
            `${taskNode.title} ${taskNode.description}`.toLowerCase().includes(keyword)
          ),
        },
      };
    }

    const parentNode = graph.getParent(taskId);
    const template = estimateTemplate(taskNode.title, taskNode.description);
    const constraints = parseConstraints(profile);
    const pressure = evaluateConstraintPressure(constraints, template);
    const tensionsActivated = (taskNode.conflicts || []).map((conflict) => ({
      nodeId: conflict.nodeId,
      weight: clamp(Number(conflict.weight ?? 0.2), 0, 1),
      reason: conflict.reason || "Conflict activated",
    }));

    const advancedNodes = [
      {
        nodeId: taskNode.id,
        title: taskNode.title,
        delta: taskNode.executionMode === "Hybrid" ? 0.18 : 0.24,
      },
    ];

    if (parentNode) {
      advancedNodes.push({
        nodeId: parentNode.id,
        title: parentNode.title,
        delta: 0.1,
      });
    }

    const rewardData = graph.computeReward({
      advancedNodes,
      tensionsActivated,
      constraintsApproached: pressure.approached,
      constraintBreaches: pressure.breached,
    });

    graph.updateNode(
      taskNode.id,
      {
        status: "completed",
        confidenceScore: clamp(taskNode.confidenceScore + 0.08, 0, 1),
      },
      `Agent action completed for ${taskNode.title}`
    );

    if (parentNode) {
      graph.updateNode(
        parentNode.id,
        {
          confidenceScore: clamp(parentNode.confidenceScore + 0.03, 0, 1),
        },
        `Parent confidence updated after child execution (${taskNode.title})`
      );
    }

    const justification = buildJustification(taskNode, parentNode, advancedNodes);

    const log = {
      id: uid("log"),
      taskId,
      createdAt: nowIso(),
      status: "completed",
      executedBy: this.agentId,
      actionSummary: template.summary,
      outputs: template.outputs,
      justification,
      estimatedHours: template.estimatedHours,
      estimatedCost: template.estimatedCost,
      intentAlignmentReport: {
        advancedNodes: advancedNodes.map((node) => ({
          nodeId: node.nodeId,
          title: node.title,
          delta: Number(node.delta.toFixed(3)),
        })),
        tensionsActivated,
        constraintsApproached: pressure.approached,
        constraintBreaches: pressure.breached,
        reward: rewardData.reward,
        rewardComponents: rewardData.components,
      },
    };

    return {
      status: "completed",
      message: "Agent action executed successfully.",
      log,
    };
  }
}
