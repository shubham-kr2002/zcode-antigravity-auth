/**
 * OAuth callback server — captures the Google OAuth redirect on localhost.
 * Ported from opencode-antigravity-auth plugin/server.ts
 */
export interface OAuthListener {
    waitForCallback(): Promise<URL>;
    close(): Promise<void>;
}
/**
 * Starts a lightweight HTTP server that listens for the Antigravity OAuth redirect
 * and resolves with the captured callback URL.
 */
export declare function startOAuthListener(port?: number): Promise<OAuthListener>;
//# sourceMappingURL=server.d.ts.map