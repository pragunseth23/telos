use chrono::Utc;
use dotenvy::dotenv;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

const OPENAI_RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
const IRREVERSIBLE_KEYWORDS: [&str; 10] = [
  "submit",
  "send",
  "pay",
  "purchase",
  "delete",
  "file taxes",
  "apply",
  "sign contract",
  "enroll",
  "transfer",
];
const AGENT_EXECUTABLE_ALLOW_TERMS: [&str; 19] = [
  "search",
  "find",
  "research",
  "compare",
  "summarize",
  "organize",
  "collect",
  "gather",
  "compile",
  "draft",
  "outline",
  "brainstorm",
  "analyze",
  "analyse",
  "online",
  "study material",
  "study materials",
  "resource",
  "resources",
];
const AGENT_EXECUTABLE_ACTION_TERMS: [&str; 16] = [
  "search",
  "find",
  "research",
  "compare",
  "summarize",
  "organize",
  "collect",
  "gather",
  "compile",
  "draft",
  "outline",
  "brainstorm",
  "analyze",
  "analyse",
  "rank",
  "prioritize",
];
const AGENT_EXECUTABLE_SCOPE_TERMS: [&str; 12] = [
  "for",
  "about",
  "on",
  "from",
  "between",
  "within",
  "across",
  "near",
  "local",
  "top",
  "best",
  "vs",
];
const AGENT_EXECUTABLE_OUTPUT_TERMS: [&str; 16] = [
  "list",
  "shortlist",
  "table",
  "comparison",
  "summary",
  "brief",
  "report",
  "checklist",
  "links",
  "sources",
  "resource",
  "resources",
  "study material",
  "study materials",
  "plan",
  "outline",
];
const AGENT_EXECUTABLE_BLOCK_TERMS: [&str; 20] = [
  "practice",
  "play",
  "workout",
  "exercise",
  "train",
  "attend",
  "go to",
  "show up",
  "call",
  "meet",
  "talk to",
  "interview",
  "cook",
  "travel",
  "study",
  "build",
  "code",
  "develop",
  "ship",
  "launch",
];

#[derive(Clone)]
struct AppState {
  client: Client,
  api_key: String,
  model: String,
}

#[derive(Clone, Copy)]
enum ReasoningEffort {
  None,
  Low,
  Medium,
}

impl ReasoningEffort {
  fn as_str(self) -> &'static str {
    match self {
      Self::None => "none",
      Self::Low => "low",
      Self::Medium => "medium",
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ProfileSnapshot {
  about_yourself: String,
  roles: String,
  current_priorities: String,
  long_term_ambitions: String,
  values: String,
  constraints: String,
  relationships: String,
  tensions: String,
  risk_tolerance: String,
  work_style: String,
  creative_aspirations: String,
}

impl ProfileSnapshot {
  fn normalize(&mut self) {
    self.about_yourself = self.about_yourself.trim().to_string();
    self.roles = self.roles.trim().to_string();
    self.current_priorities = self.current_priorities.trim().to_string();
    self.long_term_ambitions = self.long_term_ambitions.trim().to_string();
    self.values = self.values.trim().to_string();
    self.constraints = self.constraints.trim().to_string();
    self.relationships = self.relationships.trim().to_string();
    self.tensions = self.tensions.trim().to_string();
    self.risk_tolerance = self.risk_tolerance.trim().to_string();
    self.work_style = self.work_style.trim().to_string();
    self.creative_aspirations = self.creative_aspirations.trim().to_string();
  }

  fn apply_patch(&mut self, patch: ProfilePatch) {
    if let Some(value) = patch.about_yourself {
      self.about_yourself = value;
    }
    if let Some(value) = patch.roles {
      self.roles = value;
    }
    if let Some(value) = patch.current_priorities {
      self.current_priorities = value;
    }
    if let Some(value) = patch.long_term_ambitions {
      self.long_term_ambitions = value;
    }
    if let Some(value) = patch.values {
      self.values = value;
    }
    if let Some(value) = patch.constraints {
      self.constraints = value;
    }
    if let Some(value) = patch.relationships {
      self.relationships = value;
    }
    if let Some(value) = patch.tensions {
      self.tensions = value;
    }
    if let Some(value) = patch.risk_tolerance {
      self.risk_tolerance = value;
    }
    if let Some(value) = patch.work_style {
      self.work_style = value;
    }
    if let Some(value) = patch.creative_aspirations {
      self.creative_aspirations = value;
    }
    self.normalize();
  }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ProfilePatch {
  about_yourself: Option<String>,
  roles: Option<String>,
  current_priorities: Option<String>,
  long_term_ambitions: Option<String>,
  values: Option<String>,
  constraints: Option<String>,
  relationships: Option<String>,
  tensions: Option<String>,
  risk_tolerance: Option<String>,
  work_style: Option<String>,
  creative_aspirations: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct OnboardingClientState {
  name: String,
  profile: ProfileSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SelectedNode {
  title: String,
  r#type: String,
  description: String,
  status: String,
  execution_mode: String,
  temporal_horizon: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct GraphContext {
  identity: String,
  speed2_goals: Vec<String>,
  nearby_tasks: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatPayload {
  phase: String,
  message: Option<String>,
  init: Option<bool>,
  onboarding: Option<OnboardingClientState>,
  profile: Option<ProfileSnapshot>,
  selected_node: Option<SelectedNode>,
  graph_context: Option<GraphContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct OnboardingMemory {
  name: String,
  profile: ProfileSnapshot,
  completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ConversationTurn {
  id: String,
  timestamp: String,
  phase: String,
  role: String,
  content: String,
  metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct MemoryNote {
  created_at: String,
  note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedContext {
  version: u8,
  created_at: String,
  updated_at: String,
  onboarding: OnboardingMemory,
  conversations: Vec<ConversationTurn>,
  memory_notes: Vec<MemoryNote>,
}

impl Default for PersistedContext {
  fn default() -> Self {
    let now = now_iso();
    Self {
      version: 1,
      created_at: now.clone(),
      updated_at: now,
      onboarding: OnboardingMemory::default(),
      conversations: vec![],
      memory_notes: vec![],
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct OnboardingModelOutput {
  reply: Option<String>,
  #[serde(alias = "onboarding_complete")]
  onboarding_complete: Option<bool>,
  name: Option<String>,
  #[serde(alias = "profile_patch")]
  profile_patch: Option<ProfilePatch>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct WorkspaceModelOutput {
  reply: Option<String>,
  memory_note: Option<String>,
  graph_updates: Vec<WorkspaceGraphUpdate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct WorkspaceGraphUpdate {
  op: String,
  title: String,
  parent_goal: Option<String>,
  parent_action: Option<String>,
  description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatResponse {
  phase: String,
  reply: String,
  onboarding_complete: Option<bool>,
  onboarding: Option<OnboardingClientState>,
  graph_updates: Option<Vec<WorkspaceGraphUpdate>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentConflictInput {
  node_id: String,
  reason: Option<String>,
  weight: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentNodeInput {
  id: String,
  r#type: String,
  title: String,
  description: String,
  status: String,
  execution_mode: String,
  priority_weight: Option<f64>,
  confidence_score: Option<f64>,
  conflicts: Option<Vec<AgentConflictInput>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentPayload {
  task_id: String,
  task: AgentNodeInput,
  parent_task: Option<AgentNodeInput>,
  profile: Option<ProfileSnapshot>,
  requested_action: Option<String>,
  approval_token: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AgentModelOutput {
  action_summary: Option<String>,
  outputs: Option<Vec<String>>,
  justification: Option<String>,
  estimated_hours: Option<f64>,
  estimated_cost: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentApprovalContext {
  task_title: String,
  irreversible_triggers: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentAdvancedNode {
  node_id: String,
  title: String,
  delta: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentTension {
  node_id: String,
  reason: String,
  weight: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentIntentAlignmentReport {
  advanced_nodes: Vec<AgentAdvancedNode>,
  tensions_activated: Vec<AgentTension>,
  constraints_approached: Vec<String>,
  constraint_breaches: Vec<String>,
  reward: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentExecutionLog {
  id: String,
  task_id: String,
  created_at: String,
  status: String,
  executed_by: String,
  action_summary: String,
  outputs: Vec<String>,
  justification: String,
  estimated_hours: f64,
  estimated_cost: f64,
  intent_alignment_report: AgentIntentAlignmentReport,
  #[serde(skip_serializing_if = "Option::is_none")]
  artifact_path: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  deliverable_paths: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentRunDocumentResponse {
  result_id: String,
  title: String,
  content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentResponse {
  status: String,
  message: String,
  approval_context: Option<AgentApprovalContext>,
  result: Option<AgentExecutionLog>,
  task_confidence_delta: Option<f64>,
  parent_confidence_delta: Option<f64>,
}

#[derive(Debug, Clone, Default)]
struct ConstraintPressure {
  approached: Vec<String>,
  breached: Vec<String>,
}

#[tauri::command]
async fn chat_with_model(
  app: AppHandle,
  state: State<'_, AppState>,
  payload: ChatPayload,
) -> Result<ChatResponse, String> {
  if state.api_key.trim().is_empty() {
    return Err("OPENAI_API_KEY is not configured.".to_string());
  }

  let mut context = load_context(&app)?;
  let response = match payload.phase.as_str() {
    "onboarding" => run_onboarding_turn(&state, &mut context, &payload).await?,
    "workspace" => run_workspace_turn(&state, &mut context, &payload).await?,
    _ => return Err("Invalid phase. Use onboarding or workspace.".to_string()),
  };

  context.updated_at = now_iso();
  save_context(&app, &context)?;
  Ok(response)
}

#[tauri::command]
fn reset_model_context(app: AppHandle) -> Result<Value, String> {
  let fresh = PersistedContext::default();
  save_context(&app, &fresh)?;
  Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn run_agent_task(
  app: AppHandle,
  state: State<'_, AppState>,
  payload: AgentPayload,
) -> Result<AgentResponse, String> {
  if state.api_key.trim().is_empty() {
    return Err("OPENAI_API_KEY is not configured.".to_string());
  }

  let mut context = load_context(&app)?;
  let mut response = run_agent_execution_turn(&state, &mut context, &payload).await?;

  if response.status == "completed" {
    if let Some(result_payload) = response.result.as_mut() {
      match persist_agent_run_artifact(&app, &payload, result_payload) {
        Ok(artifacts) => {
          result_payload.artifact_path = Some(artifacts.deliverables_folder_path);
          result_payload.deliverable_paths = Some(artifacts.deliverable_file_paths);
        }
        Err(err) => {
          response.message = format!("Agent action executed, but artifact save failed: {err}");
        }
      }
    }
  }

  context.updated_at = now_iso();
  save_context(&app, &context)?;
  Ok(response)
}

#[tauri::command]
fn read_agent_run_document(
  app: AppHandle,
  log_id: String,
) -> Result<AgentRunDocumentResponse, String> {
  let normalized_log_id = normalize_log_id(&log_id)?;
  let file_path = resolve_agent_run_document_path(&app, &normalized_log_id)?;
  let content = fs::read_to_string(&file_path)
    .map_err(|e| format!("Failed to read task result document: {e}"))?;

  let title = content
    .lines()
    .find_map(|line| {
      let trimmed = line.trim();
      if trimmed.starts_with("# ") {
        Some(trimmed.trim_start_matches("# ").trim().to_string())
      } else {
        None
      }
    })
    .filter(|value| !value.is_empty())
    .unwrap_or_else(|| "Task Result".to_string());

  Ok(AgentRunDocumentResponse {
    result_id: normalized_log_id,
    title,
    content,
  })
}

#[tauri::command]
fn read_agent_result_document(
  app: AppHandle,
  result_id: String,
) -> Result<AgentRunDocumentResponse, String> {
  read_agent_run_document(app, result_id)
}

async fn run_onboarding_turn(
  state: &AppState,
  context: &mut PersistedContext,
  payload: &ChatPayload,
) -> Result<ChatResponse, String> {
  if let Some(onboarding) = &payload.onboarding {
    if !onboarding.name.trim().is_empty() {
      context.onboarding.name = normalize_name(&onboarding.name);
    }
    let mut profile = onboarding.profile.clone();
    profile.normalize();
    context.onboarding.profile = profile;
  }

  if let Some(message) = payload.message.as_ref().map(|value| value.trim()).filter(|v| !v.is_empty())
  {
    append_turn(
      context,
      "onboarding",
      "user",
      message,
      json!({}),
    );
  }

  let latest_user_message = payload
    .message
    .as_ref()
    .map(|value| value.trim().to_string())
    .unwrap_or_default();
  let user_requested_end = is_end_onboarding_request(&latest_user_message);

  if user_requested_end
    && !context.onboarding.name.trim().is_empty()
    && has_minimum_onboarding_profile(&context.onboarding.profile)
  {
    let reply = format!(
      "Perfect, {}. I have enough context now, so I'll open your graph.",
      context.onboarding.name
    );
    context.onboarding.completed = true;
    append_turn(
      context,
      "onboarding",
      "assistant",
      &reply,
      json!({ "onboardingComplete": true, "reason": "userRequestedFinish" }),
    );
    return Ok(ChatResponse {
      phase: "onboarding".to_string(),
      reply,
      onboarding_complete: Some(true),
      onboarding: Some(OnboardingClientState {
        name: context.onboarding.name.clone(),
        profile: context.onboarding.profile.clone(),
      }),
      graph_updates: None,
    });
  }

  let required_fields = [
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

  let system_prompt = [
    "You are Telos, a probing onboarding model for a personal intent graph product.",
    "You must run onboarding as a dynamic conversation and ask one precise follow-up question at a time.",
    "The first turn should ask for the user's name in natural language.",
    "You should infer fields from freeform answers whenever possible.",
    "Never ask for name again when knownName is already present.",
    "Ask only about fields listed in missingFields and do not re-ask resolved fields.",
    "If missingFields is empty, set onboarding_complete to true and provide a short completion message.",
    "Return strict JSON only with keys: reply, onboarding_complete, name, profile_patch.",
    "profile_patch should contain only newly inferred or refined fields from this turn.",
    "Keep replies concise and natural, no markdown.",
  ]
  .join(" ");

  let missing_fields_before = onboarding_missing_fields(&context.onboarding.profile);
  let history = recent_history(context, "onboarding", 28);
  let user_payload = json!({
    "init": payload.init.unwrap_or(false),
    "latestUserMessage": latest_user_message,
    "knownName": context.onboarding.name,
    "knownProfile": context.onboarding.profile,
    "requiredFields": required_fields,
    "missingFields": missing_fields_before,
    "instruction": "Continue onboarding until enough context is gathered."
  });

  let model_json =
    call_openai_json(state, &system_prompt, history, user_payload, ReasoningEffort::None).await?;
  let output = parse_onboarding_model_output(&model_json);

  if let Some(name) = output.name {
    let normalized = normalize_name(&name);
    if !normalized.is_empty() {
      context.onboarding.name = normalized;
    }
  }

  if let Some(patch) = output.profile_patch {
    context.onboarding.profile.apply_patch(patch);
  }

  let missing_fields_after = onboarding_missing_fields(&context.onboarding.profile);
  let mut onboarding_complete = output.onboarding_complete.unwrap_or(false);
  if !context.onboarding.name.trim().is_empty() && missing_fields_after.is_empty() {
    onboarding_complete = true;
  }
  if user_requested_end && !context.onboarding.name.trim().is_empty() {
    onboarding_complete = true;
  }
  context.onboarding.completed = onboarding_complete;

  let draft_reply = output
    .reply
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
    .unwrap_or_else(|| "Tell me a bit more so I can build your intent graph.".to_string());
  let reply = sanitize_onboarding_reply(
    context,
    &draft_reply,
    &missing_fields_after,
    onboarding_complete,
  );

  append_turn(
    context,
    "onboarding",
    "assistant",
    &reply,
    json!({ "onboardingComplete": onboarding_complete }),
  );

  Ok(ChatResponse {
    phase: "onboarding".to_string(),
    reply,
    onboarding_complete: Some(onboarding_complete),
    onboarding: Some(OnboardingClientState {
      name: context.onboarding.name.clone(),
      profile: context.onboarding.profile.clone(),
    }),
    graph_updates: None,
  })
}

async fn run_workspace_turn(
  state: &AppState,
  context: &mut PersistedContext,
  payload: &ChatPayload,
) -> Result<ChatResponse, String> {
  let message = payload
    .message
    .as_ref()
    .map(|value| value.trim())
    .filter(|value| !value.is_empty())
    .ok_or_else(|| "Workspace message is required.".to_string())?;

  append_turn(context, "workspace", "user", message, json!({}));

  let profile = payload.profile.clone().unwrap_or_default();
  let selected_node = payload.selected_node.clone().unwrap_or_default();
  let graph_context = payload.graph_context.clone().unwrap_or_default();

  let system_prompt = [
    "You are Telos, a goal-aware personal AI assistant.",
    "Ground responses in long-horizon goals, constraints, and relationships.",
    "Be concise, practical, and action-oriented.",
    "Return strict JSON only with keys: reply, memory_note, graph_updates.",
    "graph_updates must be an array of objects using this schema: { op, title, parent_goal, parent_action, description }.",
    "Allowed op values: add_speed2_goal, add_speed1_action, add_attached_task.",
    "Use clean capitalization for titles.",
    "Goals must be distinct from identity labels (never copy the identity string).",
    "Actions must be concrete execution steps and must not copy the parent Goal text.",
    "Attached tasks must be specific and actionable with explicit scope/output (for example a list/table/brief and count).",
    "Use graph_updates when the user asks to add/create/include more goals, actions, or attached tasks.",
    "If no graph mutation is requested, return graph_updates as an empty array.",
    "No markdown.",
  ]
  .join(" ");

  let history = recent_history(context, "workspace", 20);
  let user_payload = json!({
    "latestUserMessage": message,
    "profile": profile,
    "selectedNode": selected_node,
    "graphContext": graph_context
  });

  let model_json =
    call_openai_json(state, &system_prompt, history, user_payload, ReasoningEffort::None).await?;
  let output = parse_workspace_model_output(&model_json);
  let graph_updates = output
    .graph_updates
    .into_iter()
    .filter(|entry| !entry.title.trim().is_empty())
    .take(8)
    .collect::<Vec<WorkspaceGraphUpdate>>();

  let reply = output
    .reply
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
    .unwrap_or_else(|| "Share one specific goal and I will propose a next action.".to_string());

  if let Some(note) = output.memory_note.map(|value| value.trim().to_string()) {
    if !note.is_empty() {
      context.memory_notes.push(MemoryNote {
        created_at: now_iso(),
        note,
      });
      if context.memory_notes.len() > 200 {
        context.memory_notes = context.memory_notes.split_off(context.memory_notes.len() - 200);
      }
    }
  }

  append_turn(
    context,
    "workspace",
    "assistant",
    &reply,
    json!({ "graphUpdates": graph_updates }),
  );

  Ok(ChatResponse {
    phase: "workspace".to_string(),
    reply,
    onboarding_complete: None,
    onboarding: None,
    graph_updates: if graph_updates.is_empty() {
      None
    } else {
      Some(graph_updates)
    },
  })
}

async fn run_agent_execution_turn(
  state: &AppState,
  context: &mut PersistedContext,
  payload: &AgentPayload,
) -> Result<AgentResponse, String> {
  if payload.task.id != payload.task_id {
    return Ok(AgentResponse {
      status: "error".to_string(),
      message: "Task payload mismatch.".to_string(),
      approval_context: None,
      result: None,
      task_confidence_delta: None,
      parent_confidence_delta: None,
    });
  }

  if payload.task.r#type.trim() != "speed1" {
    return Ok(AgentResponse {
      status: "error".to_string(),
      message: format!(
        "Only Actions are executable. Node type is {}.",
        payload.task.r#type
      ),
      approval_context: None,
      result: None,
      task_confidence_delta: None,
      parent_confidence_delta: None,
    });
  }

  if payload.task.execution_mode.trim() == "Human" {
    return Ok(AgentResponse {
      status: "blocked".to_string(),
      message: "Task is labeled Human-executable and cannot be fully automated.".to_string(),
      approval_context: None,
      result: None,
      task_confidence_delta: None,
      parent_confidence_delta: None,
    });
  }

  let requested_action = payload.requested_action.as_deref().unwrap_or("");

  if let Some(reason) = agent_execution_block_reason(&payload.task, requested_action) {
    return Ok(AgentResponse {
      status: "blocked".to_string(),
      message: reason,
      approval_context: None,
      result: None,
      task_confidence_delta: None,
      parent_confidence_delta: None,
    });
  }

  let needs_approval =
    detect_irreversible_action(&payload.task.title, &payload.task.description, requested_action);
  let approval_token = payload.approval_token.unwrap_or(false);

  if needs_approval && !approval_token {
    return Ok(AgentResponse {
      status: "needs_approval".to_string(),
      message: "Task appears to involve an irreversible action. Explicit confirmation is required."
        .to_string(),
      approval_context: Some(AgentApprovalContext {
        task_title: payload.task.title.clone(),
        irreversible_triggers: triggered_irreversible_keywords(
          &payload.task.title,
          &payload.task.description,
          requested_action,
        ),
      }),
      result: None,
      task_confidence_delta: None,
      parent_confidence_delta: None,
    });
  }

  let run_subject = if requested_action.trim().is_empty() {
    payload.task.title.clone()
  } else {
    requested_action.to_string()
  };
  append_turn(
    context,
    "agent",
    "user",
    &format!("Run task: {run_subject}"),
    json!({
      "taskId": payload.task_id,
      "executionMode": payload.task.execution_mode,
      "approvalToken": approval_token
    }),
  );

  let system_prompt = [
    "You are the Telos execution agent for Actions.",
    "Given task + profile context, produce realistic execution output.",
    "Do not mention being unable to execute; provide a practical completion summary.",
    "Return strict JSON only with keys: action_summary, outputs, justification, estimated_hours, estimated_cost.",
    "outputs should be a short array of concrete deliverables.",
    "Keep all strings concise and avoid markdown.",
  ]
  .join(" ");

  let history = recent_history(context, "agent", 12);
  let user_payload = json!({
    "task": {
      "id": payload.task.id,
      "title": payload.task.title,
      "description": payload.task.description,
      "status": payload.task.status,
      "executionMode": payload.task.execution_mode
    },
    "parentTask": payload.parent_task.clone(),
    "profile": payload.profile.clone().unwrap_or_default(),
    "requestedAction": requested_action,
    "instruction": "Return one task result that can be stored."
  });

  let reasoning_effort = if approval_token {
    ReasoningEffort::Medium
  } else {
    ReasoningEffort::Low
  };
  let model_json =
    call_openai_json(state, &system_prompt, history, user_payload, reasoning_effort).await?;
  let output = parse_agent_model_output(&model_json);

  let action_summary = output
    .action_summary
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
    .unwrap_or_else(|| {
      "Drafted an execution-ready plan and completed the next concrete step.".to_string()
    });

  let outputs = output
    .outputs
    .unwrap_or_default()
    .into_iter()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
    .take(6)
    .collect::<Vec<String>>();
  let outputs = if outputs.is_empty() {
    vec![
      "Primary deliverable completed".to_string(),
      "Next-step checklist generated".to_string(),
    ]
  } else {
    outputs
  };

  let justification = output
    .justification
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
    .unwrap_or_else(|| {
      if let Some(parent) = payload.parent_task.as_ref() {
        format!(
          "Execution advanced the Action while supporting the parent Goal \"{}\".",
          parent.title
        )
      } else {
        "Execution advanced the Action and reduced ambiguity.".to_string()
      }
    });

  let estimated_hours = round3(output.estimated_hours.unwrap_or(2.0).max(0.0));
  let estimated_cost = round3(output.estimated_cost.unwrap_or(0.0).max(0.0));

  let constraints = parse_constraints(payload.profile.as_ref());
  let pressure = evaluate_constraint_pressure(&constraints, estimated_hours, estimated_cost);
  let tensions_activated = payload
    .task
    .conflicts
    .clone()
    .unwrap_or_default()
    .into_iter()
    .map(|entry| AgentTension {
      node_id: entry.node_id,
      reason: entry.reason.unwrap_or_else(|| "Conflict activated".to_string()),
      weight: clamp_f64(entry.weight.unwrap_or(0.2), 0.0, 1.0),
    })
    .collect::<Vec<AgentTension>>();

  let task_delta = if payload.task.execution_mode == "Hybrid" {
    0.18
  } else {
    0.24
  };

  let mut advanced_nodes = vec![AgentAdvancedNode {
    node_id: payload.task.id.clone(),
    title: payload.task.title.clone(),
    delta: round3(task_delta),
  }];

  if let Some(parent) = payload.parent_task.as_ref() {
    advanced_nodes.push(AgentAdvancedNode {
      node_id: parent.id.clone(),
      title: parent.title.clone(),
      delta: 0.1,
    });
  }

  let task_priority = clamp_f64(payload.task.priority_weight.unwrap_or(0.5), 0.05, 1.0);
  let parent_priority = payload
    .parent_task
    .as_ref()
    .map(|node| clamp_f64(node.priority_weight.unwrap_or(0.5), 0.05, 1.0))
    .unwrap_or(0.0);

  let progress_score = task_delta * task_priority + if parent_priority > 0.0 { 0.1 * parent_priority } else { 0.0 };
  let tension_penalty = tensions_activated.iter().map(|entry| entry.weight).sum::<f64>();
  let approach_penalty = pressure.approached.len() as f64 * 0.15;
  let breach_penalty = pressure.breached.len() as f64 * 0.8;
  let reward = round3(progress_score - tension_penalty - approach_penalty - breach_penalty);

  let result_payload = AgentExecutionLog {
    id: generate_id("result"),
    task_id: payload.task_id.clone(),
    created_at: now_iso(),
    status: "completed".to_string(),
    executed_by: "telos-agent-1".to_string(),
    action_summary: action_summary.clone(),
    outputs,
    justification,
    estimated_hours,
    estimated_cost,
    intent_alignment_report: AgentIntentAlignmentReport {
      advanced_nodes: advanced_nodes.clone(),
      tensions_activated,
      constraints_approached: pressure.approached,
      constraint_breaches: pressure.breached,
      reward,
    },
    artifact_path: None,
    deliverable_paths: None,
  };

  append_turn(
    context,
    "agent",
    "assistant",
    &action_summary,
    json!({
      "taskId": payload.task_id,
      "status": "completed",
      "reasoningEffort": reasoning_effort.as_str(),
      "reward": reward
    }),
  );

  Ok(AgentResponse {
    status: "completed".to_string(),
    message: "Agent action executed successfully.".to_string(),
    approval_context: None,
    result: Some(result_payload),
    task_confidence_delta: Some(0.08),
    parent_confidence_delta: Some(0.03),
  })
}

async fn call_openai_json(
  state: &AppState,
  system_prompt: &str,
  history: Vec<ConversationTurn>,
  user_payload: Value,
  reasoning_effort: ReasoningEffort,
) -> Result<Value, String> {
  let mut input = vec![json!({
    "role": "system",
    "content": [{ "type": "input_text", "text": system_prompt }]
  })];

  for turn in history {
    let role = if turn.role == "assistant" {
      "assistant"
    } else {
      "user"
    };
    let content_type = if role == "assistant" {
      "output_text"
    } else {
      "input_text"
    };
    input.push(json!({
      "role": role,
      "content": [{ "type": content_type, "text": turn.content }]
    }));
  }

  input.push(json!({
    "role": "user",
    "content": [{ "type": "input_text", "text": user_payload.to_string() }]
  }));

  let request_body = json!({
    "model": state.model,
    "reasoning": { "effort": reasoning_effort.as_str() },
    "text": { "format": { "type": "json_object" } },
    "input": input
  });

  let response = state
    .client
    .post(OPENAI_RESPONSES_URL)
    .bearer_auth(&state.api_key)
    .json(&request_body)
    .send()
    .await
    .map_err(|e| format!("OpenAI request failed: {e}"))?;

  let status = response.status();
  let body = response
    .text()
    .await
    .map_err(|e| format!("OpenAI response read failed: {e}"))?;

  if !status.is_success() {
    return Err(format!("OpenAI error ({status}): {body}"));
  }

  let parsed: Value =
    serde_json::from_str(&body).map_err(|e| format!("OpenAI JSON parse failed: {e}"))?;
  let content = extract_openai_output_text(&parsed)
    .ok_or_else(|| "OpenAI response missing message content.".to_string())?;

  match serde_json::from_str::<Value>(&content) {
    Ok(json) => Ok(json),
    Err(_) => {
      let extracted = extract_json_object(&content).ok_or_else(|| {
        "Model output was not valid JSON and no JSON object could be extracted.".to_string()
      })?;
      serde_json::from_str::<Value>(&extracted)
        .map_err(|e| format!("Extracted JSON parse failed: {e}"))
    }
  }
}

fn recent_history(context: &PersistedContext, phase: &str, limit: usize) -> Vec<ConversationTurn> {
  let filtered: Vec<ConversationTurn> = context
    .conversations
    .iter()
    .filter(|turn| turn.phase == phase)
    .cloned()
    .collect();
  let start = filtered.len().saturating_sub(limit);
  filtered[start..].to_vec()
}

fn append_turn(context: &mut PersistedContext, phase: &str, role: &str, content: &str, metadata: Value) {
  context.conversations.push(ConversationTurn {
    id: generate_id("turn"),
    timestamp: now_iso(),
    phase: phase.to_string(),
    role: role.to_string(),
    content: content.to_string(),
    metadata,
  });
  if context.conversations.len() > 2500 {
    context.conversations = context
      .conversations
      .split_off(context.conversations.len().saturating_sub(2500));
  }
}

fn parse_onboarding_model_output(model_json: &Value) -> OnboardingModelOutput {
  let Some(obj) = model_json.as_object() else {
    return OnboardingModelOutput::default();
  };

  OnboardingModelOutput {
    reply: value_by_keys(obj, &["reply"]).and_then(normalize_string_value),
    onboarding_complete: value_by_keys(
      obj,
      &["onboarding_complete", "onboardingComplete", "complete"],
    )
    .and_then(normalize_bool_value),
    name: value_by_keys(obj, &["name"]).and_then(normalize_string_value),
    profile_patch: value_by_keys(obj, &["profile_patch", "profilePatch"]).and_then(parse_profile_patch),
  }
}

fn parse_workspace_model_output(model_json: &Value) -> WorkspaceModelOutput {
  let Some(obj) = model_json.as_object() else {
    return WorkspaceModelOutput::default();
  };

  WorkspaceModelOutput {
    reply: value_by_keys(obj, &["reply"]).and_then(normalize_string_value),
    memory_note: value_by_keys(obj, &["memory_note", "memoryNote"]).and_then(normalize_string_value),
    graph_updates: value_by_keys(obj, &["graph_updates", "graphUpdates", "updates"])
      .and_then(parse_workspace_graph_updates)
      .unwrap_or_default(),
  }
}

fn parse_agent_model_output(model_json: &Value) -> AgentModelOutput {
  let Some(obj) = model_json.as_object() else {
    return AgentModelOutput::default();
  };

  let outputs = value_by_keys(obj, &["outputs"]).and_then(normalize_string_list_value);

  AgentModelOutput {
    action_summary: value_by_keys(obj, &["action_summary", "actionSummary"])
      .and_then(normalize_string_value),
    outputs,
    justification: value_by_keys(obj, &["justification"]).and_then(normalize_string_value),
    estimated_hours: value_by_keys(obj, &["estimated_hours", "estimatedHours"])
      .and_then(normalize_f64_value),
    estimated_cost: value_by_keys(obj, &["estimated_cost", "estimatedCost"])
      .and_then(normalize_f64_value),
  }
}

fn normalize_workspace_graph_op(raw: &str) -> Option<String> {
  let normalized = raw
    .trim()
    .to_lowercase()
    .replace('-', "_")
    .replace(' ', "_");

  match normalized.as_str() {
    "add_speed2_goal" | "add_goal" | "add_long_goal" | "add_long_horizon_goal" | "new_goal" => {
      Some("add_speed2_goal".to_string())
    }
    "add_speed1_action"
    | "add_action"
    | "add_task_action"
    | "add_speed1"
    | "new_action" => Some("add_speed1_action".to_string()),
    "add_attached_task"
    | "add_checklist_item"
    | "add_checklist_task"
    | "add_task"
    | "new_task" => Some("add_attached_task".to_string()),
    _ => None,
  }
}

fn parse_workspace_graph_update(value: &Value) -> Option<WorkspaceGraphUpdate> {
  let obj = value.as_object()?;
  let op_raw = value_by_keys(obj, &["op", "operation", "type", "kind"])
    .and_then(normalize_string_value)?;
  let op = normalize_workspace_graph_op(&op_raw)?;
  let title = value_by_keys(
    obj,
    &["title", "node_title", "nodeTitle", "actionTitle", "taskTitle", "text"],
  )
  .and_then(normalize_string_value)?;
  let trimmed_title = title.trim().to_string();
  if trimmed_title.is_empty() {
    return None;
  }

  Some(WorkspaceGraphUpdate {
    op,
    title: trimmed_title,
    parent_goal: value_by_keys(obj, &["parent_goal", "parentGoal", "goal", "goalTitle"])
      .and_then(normalize_string_value),
    parent_action: value_by_keys(
      obj,
      &["parent_action", "parentAction", "action", "actionTitle", "task", "taskTitle"],
    )
    .and_then(normalize_string_value),
    description: value_by_keys(obj, &["description", "details", "note", "reason"])
      .and_then(normalize_string_value),
  })
}

fn parse_workspace_graph_updates(value: &Value) -> Option<Vec<WorkspaceGraphUpdate>> {
  let mut updates = vec![];
  match value {
    Value::Array(items) => {
      for item in items {
        if let Some(parsed) = parse_workspace_graph_update(item) {
          updates.push(parsed);
        }
      }
    }
    _ => {
      if let Some(parsed) = parse_workspace_graph_update(value) {
        updates.push(parsed);
      }
    }
  }

  if updates.is_empty() {
    None
  } else {
    Some(updates.into_iter().take(8).collect())
  }
}

fn parse_profile_patch(value: &Value) -> Option<ProfilePatch> {
  let obj = value.as_object()?;
  let patch = ProfilePatch {
    about_yourself: value_by_keys(obj, &["aboutYourself", "about_yourself"])
      .and_then(normalize_string_value),
    roles: value_by_keys(obj, &["roles"]).and_then(normalize_string_value),
    current_priorities: value_by_keys(obj, &["currentPriorities", "current_priorities"])
      .and_then(normalize_string_value),
    long_term_ambitions: value_by_keys(obj, &["longTermAmbitions", "long_term_ambitions"])
      .and_then(normalize_string_value),
    values: value_by_keys(obj, &["values"]).and_then(normalize_string_value),
    constraints: value_by_keys(obj, &["constraints"]).and_then(normalize_string_value),
    relationships: value_by_keys(obj, &["relationships"]).and_then(normalize_string_value),
    tensions: value_by_keys(obj, &["tensions"]).and_then(normalize_string_value),
    risk_tolerance: value_by_keys(obj, &["riskTolerance", "risk_tolerance"])
      .and_then(normalize_string_value),
    work_style: value_by_keys(obj, &["workStyle", "work_style"]).and_then(normalize_string_value),
    creative_aspirations: value_by_keys(obj, &["creativeAspirations", "creative_aspirations"])
      .and_then(normalize_string_value),
  };

  if patch.about_yourself.is_none()
    && patch.roles.is_none()
    && patch.current_priorities.is_none()
    && patch.long_term_ambitions.is_none()
    && patch.values.is_none()
    && patch.constraints.is_none()
    && patch.relationships.is_none()
    && patch.tensions.is_none()
    && patch.risk_tolerance.is_none()
    && patch.work_style.is_none()
    && patch.creative_aspirations.is_none()
  {
    None
  } else {
    Some(patch)
  }
}

fn value_by_keys<'a>(obj: &'a serde_json::Map<String, Value>, keys: &[&str]) -> Option<&'a Value> {
  for key in keys {
    if let Some(value) = obj.get(*key) {
      return Some(value);
    }
  }
  None
}

fn normalize_string_value(value: &Value) -> Option<String> {
  match value {
    Value::String(text) => {
      let trimmed = text.trim();
      if trimmed.is_empty() {
        None
      } else {
        Some(trimmed.to_string())
      }
    }
    Value::Array(items) => {
      let parts = items
        .iter()
        .filter_map(normalize_string_value)
        .filter(|item| !item.is_empty())
        .collect::<Vec<String>>();
      if parts.is_empty() {
        None
      } else {
        Some(parts.join(", "))
      }
    }
    Value::Number(number) => Some(number.to_string()),
    Value::Bool(boolean) => Some(boolean.to_string()),
    Value::Object(obj) => value_by_keys(obj, &["text", "output_text"]).and_then(normalize_string_value),
    Value::Null => None,
  }
}

fn normalize_string_list_value(value: &Value) -> Option<Vec<String>> {
  match value {
    Value::Array(items) => {
      let values = items
        .iter()
        .filter_map(normalize_string_value)
        .filter(|item| !item.is_empty())
        .collect::<Vec<String>>();
      if values.is_empty() {
        None
      } else {
        Some(values)
      }
    }
    _ => normalize_string_value(value).map(|item| vec![item]),
  }
}

fn normalize_bool_value(value: &Value) -> Option<bool> {
  match value {
    Value::Bool(boolean) => Some(*boolean),
    Value::Number(number) => number.as_i64().map(|entry| entry != 0),
    Value::String(text) => match text.trim().to_lowercase().as_str() {
      "true" | "yes" | "1" => Some(true),
      "false" | "no" | "0" => Some(false),
      _ => None,
    },
    _ => None,
  }
}

fn normalize_f64_value(value: &Value) -> Option<f64> {
  match value {
    Value::Number(number) => number.as_f64(),
    Value::String(text) => text.trim().parse::<f64>().ok(),
    Value::Bool(boolean) => Some(if *boolean { 1.0 } else { 0.0 }),
    _ => None,
  }
}

fn onboarding_missing_fields(profile: &ProfileSnapshot) -> Vec<&'static str> {
  let checks: [(&'static str, &str); 11] = [
    ("aboutYourself", profile.about_yourself.trim()),
    ("roles", profile.roles.trim()),
    ("currentPriorities", profile.current_priorities.trim()),
    ("longTermAmbitions", profile.long_term_ambitions.trim()),
    ("values", profile.values.trim()),
    ("constraints", profile.constraints.trim()),
    ("relationships", profile.relationships.trim()),
    ("tensions", profile.tensions.trim()),
    ("riskTolerance", profile.risk_tolerance.trim()),
    ("workStyle", profile.work_style.trim()),
    ("creativeAspirations", profile.creative_aspirations.trim()),
  ];

  checks
    .iter()
    .filter_map(|(field, value)| if value.is_empty() { Some(*field) } else { None })
    .collect()
}

fn has_minimum_onboarding_profile(profile: &ProfileSnapshot) -> bool {
  let checks: [&str; 11] = [
    profile.about_yourself.trim(),
    profile.roles.trim(),
    profile.current_priorities.trim(),
    profile.long_term_ambitions.trim(),
    profile.values.trim(),
    profile.constraints.trim(),
    profile.relationships.trim(),
    profile.tensions.trim(),
    profile.risk_tolerance.trim(),
    profile.work_style.trim(),
    profile.creative_aspirations.trim(),
  ];
  checks.iter().filter(|value| !value.is_empty()).count() >= 4
}

fn is_end_onboarding_request(message: &str) -> bool {
  let normalized = message.trim().to_lowercase();
  if normalized.is_empty() {
    return false;
  }
  let triggers = [
    "end onboarding",
    "finish onboarding",
    "done onboarding",
    "complete onboarding",
    "skip onboarding",
  ];
  triggers.iter().any(|trigger| normalized.contains(trigger))
}

fn looks_like_name_prompt(text: &str) -> bool {
  let normalized = text.trim().to_lowercase();
  let patterns = [
    "what should i call you",
    "what's your name",
    "what is your name",
    "your name",
    "preferred nickname",
  ];
  patterns.iter().any(|pattern| normalized.contains(pattern))
}

fn normalize_comparable_text(raw: &str) -> String {
  raw
    .to_lowercase()
    .chars()
    .map(|ch| {
      if ch.is_ascii_alphanumeric() || ch.is_ascii_whitespace() {
        ch
      } else {
        ' '
      }
    })
    .collect::<String>()
    .split_whitespace()
    .collect::<Vec<&str>>()
    .join(" ")
}

fn is_repeated_onboarding_reply(context: &PersistedContext, candidate: &str) -> bool {
  let Some(last_reply) = context
    .conversations
    .iter()
    .rev()
    .find(|turn| turn.phase == "onboarding" && turn.role == "assistant")
    .map(|turn| turn.content.as_str())
  else {
    return false;
  };

  normalize_comparable_text(last_reply) == normalize_comparable_text(candidate)
}

fn onboarding_follow_up_prompt(field: &str) -> &'static str {
  match field {
    "aboutYourself" => "In one sentence, what should I know about you right now?",
    "roles" => "What are your main roles right now (1-3)?",
    "currentPriorities" => "What are your top 2-3 priorities right now?",
    "longTermAmbitions" => "What is your long-term ambition in one sentence?",
    "values" => "What 3-5 values do you want to optimize for?",
    "constraints" => "What are your biggest constraints right now (time, money, energy)?",
    "relationships" => "Who are the most important people or groups this should account for?",
    "tensions" => "What recurring tradeoff do you most want help managing?",
    "riskTolerance" => "What's your risk tolerance right now: conservative, balanced, or aggressive?",
    "workStyle" => "What work style helps you perform best?",
    "creativeAspirations" => "Any creative aspiration you want represented in your graph?",
    _ => "Tell me one more detail that's important for your planning context.",
  }
}

fn fallback_onboarding_reply(
  known_name: &str,
  missing_fields: &[&'static str],
  onboarding_complete: bool,
) -> String {
  if onboarding_complete || missing_fields.is_empty() {
    if known_name.trim().is_empty() {
      return "Great, I have enough context now. I'll open your graph.".to_string();
    }
    return format!(
      "Great, {}. I have enough context now, so I'll open your graph.",
      known_name
    );
  }

  let prompt = onboarding_follow_up_prompt(missing_fields[0]);
  if known_name.trim().is_empty() {
    prompt.to_string()
  } else {
    format!("Thanks, {}. {}", known_name, prompt)
  }
}

fn sanitize_onboarding_reply(
  context: &PersistedContext,
  draft_reply: &str,
  missing_fields: &[&'static str],
  onboarding_complete: bool,
) -> String {
  let cleaned = draft_reply.trim();
  if cleaned.is_empty() {
    return fallback_onboarding_reply(&context.onboarding.name, missing_fields, onboarding_complete);
  }

  if onboarding_complete && cleaned.ends_with('?') {
    return fallback_onboarding_reply(&context.onboarding.name, missing_fields, true);
  }

  if !context.onboarding.name.trim().is_empty() && looks_like_name_prompt(cleaned) {
    return fallback_onboarding_reply(&context.onboarding.name, missing_fields, onboarding_complete);
  }

  if is_repeated_onboarding_reply(context, cleaned) {
    return fallback_onboarding_reply(&context.onboarding.name, missing_fields, onboarding_complete);
  }

  cleaned.to_string()
}

fn is_word_char(ch: char) -> bool {
  ch.is_ascii_alphanumeric() || ch == '_'
}

fn contains_term_with_boundaries(text: &str, term: &str) -> bool {
  let needle = term.trim();
  if needle.is_empty() {
    return false;
  }

  let mut offset = 0usize;
  while let Some(relative_idx) = text[offset..].find(needle) {
    let idx = offset + relative_idx;
    let end_idx = idx + needle.len();

    let starts_word = needle
      .chars()
      .next()
      .map(is_word_char)
      .unwrap_or(false);
    let ends_word = needle
      .chars()
      .last()
      .map(is_word_char)
      .unwrap_or(false);

    let before = if idx == 0 {
      None
    } else {
      text[..idx].chars().next_back()
    };
    let after = if end_idx >= text.len() {
      None
    } else {
      text[end_idx..].chars().next()
    };

    let before_ok = !starts_word || before.map(|ch| !is_word_char(ch)).unwrap_or(true);
    let after_ok = !ends_word || after.map(|ch| !is_word_char(ch)).unwrap_or(true);
    if before_ok && after_ok {
      return true;
    }

    offset = end_idx;
    if offset >= text.len() {
      break;
    }
  }

  false
}

fn agent_execution_block_reason(task: &AgentNodeInput, requested_action: &str) -> Option<String> {
  let mode = task.execution_mode.trim();
  if mode != "Agent" && mode != "Hybrid" {
    return Some("Only Agent or Hybrid execution modes can run agent actions.".to_string());
  }

  let normalized_text = if requested_action.trim().is_empty() {
    format!(
      "{} {}",
      task.title.to_lowercase(),
      task.description.to_lowercase()
    )
  } else {
    requested_action.to_lowercase()
  };

  let has_allow_signal = AGENT_EXECUTABLE_ALLOW_TERMS
    .iter()
    .any(|term| contains_term_with_boundaries(&normalized_text, term));
  if !has_allow_signal {
    return Some(
      "Agent runs are reserved for specific online research and synthesis tasks.".to_string(),
    );
  }

  let has_study_materials = contains_term_with_boundaries(&normalized_text, "study material")
    || contains_term_with_boundaries(&normalized_text, "study materials");
  let has_block_signal = AGENT_EXECUTABLE_BLOCK_TERMS.iter().any(|term| {
    if *term == "study" && has_study_materials {
      return false;
    }
    contains_term_with_boundaries(&normalized_text, term)
  });
  if has_block_signal {
    return Some("This task appears to require human or real-world execution steps.".to_string());
  }

  if !has_strict_agent_specificity(&normalized_text) {
    return Some(
      "Agent tasks must be specific and actionable: include a concrete action, clear scope, and expected output."
        .to_string(),
    );
  }

  None
}

fn has_strict_agent_specificity(normalized_text: &str) -> bool {
  let word_count = normalized_text
    .split_whitespace()
    .filter(|token| !token.trim().is_empty())
    .count();
  if word_count < 6 {
    return false;
  }

  let has_action_signal = AGENT_EXECUTABLE_ACTION_TERMS
    .iter()
    .any(|term| contains_term_with_boundaries(normalized_text, term));
  if !has_action_signal {
    return false;
  }

  let has_scope_signal = AGENT_EXECUTABLE_SCOPE_TERMS
    .iter()
    .any(|term| contains_term_with_boundaries(normalized_text, term));
  let has_output_signal = AGENT_EXECUTABLE_OUTPUT_TERMS
    .iter()
    .any(|term| contains_term_with_boundaries(normalized_text, term));
  let has_numeric_scope = normalized_text
    .split_whitespace()
    .any(|token| token.chars().any(|ch| ch.is_ascii_digit()));

  has_scope_signal || has_output_signal || has_numeric_scope
}

fn detect_irreversible_action(task_title: &str, task_description: &str, requested_action: &str) -> bool {
  let combined = if requested_action.trim().is_empty() {
    format!(
      "{} {}",
      task_title.to_lowercase(),
      task_description.to_lowercase()
    )
  } else {
    requested_action.to_lowercase()
  };
  IRREVERSIBLE_KEYWORDS
    .iter()
    .any(|keyword| combined.contains(keyword))
}

fn triggered_irreversible_keywords(
  task_title: &str,
  task_description: &str,
  requested_action: &str,
) -> Vec<String> {
  let combined = if requested_action.trim().is_empty() {
    format!(
      "{} {}",
      task_title.to_lowercase(),
      task_description.to_lowercase()
    )
  } else {
    requested_action.to_lowercase()
  };
  IRREVERSIBLE_KEYWORDS
    .iter()
    .filter(|keyword| combined.contains(**keyword))
    .map(|keyword| keyword.to_string())
    .collect()
}

fn parse_constraints(profile: Option<&ProfileSnapshot>) -> Vec<String> {
  profile
    .map(|value| {
      value
        .constraints
        .split(|ch| ch == ',' || ch == ';' || ch == '\n')
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
        .collect::<Vec<String>>()
    })
    .unwrap_or_default()
}

fn evaluate_constraint_pressure(
  constraints: &[String],
  estimated_hours: f64,
  estimated_cost: f64,
) -> ConstraintPressure {
  let mut pressure = ConstraintPressure::default();
  for raw_constraint in constraints {
    let constraint = raw_constraint.to_lowercase();
    if let Some(number) = extract_first_number(&constraint) {
      if constraint.contains("hour") || constraint.contains("hrs") || constraint.contains("hr") {
        if estimated_hours > number {
          pressure.breached.push(raw_constraint.clone());
          continue;
        }
        if estimated_hours > number * 0.75 {
          pressure.approached.push(raw_constraint.clone());
          continue;
        }
      }

      if constraint.contains("budget")
        || constraint.contains("cost")
        || constraint.contains("spend")
        || constraint.contains("usd")
        || constraint.contains("dollar")
        || constraint.contains('$')
      {
        if estimated_cost > number {
          pressure.breached.push(raw_constraint.clone());
          continue;
        }
        if estimated_cost > number * 0.75 {
          pressure.approached.push(raw_constraint.clone());
          continue;
        }
      }
    }

    if (constraint.contains("no purchases") || constraint.contains("do not spend"))
      && estimated_cost > 0.0
    {
      pressure.breached.push(raw_constraint.clone());
    }
  }

  pressure
}

fn extract_first_number(input: &str) -> Option<f64> {
  let mut current = String::new();
  for ch in input.chars() {
    if ch.is_ascii_digit() || ch == '.' {
      current.push(ch);
      continue;
    }
    if !current.is_empty() {
      break;
    }
  }
  if current.is_empty() {
    return None;
  }
  current.parse::<f64>().ok()
}

fn clamp_f64(value: f64, min: f64, max: f64) -> f64 {
  value.max(min).min(max)
}

fn round3(value: f64) -> f64 {
  (value * 1000.0).round() / 1000.0
}

fn extract_openai_output_text(parsed: &Value) -> Option<String> {
  if let Some(primary) = parsed.get("output_text").and_then(normalize_string_value) {
    if !primary.is_empty() {
      return Some(primary);
    }
  }

  let output_entries = parsed.get("output").and_then(|value| value.as_array())?;
  for entry in output_entries {
    if let Some(content_parts) = entry.get("content").and_then(|value| value.as_array()) {
      for part in content_parts {
        if let Some(text) = part.get("text").and_then(normalize_string_value) {
          if !text.is_empty() {
            return Some(text);
          }
        }
        if let Some(text) = part.get("output_text").and_then(normalize_string_value) {
          if !text.is_empty() {
            return Some(text);
          }
        }
        if let Some(refusal) = part.get("refusal").and_then(normalize_string_value) {
          if !refusal.is_empty() {
            return Some(format!("{{\"reply\":\"{}\"}}", refusal.replace('"', "'")));
          }
        }
      }
    }
  }
  None
}

fn normalize_name(raw: &str) -> String {
  let cleaned = raw
    .chars()
    .map(|ch| if ch.is_alphabetic() || ch == ' ' || ch == '\'' || ch == '-' { ch } else { ' ' })
    .collect::<String>();
  cleaned
    .split_whitespace()
    .take(3)
    .map(capitalize_token)
    .collect::<Vec<String>>()
    .join(" ")
}

fn capitalize_token(token: &str) -> String {
  let mut chars = token.chars();
  match chars.next() {
    Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str().to_lowercase()),
    None => String::new(),
  }
}

fn generate_id(prefix: &str) -> String {
  let nanos = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_nanos();
  format!("{prefix}_{nanos}")
}

fn now_iso() -> String {
  Utc::now().to_rfc3339()
}

fn context_path(app: &AppHandle) -> Result<PathBuf, String> {
  let base_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  let context_dir = base_dir.join("context");
  fs::create_dir_all(&context_dir)
    .map_err(|e| format!("Failed to create context directory: {e}"))?;
  Ok(context_dir.join("context.json"))
}

fn agent_runs_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let context_file = context_path(app)?;
  let context_dir = context_file
    .parent()
    .ok_or_else(|| "Failed to resolve context directory.".to_string())?;
  let runs_dir = context_dir.join("agent_runs");
  fs::create_dir_all(&runs_dir)
    .map_err(|e| format!("Failed to create agent runs directory: {e}"))?;
  Ok(runs_dir)
}

fn sanitize_filename_component(raw: &str, fallback: &str) -> String {
  let normalized = raw
    .to_lowercase()
    .chars()
    .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
    .collect::<String>()
    .split('-')
    .filter(|chunk| !chunk.is_empty())
    .collect::<Vec<&str>>()
    .join("-");
  if normalized.is_empty() {
    fallback.to_string()
  } else {
    normalized.chars().take(48).collect::<String>()
  }
}

fn readable_run_stamp() -> String {
  Utc::now().format("%Y-%m-%d_%H-%M").to_string()
}

fn next_available_child_path(parent: &Path, base_name: &str) -> PathBuf {
  let mut attempt = 1usize;
  loop {
    let candidate_name = if attempt == 1 {
      base_name.to_string()
    } else {
      format!("{base_name}-{:02}", attempt)
    };
    let candidate = parent.join(candidate_name);
    if !candidate.exists() {
      return candidate;
    }
    attempt += 1;
  }
}

fn normalize_log_id(raw: &str) -> Result<String, String> {
  let trimmed = raw.trim();
  if trimmed.is_empty() {
    return Err("Log id is required.".to_string());
  }
  let is_safe = trimmed
    .chars()
    .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-');
  if !is_safe {
    return Err("Invalid result id format.".to_string());
  }
  Ok(trimmed.to_string())
}

fn resolve_agent_run_document_path(app: &AppHandle, log_id: &str) -> Result<PathBuf, String> {
  let runs_dir = agent_runs_dir(app)?;
  let prefix = format!("{log_id}__");
  let entries = fs::read_dir(&runs_dir)
    .map_err(|e| format!("Failed to list task result documents: {e}"))?;

  let mut candidate_paths = entries
    .filter_map(|entry| entry.ok())
    .map(|entry| entry.path())
    .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("md"))
    .filter(|path| {
      path
        .file_name()
        .and_then(|value| value.to_str())
        .map(|name| name.starts_with(&prefix))
        .unwrap_or(false)
    })
    .collect::<Vec<PathBuf>>();

  candidate_paths.sort();
  candidate_paths
    .pop()
    .ok_or_else(|| "Task result document not found.".to_string())
}

fn normalize_inline_text(raw: &str, fallback: &str) -> String {
  let normalized = raw.split_whitespace().collect::<Vec<&str>>().join(" ");
  if normalized.is_empty() {
    fallback.to_string()
  } else {
    normalized
  }
}

#[derive(Debug, Clone)]
struct PersistedAgentArtifacts {
  deliverables_folder_path: String,
  deliverable_file_paths: Vec<String>,
}

fn desktop_deliverables_root(app: &AppHandle) -> Result<PathBuf, String> {
  let desktop_dir = match app.path().desktop_dir() {
    Ok(path) => path,
    Err(_) => {
      let home_dir = app
        .path()
        .home_dir()
        .map_err(|e| format!("Failed to resolve home directory: {e}"))?;
      home_dir.join("Desktop")
    }
  };

  let root = desktop_dir.join("Telos Deliverables");
  fs::create_dir_all(&root)
    .map_err(|e| format!("Failed to create desktop deliverables directory: {e}"))?;
  Ok(root)
}

fn ensure_deliverable_outputs(outputs: &[String]) -> Vec<String> {
  let normalized = outputs
    .iter()
    .map(|entry| normalize_inline_text(entry, "Deliverable"))
    .filter(|entry| !entry.is_empty())
    .collect::<Vec<String>>();
  if normalized.is_empty() {
    vec!["Primary deliverable completed".to_string()]
  } else {
    normalized
  }
}

fn build_deliverable_document(
  payload: &AgentPayload,
  result_payload: &AgentExecutionLog,
  deliverable_title: &str,
  index: usize,
  total: usize,
) -> String {
  let mut lines = Vec::<String>::new();
  lines.push(format!("# {}", normalize_inline_text(deliverable_title, "Deliverable")));
  lines.push(String::new());
  lines.push(format!("- Run ID: {}", result_payload.id));
  lines.push(format!("- Deliverable: {} of {}", index, total));
  lines.push(format!(
    "- Task: {}",
    normalize_inline_text(&payload.task.title, "Task")
  ));
  if let Some(parent) = payload.parent_task.as_ref() {
    lines.push(format!(
      "- Goal: {}",
      normalize_inline_text(&parent.title, "Goal")
    ));
  }
  lines.push(String::new());

  lines.push("## Deliverable Content".to_string());
  lines.push(normalize_inline_text(
    &result_payload.action_summary,
    "Execution completed.",
  ));
  lines.push(String::new());

  lines.push("## Deliverable Details".to_string());
  lines.push(format!(
    "This file captures the concrete output for: {}",
    normalize_inline_text(deliverable_title, "Deliverable")
  ));
  lines.push(normalize_inline_text(
    &result_payload.justification,
    "This deliverable supports your current goal and immediate execution.",
  ));
  lines.push(String::new());

  lines.push("## Next Step".to_string());
  lines.push(
    "Review this file, make any edits, and convert follow-up work into your next attached task."
      .to_string(),
  );
  lines.push(String::new());

  lines.join("\n")
}

fn persist_desktop_deliverables(
  app: &AppHandle,
  payload: &AgentPayload,
  result_payload: &AgentExecutionLog,
) -> Result<(PathBuf, Vec<String>), String> {
  let root_dir = desktop_deliverables_root(app)?;
  let task_slug = sanitize_filename_component(&payload.task.title, "task");
  let run_folder_name = format!("{}__{}", task_slug, readable_run_stamp());
  let run_folder = next_available_child_path(&root_dir, &run_folder_name);
  fs::create_dir_all(&run_folder)
    .map_err(|e| format!("Failed to create deliverable run directory: {e}"))?;

  let deliverables = ensure_deliverable_outputs(&result_payload.outputs);
  let total = deliverables.len();
  let mut written_paths = Vec::<String>::with_capacity(total);

  for (index, title) in deliverables.iter().enumerate() {
    let fallback_name = format!("deliverable-{:02}", index + 1);
    let deliverable_slug = sanitize_filename_component(title, &fallback_name);
    let file_name = format!("{:02}__{}.md", index + 1, deliverable_slug);
    let file_path = run_folder.join(file_name);
    let content = build_deliverable_document(payload, result_payload, title, index + 1, total);
    fs::write(&file_path, content)
      .map_err(|e| format!("Failed to write deliverable file: {e}"))?;
    written_paths.push(file_path.to_string_lossy().to_string());
  }

  Ok((run_folder, written_paths))
}

fn build_agent_run_document(
  payload: &AgentPayload,
  result_payload: &AgentExecutionLog,
  deliverables_folder_path: &str,
  deliverable_paths: &[String],
) -> String {
  let display_task_title = if let Some(requested_action) = payload.requested_action.as_ref() {
    let normalized_action = normalize_inline_text(requested_action, "");
    if !normalized_action.is_empty() {
      normalized_action
    } else {
      normalize_inline_text(&payload.task.title, "Task")
    }
  } else {
    normalize_inline_text(&payload.task.title, "Task")
  };

  let mut lines = Vec::<String>::new();
  lines.push(format!("# Task Result: {}", display_task_title));
  lines.push(String::new());

  lines.push("## Outcome".to_string());
  lines.push(normalize_inline_text(
    &result_payload.action_summary,
    "Execution completed.",
  ));
  lines.push(String::new());

  lines.push("## Deliverables".to_string());
  for output in ensure_deliverable_outputs(&result_payload.outputs) {
    lines.push(format!("- {}", output));
  }
  lines.push(String::new());

  lines.push("## Saved Deliverable Files".to_string());
  lines.push(format!(
    "- Desktop folder: {}",
    normalize_inline_text(deliverables_folder_path, "Desktop/Telos Deliverables")
  ));
  if deliverable_paths.is_empty() {
    lines.push("- No deliverable files were written.".to_string());
  } else {
    for path in deliverable_paths {
      lines.push(format!("- {}", normalize_inline_text(path, "Deliverable file")));
    }
  }
  lines.push(String::new());

  lines.push("## Why This Matters".to_string());
  lines.push(normalize_inline_text(
    &result_payload.justification,
    "This run moved the task forward with actionable output.",
  ));
  lines.push(String::new());

  lines.push("## Context".to_string());
  lines.push(format!(
    "- Task: {}",
    normalize_inline_text(&payload.task.title, "Task")
  ));
  if let Some(parent) = payload.parent_task.as_ref() {
    lines.push(format!(
      "- Parent goal: {}",
      normalize_inline_text(&parent.title, "Parent goal")
    ));
  }
  lines.push(String::new());
  lines.push("## Suggested Next Step".to_string());
  lines.push(
    "Review this result, choose one deliverable to execute immediately, and convert it into the next attached task."
      .to_string(),
  );
  lines.push(String::new());

  lines.join("\n")
}

fn persist_agent_run_artifact(
  app: &AppHandle,
  payload: &AgentPayload,
  result_payload: &AgentExecutionLog,
) -> Result<PersistedAgentArtifacts, String> {
  let (deliverables_folder, deliverable_file_paths) =
    persist_desktop_deliverables(app, payload, result_payload)?;
  let deliverables_folder_path = deliverables_folder.to_string_lossy().to_string();

  let runs_dir = agent_runs_dir(app)?;
  let task_slug = sanitize_filename_component(&payload.task.title, "task");
  let file_name = format!("{}__{}.md", result_payload.id, task_slug);
  let file_path = runs_dir.join(file_name);
  let document = build_agent_run_document(
    payload,
    result_payload,
    &deliverables_folder_path,
    &deliverable_file_paths,
  );
  fs::write(&file_path, document)
    .map_err(|e| format!("Failed to write task result document: {e}"))?;

  let desktop_result_path = deliverables_folder.join("task-result.md");
  fs::write(&desktop_result_path, build_agent_run_document(
    payload,
    result_payload,
    &deliverables_folder_path,
    &deliverable_file_paths,
  ))
  .map_err(|e| format!("Failed to write desktop task result document: {e}"))?;

  Ok(PersistedAgentArtifacts {
    deliverables_folder_path,
    deliverable_file_paths,
  })
}

fn load_context(app: &AppHandle) -> Result<PersistedContext, String> {
  let file_path = context_path(app)?;
  if !file_path.exists() {
    return Ok(PersistedContext::default());
  }

  let raw = fs::read_to_string(&file_path)
    .map_err(|e| format!("Failed to read context file: {e}"))?;
  let parsed = serde_json::from_str::<PersistedContext>(&raw);
  let mut context = match parsed {
    Ok(value) => value,
    Err(_) => PersistedContext::default(),
  };
  context.onboarding.profile.normalize();
  Ok(context)
}

fn save_context(app: &AppHandle, context: &PersistedContext) -> Result<(), String> {
  let file_path = context_path(app)?;
  let raw =
    serde_json::to_string_pretty(context).map_err(|e| format!("Failed to serialize context: {e}"))?;
  fs::write(&file_path, raw).map_err(|e| format!("Failed to write context file: {e}"))
}

fn extract_json_object(raw: &str) -> Option<String> {
  let start = raw.find('{')?;
  let end = raw.rfind('}')?;
  if end <= start {
    return None;
  }
  Some(raw[start..=end].to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn onboarding_parser_accepts_sequences() {
    let raw = json!({
      "reply": ["Hello", "there"],
      "onboarding_complete": "true",
      "name": ["pragun"],
      "profile_patch": {
        "aboutYourself": ["student", "athlete"]
      }
    });
    let parsed = parse_onboarding_model_output(&raw);
    assert_eq!(parsed.onboarding_complete, Some(true));
    assert_eq!(parsed.name.as_deref(), Some("pragun"));
    assert_eq!(
      parsed
        .profile_patch
        .as_ref()
        .and_then(|value| value.about_yourself.clone())
        .as_deref(),
      Some("student, athlete")
    );
  }

  #[test]
  fn workspace_parser_extracts_graph_updates() {
    let raw = json!({
      "reply": "Added updates.",
      "memory_note": "User wants faster execution.",
      "graph_updates": [
        {
          "operation": "add action",
          "title": ["Validate first 10 users"],
          "parent_goal": "Become a founder"
        },
        {
          "op": "add_task",
          "taskTitle": "Search 20 local courts for pilot testing",
          "parentAction": "Validate first 10 users"
        },
        {
          "op": "unsupported_op",
          "title": "Ignore me"
        }
      ]
    });

    let parsed = parse_workspace_model_output(&raw);
    assert_eq!(parsed.reply.as_deref(), Some("Added updates."));
    assert_eq!(parsed.graph_updates.len(), 2);
    assert_eq!(parsed.graph_updates[0].op, "add_speed1_action");
    assert_eq!(
      parsed.graph_updates[0].parent_goal.as_deref(),
      Some("Become a founder")
    );
    assert_eq!(parsed.graph_updates[1].op, "add_attached_task");
  }

  #[test]
  fn output_text_extractor_handles_object_content() {
    let raw = json!({
      "output": [{
        "content": [{
          "type": "output_text",
          "text": ["{\"reply\":\"hi\"}"]
        }]
      }]
    });
    let text = extract_openai_output_text(&raw);
    assert_eq!(text.as_deref(), Some("{\"reply\":\"hi\"}"));
  }

  #[test]
  fn output_text_extractor_uses_refusal_when_present() {
    let raw = json!({
      "output": [{
        "content": [{
          "type": "refusal",
          "refusal": "I can't do that."
        }]
      }]
    });
    let text = extract_openai_output_text(&raw).unwrap_or_default();
    assert!(text.contains("\"reply\""));
  }

  #[test]
  fn detects_end_onboarding_commands() {
    assert!(is_end_onboarding_request("end onboarding"));
    assert!(is_end_onboarding_request("please finish onboarding now"));
    assert!(!is_end_onboarding_request("keep onboarding"));
  }

  #[test]
  fn sanitized_reply_avoids_reasking_name() {
    let mut context = PersistedContext::default();
    context.onboarding.name = "Pragun".to_string();
    append_turn(
      &mut context,
      "onboarding",
      "assistant",
      "What should I call you?",
      json!({}),
    );

    let sanitized = sanitize_onboarding_reply(
      &context,
      "What should I call you?",
      &["riskTolerance"],
      false,
    );
    assert!(!looks_like_name_prompt(&sanitized));
    assert!(sanitized.to_lowercase().contains("risk tolerance"));
  }

  #[test]
  fn agent_policy_blocks_generic_research_task() {
    let task = AgentNodeInput {
      id: "node_speed1".to_string(),
      r#type: "speed1".to_string(),
      title: "Research pickleball".to_string(),
      description: "".to_string(),
      status: "todo".to_string(),
      execution_mode: "Agent".to_string(),
      priority_weight: Some(0.5),
      confidence_score: Some(0.5),
      conflicts: None,
    };
    let reason = agent_execution_block_reason(&task, "");
    assert!(reason.is_some());
    assert!(
      reason
        .unwrap_or_default()
        .to_lowercase()
        .contains("specific and actionable")
    );
  }

  #[test]
  fn agent_policy_allows_specific_research_task() {
    let task = AgentNodeInput {
      id: "node_speed1".to_string(),
      r#type: "speed1".to_string(),
      title: "Search for SAT study materials and compile a top 10 source list".to_string(),
      description: "Focus on Algebra and Reading resources with links.".to_string(),
      status: "todo".to_string(),
      execution_mode: "Agent".to_string(),
      priority_weight: Some(0.5),
      confidence_score: Some(0.5),
      conflicts: None,
    };
    let reason = agent_execution_block_reason(&task, "");
    assert!(reason.is_none());
  }

  #[test]
  fn agent_policy_uses_requested_action_for_subtasks() {
    let task = AgentNodeInput {
      id: "node_speed1".to_string(),
      r#type: "speed1".to_string(),
      title: "Build pickleball app".to_string(),
      description: "Ship core v1 quickly".to_string(),
      status: "todo".to_string(),
      execution_mode: "Agent".to_string(),
      priority_weight: Some(0.5),
      confidence_score: Some(0.5),
      conflicts: None,
    };
    let reason = agent_execution_block_reason(
      &task,
      "Search and compile local club contacts for a pilot list",
    );
    assert!(reason.is_none());
  }
}

fn main() {
  let _ = dotenv();
  let api_key = std::env::var("OPENAI_API_KEY").unwrap_or_default();
  let model = std::env::var("OPENAI_MODEL").unwrap_or_else(|_| "gpt-5.2".to_string());

  tauri::Builder::default()
    .manage(AppState {
      client: Client::new(),
      api_key,
      model,
    })
    .invoke_handler(tauri::generate_handler![
      chat_with_model,
      run_agent_task,
      read_agent_result_document,
      read_agent_run_document,
      reset_model_context
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
