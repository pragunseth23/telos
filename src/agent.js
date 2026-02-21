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

  return `Action executed for Speed-1 node "${taskNode.title}"${parentLabel}. Advanced nodes: ${nodeReferences.join(
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
        message: `Only Speed-1 tasks are executable. Node type is ${taskNode.type}.`,
      };
    }

    if (taskNode.executionMode === "Human") {
      return {
        status: "blocked",
        message: "Task is labeled Human-executable and cannot be fully automated.",
        log: {
          id: uid("log"),
          taskId,
          status: "blocked",
          createdAt: nowIso(),
          actionSummary: "Execution blocked by task mode policy.",
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
