/**
 * OAuth PKCE authorization URL generation.
 * Ported from opencode-antigravity-auth antigravity/oauth.ts
 */

import { generatePKCE } from "@openauthjs/openauth/pkce";
import {
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_REDIRECT_URI,
  ANTIGRAVITY_SCOPES,
} from "../constants.js";

interface PkcePair {
  challenge: string;
  verifier: string;
}

function encodeState(payload: { verifier: string; projectId: string }): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export interface AuthorizationResult {
  url: string;
  verifier: string;
}

/**
 * Build the Antigravity OAuth authorization URL including PKCE.
 */
export async function authorize(projectId = ""): Promise<AuthorizationResult> {
  const pkce = (await generatePKCE()) as PkcePair;

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", ANTIGRAVITY_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", ANTIGRAVITY_REDIRECT_URI);
  url.searchParams.set("scope", ANTIGRAVITY_SCOPES.join(" "));
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set(
    "state",
    encodeState({ verifier: pkce.verifier, projectId: projectId || "" }),
  );
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");

  return { url: url.toString(), verifier: pkce.verifier };
}

/**
 * Decode an OAuth state parameter back into structured data.
 */
export function decodeState(state: string): {
  verifier: string;
  projectId: string;
} {
  const normalized = state.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const json = Buffer.from(padded, "base64").toString("utf8");
  const parsed = JSON.parse(json);
  if (typeof parsed.verifier !== "string") {
    throw new Error("Missing PKCE verifier in state");
  }
  return {
    verifier: parsed.verifier,
    projectId: typeof parsed.projectId === "string" ? parsed.projectId : "",
  };
}
