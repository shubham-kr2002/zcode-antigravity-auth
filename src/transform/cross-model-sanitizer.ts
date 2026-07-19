/**
 * Cross-Model Metadata Sanitization
 *
 * Fixes: "Invalid `signature` in `thinking` block" error when switching models mid-session.
 *
 * Root cause: Gemini stores thoughtSignature in metadata.google, Claude stores signature
 * in top-level thinking blocks. Foreign signatures fail validation on the target model.
 */

import { isClaudeModel } from "./model-resolver.js";
import { isGemini3Model } from "./gemini.js";

// ---- Types ----

export type TargetModelFamily = "claude" | "gemini" | "unknown";

export interface SanitizerOptions {
  targetModel: string;
  sourceModel?: string;
  preserveNonSignatureMetadata?: boolean;
}

export interface SanitizationResult {
  payload: unknown;
  modified: boolean;
  signaturesStripped: number;
}

// ---- Signature Field Names ----

const GEMINI_SIGNATURE_FIELDS = ["thoughtSignature", "thinkingMetadata"] as const;
const CLAUDE_SIGNATURE_FIELDS = ["signature"] as const;

// ---- Helpers ----

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getTargetFamily(model: string): TargetModelFamily {
  if (isClaudeModel(model)) return "claude";
  if (model.toLowerCase().includes("gemini")) return "gemini";
  return "unknown";
}

// ---- Strippers ----

export function stripGeminiThinkingMetadata(
  part: Record<string, unknown>,
  preserveNonSignature = true,
): { part: Record<string, unknown>; stripped: number } {
  let stripped = 0;

  if ("thoughtSignature" in part) {
    delete part.thoughtSignature;
    stripped++;
  }

  if ("thinkingMetadata" in part) {
    delete part.thinkingMetadata;
    stripped++;
  }

  if (isPlainObject(part.metadata)) {
    const metadata = part.metadata as Record<string, unknown>;
    if (isPlainObject(metadata.google)) {
      const google = metadata.google as Record<string, unknown>;

      for (const field of GEMINI_SIGNATURE_FIELDS) {
        if (field in google) {
          delete google[field];
          stripped++;
        }
      }

      if (!preserveNonSignature || Object.keys(google).length === 0) {
        delete metadata.google;
      }

      if (Object.keys(metadata).length === 0) {
        delete part.metadata;
      }
    }
  }

  return { part, stripped };
}

export function stripClaudeThinkingFields(
  part: Record<string, unknown>,
): { part: Record<string, unknown>; stripped: number } {
  let stripped = 0;

  if (part.type === "thinking" || part.type === "redacted_thinking") {
    for (const field of CLAUDE_SIGNATURE_FIELDS) {
      if (field in part) {
        delete part[field];
        stripped++;
      }
    }
  }

  if ("signature" in part && typeof part.signature === "string") {
    if ((part.signature as string).length >= 50) {
      delete part.signature;
      stripped++;
    }
  }

  return { part, stripped };
}

// ---- Part-Level Sanitization ----

function sanitizePart(
  part: unknown,
  targetFamily: TargetModelFamily,
  preserveNonSignature: boolean,
): { part: unknown; stripped: number } {
  if (!isPlainObject(part)) {
    return { part, stripped: 0 };
  }

  let totalStripped = 0;
  const partObj = { ...part } as Record<string, unknown>;

  if (targetFamily === "claude") {
    const result = stripGeminiThinkingMetadata(partObj, preserveNonSignature);
    totalStripped += result.stripped;
  } else if (targetFamily === "gemini") {
    const result = stripClaudeThinkingFields(partObj);
    totalStripped += result.stripped;
  }

  return { part: partObj, stripped: totalStripped };
}

function sanitizeParts(
  parts: unknown[],
  targetFamily: TargetModelFamily,
  preserveNonSignature: boolean,
): { parts: unknown[]; stripped: number } {
  let totalStripped = 0;

  const sanitizedParts = parts.map((part) => {
    const result = sanitizePart(part, targetFamily, preserveNonSignature);
    totalStripped += result.stripped;
    return result.part;
  });

  return { parts: sanitizedParts, stripped: totalStripped };
}

function sanitizeContents(
  contents: unknown[],
  targetFamily: TargetModelFamily,
  preserveNonSignature: boolean,
): { contents: unknown[]; stripped: number } {
  let totalStripped = 0;

  const sanitizedContents = contents.map((content) => {
    if (!isPlainObject(content)) return content;

    const contentObj = { ...content } as Record<string, unknown>;

    if (Array.isArray(contentObj.parts)) {
      const result = sanitizeParts(
        contentObj.parts,
        targetFamily,
        preserveNonSignature,
      );
      contentObj.parts = result.parts;
      totalStripped += result.stripped;
    }

    return contentObj;
  });

  return { contents: sanitizedContents, stripped: totalStripped };
}

// ---- Top-Level Sanitization ----

export function deepSanitizeCrossModelMetadata(
  obj: unknown,
  targetFamily: TargetModelFamily,
  preserveNonSignature = true,
): { obj: unknown; stripped: number } {
  if (!isPlainObject(obj)) {
    return { obj, stripped: 0 };
  }

  let totalStripped = 0;
  const result = { ...obj } as Record<string, unknown>;

  if (Array.isArray(result.contents)) {
    const sanitized = sanitizeContents(
      result.contents,
      targetFamily,
      preserveNonSignature,
    );
    result.contents = sanitized.contents;
    totalStripped += sanitized.stripped;
  }

  if (Array.isArray(result.messages)) {
    const sanitized = sanitizeMessages(
      result.messages,
      targetFamily,
      preserveNonSignature,
    );
    result.messages = sanitized.messages;
    totalStripped += sanitized.stripped;
  }

  if (isPlainObject(result.extra_body)) {
    const extraBody = { ...result.extra_body } as Record<string, unknown>;
    if (Array.isArray(extraBody.messages)) {
      const sanitized = sanitizeMessages(
        extraBody.messages,
        targetFamily,
        preserveNonSignature,
      );
      extraBody.messages = sanitized.messages;
      totalStripped += sanitized.stripped;
    }
    result.extra_body = extraBody;
  }

  return { obj: result, stripped: totalStripped };
}

function sanitizeMessages(
  messages: unknown[],
  targetFamily: TargetModelFamily,
  preserveNonSignature: boolean,
): { messages: unknown[]; stripped: number } {
  let totalStripped = 0;

  const sanitizedMessages = messages.map((message) => {
    if (!isPlainObject(message)) return message;

    const messageObj = { ...message } as Record<string, unknown>;

    if (Array.isArray(messageObj.content)) {
      const result = sanitizeParts(
        messageObj.content,
        targetFamily,
        preserveNonSignature,
      );
      messageObj.content = result.parts;
      totalStripped += result.stripped;
    }

    return messageObj;
  });

  return { messages: sanitizedMessages, stripped: totalStripped };
}

/**
 * Sanitize a payload for cross-model compatibility.
 *
 * Strips foreign signature/metadata fields from conversation history
 * that would cause validation errors on the target model.
 */
export function sanitizeCrossModelPayload(
  payload: unknown,
  options: SanitizerOptions,
): SanitizationResult {
  const targetFamily = getTargetFamily(options.targetModel);

  if (targetFamily === "unknown") {
    return { payload, modified: false, signaturesStripped: 0 };
  }

  const preserveNonSignature = options.preserveNonSignatureMetadata ?? true;
  const result = deepSanitizeCrossModelMetadata(
    payload,
    targetFamily,
    preserveNonSignature,
  );

  return {
    payload: result.obj,
    modified: result.stripped > 0,
    signaturesStripped: result.stripped,
  };
}

/**
 * Sanitize a payload in-place (mutates the object).
 * Returns the number of signatures stripped.
 */
export function sanitizeCrossModelPayloadInPlace(
  payload: Record<string, unknown>,
  options: SanitizerOptions,
): number {
  const targetFamily = getTargetFamily(options.targetModel);

  if (targetFamily === "unknown") return 0;

  const preserveNonSignature = options.preserveNonSignatureMetadata ?? true;
  let totalStripped = 0;

  const sanitizePartsInPlace = (parts: unknown[]): void => {
    for (const part of parts) {
      if (!isPlainObject(part)) continue;

      const partObj = part as Record<string, unknown>;
      if (targetFamily === "claude") {
        const result = stripGeminiThinkingMetadata(partObj, preserveNonSignature);
        totalStripped += result.stripped;
      } else if (targetFamily === "gemini") {
        const result = stripClaudeThinkingFields(partObj);
        totalStripped += result.stripped;
      }
    }
  };

  if (Array.isArray(payload.contents)) {
    for (const content of payload.contents) {
      if (isPlainObject(content) && Array.isArray(content.parts)) {
        sanitizePartsInPlace(content.parts);
      }
    }
  }

  if (Array.isArray(payload.messages)) {
    for (const message of payload.messages) {
      if (isPlainObject(message) && Array.isArray(message.content)) {
        sanitizePartsInPlace(message.content);
      }
    }
  }

  if (isPlainObject(payload.extra_body)) {
    const extraBody = payload.extra_body as Record<string, unknown>;
    if (Array.isArray(extraBody.messages)) {
      for (const message of extraBody.messages) {
        if (isPlainObject(message) && Array.isArray(message.content)) {
          sanitizePartsInPlace(message.content);
        }
      }
    }
  }

  return totalStripped;
}
