/**
 * OAuth token refresh for Antigravity.
 * Ported from opencode-antigravity-auth plugin/token.ts
 */

import {
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_CLIENT_SECRET,
} from "../constants.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface RefreshedToken {
  accessToken: string;
  expiresAt: number;
  refreshToken: string;
}

/**
 * Refresh an access token using a refresh token.
 * Returns a new access token without modifying storage.
 */
export async function refreshAccessToken(
  refreshToken: string,
  _projectId?: string,
): Promise<RefreshedToken> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "Accept": "*/*",
    },
    body: new URLSearchParams({
      client_id: ANTIGRAVITY_CLIENT_ID,
      client_secret: ANTIGRAVITY_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };

  return {
    accessToken: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in - 60) * 1000, // 60s buffer
    refreshToken: payload.refresh_token ?? refreshToken,
  };
}
