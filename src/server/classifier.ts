import type { FunnelLabel } from "../shared/types.js";

const optOutPatterns = [
  /\bstop\b/i,
  /\bunsubscribe\b/i,
  /\bremove\s+me\b/i,
  /\bdon'?t\s+message\b/i,
  /\bnot\s+interested\b/i,
  /\bno\s+thanks?\b/i,
  /^\s*no\s*[.!?]*\s*$/i
];

export function isOptOut(text: string): boolean {
  return optOutPatterns.some((pattern) => pattern.test(text));
}

export function classifyOutcome(text: string): FunnelLabel {
  const normalized = text.toLowerCase();
  if (isOptOut(text)) return "opted_out";
  if (/\b(i'?ll|i will|will)\s+vote\b/.test(normalized) || /\byou have my vote\b/.test(normalized)) {
    return "supportive";
  }
  if (/\b(yes|sure|okay|ok|interested|tell me more)\b/.test(normalized)) {
    return "supportive";
  }
  if (/\b(undecided|not sure|maybe|why should|convince me)\b/.test(normalized)) {
    return "undecided";
  }
  if (/\b(no|never|against|opposed|won'?t vote)\b/.test(normalized)) {
    return "opposed";
  }
  if (/\?|how|when|where|why|what/.test(normalized)) {
    return "needs_human";
  }
  return "replied";
}

export function mergeOutcome(current: FunnelLabel, incoming: FunnelLabel): FunnelLabel {
  const priority: FunnelLabel[] = [
    "opted_out",
    "needs_human",
    "supportive",
    "opposed",
    "undecided",
    "replied",
    "contacted",
    "failed_send",
    "not_contacted"
  ];
  return priority.indexOf(incoming) <= priority.indexOf(current) ? incoming : current;
}
