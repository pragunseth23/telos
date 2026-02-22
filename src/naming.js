const MINOR_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "vs",
  "with",
]);

const ACRONYM_MAP = new Map([
  ["ai", "AI"],
  ["api", "API"],
  ["b2b", "B2B"],
  ["b2c", "B2C"],
  ["bair", "BAIR"],
  ["d2c", "D2C"],
  ["gpt", "GPT"],
  ["gtm", "GTM"],
  ["ml", "ML"],
  ["mvp", "MVP"],
  ["sat", "SAT"],
  ["uc", "UC"],
  ["ui", "UI"],
  ["ux", "UX"],
]);

const ACTION_VERB_PATTERN =
  /\b(analyze|brainstorm|build|collect|compare|compile|contact|create|define|design|draft|execute|find|launch|list|measure|organize|outline|plan|prepare|prioritize|prototype|reach|research|review|run|schedule|ship|shortlist|summarize|test|validate|write)\b/i;
const OUTPUT_SIGNAL_PATTERN =
  /\b(brief|checklist|comparison|deck|doc|document|links?|list|milestones?|outline|plan|report|roadmap|sources?|summary|table)\b/i;

function compactWhitespace(rawValue) {
  return String(rawValue || "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripDecorators(rawValue) {
  return compactWhitespace(rawValue)
    .replace(/^[\s"'`]+|[\s"'`]+$/g, "")
    .replace(/^[\-*+•]+/, "")
    .replace(/^\d+[\).:-]?\s*/, "")
    .replace(
      /^(?:core\s*identity|identity|primary\s*identity|role|roles|lens|profile|goal|action|task|speed[-\s]?[12])\s*[:\-]\s*/i,
      ""
    )
    .replace(/[.;:,!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatToken(rawToken, isFirstToken, isLastToken) {
  const token = String(rawToken || "").trim();
  if (!token) {
    return "";
  }
  if (token === "/") {
    return "/";
  }

  return token
    .split("-")
    .map((part, partIndex, parts) => {
      const segment = String(part || "").trim();
      if (!segment) {
        return "";
      }
      const lower = segment.toLowerCase();
      if (ACRONYM_MAP.has(lower)) {
        return ACRONYM_MAP.get(lower);
      }
      if (/^\d+[a-z]$/i.test(segment)) {
        return `${segment.slice(0, -1)}${segment.slice(-1).toUpperCase()}`;
      }
      if (/^\d/.test(segment)) {
        return segment;
      }

      const firstInWord = partIndex === 0;
      const lastInWord = partIndex === parts.length - 1;
      const shouldLowercaseMinor =
        MINOR_WORDS.has(lower) &&
        !(
          (isFirstToken && firstInWord) ||
          (isLastToken && lastInWord)
        );
      if (shouldLowercaseMinor) {
        return lower;
      }
      return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join("-");
}

export function normalizeTitleForDisplay(rawTitle, fallback = "") {
  const cleaned = stripDecorators(rawTitle);
  if (!cleaned) {
    return stripDecorators(fallback);
  }

  const tokens = cleaned.split(" ").filter(Boolean);
  if (tokens.length === 0) {
    return stripDecorators(fallback);
  }

  const formatted = tokens
    .map((token, index) => formatToken(token, index === 0, index === tokens.length - 1))
    .join(" ")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s+/g, " ")
    .trim();

  return formatted || stripDecorators(fallback);
}

export function normalizeTitleKey(rawTitle) {
  return stripDecorators(rawTitle)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitTokens(rawTitle) {
  return normalizeTitleKey(rawTitle).split(" ").filter(Boolean);
}

export function isTitleCopyLike(candidateTitle, referenceTitle) {
  const candidateKey = normalizeTitleKey(candidateTitle);
  const referenceKey = normalizeTitleKey(referenceTitle);
  if (!candidateKey || !referenceKey) {
    return false;
  }
  if (candidateKey === referenceKey) {
    return true;
  }

  const candidateTokens = splitTokens(candidateTitle);
  const referenceTokens = splitTokens(referenceTitle);
  if (candidateTokens.length === 0 || referenceTokens.length === 0) {
    return false;
  }

  const candidateSet = new Set(candidateTokens);
  const overlap = referenceTokens.filter((token) => candidateSet.has(token)).length;
  const shorterLength = Math.min(candidateTokens.length, referenceTokens.length);
  const lengthDelta = Math.abs(candidateTokens.length - referenceTokens.length);
  const overlapRatio = shorterLength > 0 ? overlap / shorterLength : 0;

  if (overlapRatio >= 0.9 && lengthDelta <= 1) {
    return true;
  }

  if (
    (candidateKey.includes(referenceKey) || referenceKey.includes(candidateKey)) &&
    lengthDelta <= 1
  ) {
    return true;
  }

  return false;
}

export function isActionableLabel(rawTitle, options = {}) {
  const title = normalizeTitleForDisplay(rawTitle, "");
  if (!title) {
    return false;
  }
  const minWords = Number(options.minWords ?? 3);
  const requireOutput = options.requireOutput === true;
  const normalized = normalizeTitleKey(title);
  const words = normalized.split(" ").filter(Boolean);
  if (words.length < minWords) {
    return false;
  }

  if (!ACTION_VERB_PATTERN.test(normalized)) {
    return false;
  }

  if (!requireOutput) {
    return true;
  }

  return OUTPUT_SIGNAL_PATTERN.test(normalized) || /\b\d+\b/.test(normalized);
}

function pickTemplate(templates, fallbackIndex) {
  if (!Array.isArray(templates) || templates.length === 0) {
    return "";
  }
  const offset = Math.max(0, Number(fallbackIndex || 1) - 1);
  return templates[offset % templates.length];
}

function normalizedSubject(rawTitle, fallbackText) {
  return normalizeTitleForDisplay(rawTitle, fallbackText);
}

export function ensureSpeed2GoalTitle(rawTitle, identityTitle, fallbackIndex = 1) {
  let candidate = normalizeTitleForDisplay(rawTitle, "");
  if (candidate && !isTitleCopyLike(candidate, identityTitle)) {
    return candidate;
  }

  const identitySubject = normalizedSubject(identityTitle, "Your Priorities");
  const roleSegments = identitySubject
    .split("/")
    .map((part) => normalizeTitleForDisplay(part, ""))
    .filter(Boolean);
  const roleSubject = roleSegments.length
    ? roleSegments[(Math.max(1, fallbackIndex) - 1) % roleSegments.length]
    : identitySubject;

  const fallback = pickTemplate(
    [
      `Define a Multi-Year Milestone for ${roleSubject}`,
      `Build Long-Term Momentum as ${roleSubject}`,
      `Create a Long-Term Growth Plan for ${roleSubject}`,
    ],
    fallbackIndex
  );
  candidate = normalizeTitleForDisplay(fallback, "Define a Distinct Long-Term Milestone");
  if (isTitleCopyLike(candidate, identityTitle)) {
    return "Define a Distinct Long-Term Milestone";
  }
  return candidate;
}

export function ensureSpeed1ActionTitle(rawTitle, goalTitle, fallbackIndex = 1) {
  let candidate = normalizeTitleForDisplay(rawTitle, "");
  const shouldReplace =
    !candidate || isTitleCopyLike(candidate, goalTitle) || !isActionableLabel(candidate, { minWords: 3 });
  if (!shouldReplace) {
    return candidate;
  }

  const goalSubject = normalizedSubject(goalTitle, "This Goal");
  const fallback = pickTemplate(
    [
      `Draft a 2-Week Execution Plan for ${goalSubject}`,
      `Run a Measurable Validation Sprint for ${goalSubject}`,
      `Define Weekly Milestones and Owners for ${goalSubject}`,
    ],
    fallbackIndex
  );
  candidate = normalizeTitleForDisplay(fallback, "Draft a 2-Week Execution Plan");
  return candidate;
}

export function ensureAttachedTaskTitle(rawTitle, actionTitle, fallbackIndex = 1) {
  let candidate = normalizeTitleForDisplay(rawTitle, "");
  const shouldReplace =
    !candidate ||
    isTitleCopyLike(candidate, actionTitle) ||
    !isActionableLabel(candidate, { minWords: 5, requireOutput: true });
  if (!shouldReplace) {
    return candidate;
  }

  const actionSubject = normalizedSubject(actionTitle, "This Action");
  const fallback = pickTemplate(
    [
      `Search Online and Shortlist 10 High-Quality Resources for ${actionSubject}`,
      `Create a Comparison Table of 5 Options for ${actionSubject}`,
      `Write a One-Page Brief with Recommended Next Steps for ${actionSubject}`,
    ],
    fallbackIndex
  );
  candidate = normalizeTitleForDisplay(fallback, "Create a Specific Task Brief");
  return candidate;
}
