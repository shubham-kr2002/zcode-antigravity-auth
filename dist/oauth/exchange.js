/**
 * OAuth code exchange — exchanges authorization code for tokens.
 * Ported from opencode-antigravity-auth antigravity/oauth.ts
 */
import { decodeState } from "./authorize.js";
import { ANTIGRAVITY_CLIENT_ID, ANTIGRAVITY_CLIENT_SECRET, ANTIGRAVITY_REDIRECT_URI, } from "../constants.js";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USER_INFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";
/**
 * Exchange an authorization code for Antigravity CLI access and refresh tokens.
 */
export async function exchange(code, state) {
    try {
        const { verifier, projectId } = decodeState(state);
        const startTime = Date.now();
        const tokenResponse = await fetch(TOKEN_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                Accept: "*/*",
            },
            body: new URLSearchParams({
                client_id: ANTIGRAVITY_CLIENT_ID,
                client_secret: ANTIGRAVITY_CLIENT_SECRET,
                code,
                grant_type: "authorization_code",
                redirect_uri: ANTIGRAVITY_REDIRECT_URI,
                code_verifier: verifier,
            }),
        });
        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            return { type: "failed", error: errorText };
        }
        const tokenPayload = (await tokenResponse.json());
        // Fetch user info
        let email;
        try {
            const userInfoResponse = await fetch(USER_INFO_URL, {
                headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
            });
            if (userInfoResponse.ok) {
                const userInfo = (await userInfoResponse.json());
                email = userInfo.email;
            }
        }
        catch {
            // Non-critical
        }
        const refreshToken = tokenPayload.refresh_token;
        if (!refreshToken) {
            return { type: "failed", error: "Missing refresh token in response" };
        }
        return {
            type: "success",
            refreshToken,
            accessToken: tokenPayload.access_token,
            expiresAt: startTime + (tokenPayload.expires_in - 60) * 1000,
            email,
            projectId: projectId || undefined,
        };
    }
    catch (error) {
        return {
            type: "failed",
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}
//# sourceMappingURL=exchange.js.map