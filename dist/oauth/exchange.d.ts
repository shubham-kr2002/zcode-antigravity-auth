/**
 * OAuth code exchange — exchanges authorization code for tokens.
 * Ported from opencode-antigravity-auth antigravity/oauth.ts
 */
export interface ExchangeResult {
    type: "success" | "failed";
    refreshToken?: string;
    accessToken?: string;
    expiresAt?: number;
    email?: string;
    projectId?: string;
    error?: string;
}
/**
 * Exchange an authorization code for Antigravity CLI access and refresh tokens.
 */
export declare function exchange(code: string, state: string): Promise<ExchangeResult>;
//# sourceMappingURL=exchange.d.ts.map