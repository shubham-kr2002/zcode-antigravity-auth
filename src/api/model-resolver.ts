/**
 * Model Family Resolution for Quota & Routing
 *
 * Maps model names to quota groups for soft quota checks and
 * determines the model family for account selection.
 */

import type { ModelFamily } from "../accounts/storage.js";

export type QuotaGroup = "claude" | "gemini-pro" | "gemini-flash";

/**
 * Gets the model family for routing decisions.
 * Simplified from the reference's model-resolver.ts.
 */
export function getModelFamily(model: string): "claude" | "gemini-flash" | "gemini-pro" {
  const lower = model.toLowerCase();
  if (lower.includes("claude")) {
    return "claude";
  }
  if (lower.includes("flash")) {
    return "gemini-flash";
  }
  return "gemini-pro";
}

/**
 * Resolve the quota group for soft quota checks.
 *
 * When a model string is available, we can precisely determine the quota group.
 * When model is null/undefined, we fall back based on family:
 * - Claude → "claude" quota group
 * - Gemini → "gemini-pro" (conservative fallback; may misclassify flash models)
 */
export function resolveQuotaGroup(family: ModelFamily, model?: string | null): QuotaGroup {
  if (model) {
    return getModelFamily(model);
  }
  return family === "claude" ? "claude" : "gemini-pro";
}
