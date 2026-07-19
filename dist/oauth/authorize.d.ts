/**
 * OAuth PKCE authorization URL generation.
 * Ported from opencode-antigravity-auth antigravity/oauth.ts
 */
export interface AuthorizationResult {
    url: string;
    verifier: string;
}
/**
 * Build the Antigravity OAuth authorization URL including PKCE.
 */
export declare function authorize(projectId?: string): Promise<AuthorizationResult>;
/**
 * Decode an OAuth state parameter back into structured data.
 */
export declare function decodeState(state: string): {
    verifier: string;
    projectId: string;
};
//# sourceMappingURL=authorize.d.ts.map