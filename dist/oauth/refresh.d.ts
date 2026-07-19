/**
 * OAuth token refresh for Antigravity.
 * Ported from opencode-antigravity-auth plugin/token.ts
 */
export interface RefreshedToken {
    accessToken: string;
    expiresAt: number;
    refreshToken: string;
}
/**
 * Refresh an access token using a refresh token.
 * Returns a new access token without modifying storage.
 */
export declare function refreshAccessToken(refreshToken: string, _projectId?: string): Promise<RefreshedToken>;
//# sourceMappingURL=refresh.d.ts.map