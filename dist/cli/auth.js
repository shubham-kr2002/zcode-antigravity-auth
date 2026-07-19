#!/usr/bin/env node
/**
 * CLI: antigravity-auth
 *
 * Commands:
 *   login        Authenticate with Google OAuth
 *   setup        Add/update Antigravity provider in ZCode config
 *   install      Full setup: login + provider config + proxy start
 *   uninstall    Remove Antigravity provider from ZCode config
 *   status       Check account and proxy status
 *   start        Start the proxy server
 */
import { authorize } from "../oauth/authorize.js";
import { exchange } from "../oauth/exchange.js";
import { startOAuthListener } from "../oauth/server.js";
import { addAccount, loadAccounts } from "../accounts/storage.js";
import { setupAntigravityProvider, isProviderConfigured, removeAntigravityProvider, } from "./setup.js";
import { exec } from "node:child_process";
// ---- Helpers ----
function openBrowser(url) {
    try {
        if (process.platform === "darwin") {
            exec(`open "${url}"`);
            return true;
        }
        if (process.platform === "win32") {
            exec(`start "" "${url}"`);
            return true;
        }
        exec(`xdg-open "${url}"`);
        return true;
    }
    catch {
        return false;
    }
}
function isHeadless() {
    return !!(process.env.SSH_CONNECTION ||
        process.env.SSH_CLIENT ||
        process.env.SSH_TTY ||
        process.env.ANTIGRAVITY_HEADLESS ||
        (!process.env.DISPLAY &&
            !process.env.WAYLAND_DISPLAY &&
            process.platform === "linux"));
}
async function prompt(question) {
    const { createInterface } = await import("node:readline/promises");
    const { stdin, stdout } = await import("node:process");
    const rl = createInterface({ input: stdin, output: stdout });
    try {
        return (await rl.question(question)).trim();
    }
    finally {
        rl.close();
    }
}
function getProxyPort() {
    return process.env.ANTIGRAVITY_PROXY_PORT ?? "51120";
}
// ---- Login ----
async function doLogin() {
    console.log("\n🔑 Antigravity Auth for ZCode\n");
    console.log("This will open Google's OAuth consent screen in your browser.");
    console.log("After approving, you'll be redirected back and authenticated.\n");
    const projectId = "";
    const authorization = await authorize(projectId);
    console.log("OAuth URL:\n" + authorization.url + "\n");
    const useManual = isHeadless();
    if (useManual) {
        const browserOpened = openBrowser(authorization.url);
        if (!browserOpened) {
            console.log("Could not open browser automatically.");
            console.log("Please open the URL above manually in your local browser.\n");
        }
        console.log("1. Open the URL above in your browser and complete Google sign-in.");
        console.log("2. After approving, copy the full redirected localhost URL from the address bar.");
        console.log("3. Paste it back here.\n");
        const callbackInput = await prompt("Paste the redirect URL here: ");
        let code;
        let state;
        try {
            const url = new URL(callbackInput);
            code = url.searchParams.get("code") ?? "";
            state = url.searchParams.get("state") ?? "";
        }
        catch {
            code = callbackInput;
            state = "";
        }
        if (!code) {
            console.log("❌ Missing authorization code in input.");
            process.exit(1);
        }
        const result = await exchange(code, state);
        if (result.type === "failed") {
            console.log(`❌ Authentication failed: ${result.error}`);
            process.exit(1);
        }
        await addAccount({
            refreshToken: result.refreshToken,
            accessToken: result.accessToken,
            expiresAt: result.expiresAt,
            email: result.email,
            projectId: result.projectId,
            addedAt: Date.now(),
            lastUsed: Date.now(),
            enabled: true,
        });
        console.log(`✅ Authenticated${result.email ? ` as ${result.email}` : ""}!`);
        return;
    }
    // ---- Automatic flow with callback server ----
    let listener = null;
    try {
        listener = await startOAuthListener();
    }
    catch {
        console.log("⚠ Could not start callback server. Falling back to manual flow.");
        console.log("\nPlease open this URL in your browser:");
        console.log(authorization.url);
        console.log("\nAfter approving, paste the redirect URL back here:");
        const callbackInput = await prompt("Redirect URL: ");
        let code;
        let state;
        try {
            const url = new URL(callbackInput);
            code = url.searchParams.get("code") ?? "";
            state = url.searchParams.get("state") ?? "";
        }
        catch {
            code = callbackInput;
            state = "";
        }
        if (!code) {
            console.log("❌ Missing authorization code.");
            process.exit(1);
        }
        const result = await exchange(code, state);
        if (result.type === "failed") {
            console.log(`❌ Authentication failed: ${result.error}`);
            process.exit(1);
        }
        await addAccount({
            refreshToken: result.refreshToken,
            accessToken: result.accessToken,
            expiresAt: result.expiresAt,
            email: result.email,
            projectId: result.projectId,
            addedAt: Date.now(),
            lastUsed: Date.now(),
            enabled: true,
        });
        console.log(`✅ Authenticated${result.email ? ` as ${result.email}` : ""}!`);
        return;
    }
    const browserOpened = openBrowser(authorization.url);
    if (!browserOpened) {
        console.log("Could not open browser. Please open the URL above manually.");
    }
    console.log("Waiting for OAuth callback... (timeout: 5 minutes)");
    try {
        const callbackUrl = await listener.waitForCallback();
        const code = callbackUrl.searchParams.get("code");
        const state = callbackUrl.searchParams.get("state");
        if (!code) {
            console.log("❌ Missing authorization code in callback.");
            process.exit(1);
        }
        const result = await exchange(code, state ?? "");
        if (result.type === "failed") {
            console.log(`❌ Authentication failed: ${result.error}`);
            process.exit(1);
        }
        await addAccount({
            refreshToken: result.refreshToken,
            accessToken: result.accessToken,
            expiresAt: result.expiresAt,
            email: result.email,
            projectId: result.projectId,
            addedAt: Date.now(),
            lastUsed: Date.now(),
            enabled: true,
        });
        console.log(`✅ Authenticated${result.email ? ` as ${result.email}` : ""}!`);
        console.log("\nRun `antigravity-auth setup` to add the provider to ZCode, then start the proxy with `antigravity-auth start`.\n");
    }
    catch (err) {
        console.log(`❌ Callback error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
    finally {
        await listener.close().catch(() => { });
    }
}
// ---- Setup (Provider Config) ----
function doSetup() {
    console.log("\n⚙️  Antigravity ZCode Provider Setup\n");
    const result = setupAntigravityProvider();
    if (result.action === "unchanged") {
        console.log("✅ Provider config already up to date.");
        console.log(`   Config: ${result.configPath}`);
        console.log(`   Base URL: ${result.baseURL}`);
        console.log(`   Models: ${result.modelNames.join(", ")}`);
        return;
    }
    const verb = result.action === "added" ? "Added" : "Updated";
    console.log(`✅ ${verb} Antigravity provider in ZCode config.`);
    console.log(`   Config: ${result.configPath}`);
    console.log(`   Base URL: ${result.baseURL}`);
    console.log(`   Models (${result.modelCount}):`);
    for (const name of result.modelNames) {
        console.log(`     - ${name}`);
    }
    console.log("\n📋 Next steps:");
    console.log("   1. Start the proxy:   antigravity-auth start");
    console.log("   2. Restart ZCode to pick up the new provider\n");
}
// ---- Install (Full Setup) ----
async function doInstall() {
    console.log("\n🚀 Antigravity for ZCode — Full Installation\n");
    // Step 1: Check accounts
    const storage = await loadAccounts();
    const accounts = storage?.accounts ?? [];
    if (accounts.length === 0) {
        console.log("No accounts found. Starting authentication flow...\n");
        await doLogin();
    }
    else {
        console.log(`✅ Found ${accounts.length} authenticated account(s).`);
        for (const acc of accounts) {
            console.log(`   - ${acc.email} (enabled: ${acc.enabled})`);
        }
    }
    // Step 2: Setup provider config
    console.log("");
    doSetup();
    // Step 3: Check if proxy is already running
    const port = getProxyPort();
    console.log(`\n📋 To start the proxy: antigravity-auth start`);
    console.log(`   Proxy will listen on http://127.0.0.1:${port}`);
    console.log(`   Then restart ZCode to use Antigravity models.\n`);
}
// ---- Uninstall ----
function doUninstall() {
    console.log("\n🗑️  Removing Antigravity from ZCode config...\n");
    const removed = removeAntigravityProvider();
    if (removed) {
        console.log("✅ Antigravity provider removed from ZCode config.");
        console.log("   Accounts are preserved in ~/.zcode/antigravity-accounts.json");
        console.log("   Run `antigravity-auth setup` to re-add it later.\n");
    }
    else {
        console.log("ℹ️  Antigravity provider was not configured.\n");
    }
}
// ---- Status ----
async function doStatus() {
    console.log("\n📊 Antigravity Status\n");
    // Provider config
    const configured = isProviderConfigured();
    console.log(`  Provider config: ${configured ? "✅ configured" : "❌ not configured"}`);
    if (configured) {
        const baseURL = `http://127.0.0.1:${getProxyPort()}/v1`;
        console.log(`  Base URL:        ${baseURL}`);
    }
    // Accounts
    const storage = await loadAccounts();
    const accounts = storage?.accounts ?? [];
    console.log(`  Accounts:        ${accounts.length} stored`);
    for (const acc of accounts) {
        const status = acc.enabled ? "✅ enabled" : "⛔ disabled";
        console.log(`    - ${acc.email} ${status}`);
    }
    // Try health check
    try {
        const port = getProxyPort();
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        if (response.ok) {
            const data = await response.json();
            console.log(`  Proxy:           🟢 running (port ${port})`);
        }
        else {
            console.log(`  Proxy:           🔴 not responding`);
        }
    }
    catch {
        console.log(`  Proxy:           🔴 not running (port ${getProxyPort()})`);
    }
    console.log("\n  Commands:");
    console.log("    antigravity-auth login      Add an account");
    console.log("    antigravity-auth setup      Configure ZCode provider");
    console.log("    antigravity-auth start      Start the proxy");
    console.log("    antigravity-auth status     Show this status\n");
}
// ---- Start Proxy ----
function doStart() {
    // Delegate to main proxy start
    import("../index.js").catch((err) => {
        console.error("Failed to start proxy:", err);
        process.exit(1);
    });
}
// ---- Help ----
function showHelp() {
    console.log("zcode-antigravity-proxy — ZCode Antigravity Auth\n");
    console.log("Usage:");
    console.log("  antigravity-auth login       Authenticate with Google OAuth");
    console.log("  antigravity-auth setup       Add/update Antigravity provider in ZCode config");
    console.log("  antigravity-auth install     Full setup: login + provider + instructions");
    console.log("  antigravity-auth uninstall   Remove Antigravity from ZCode config");
    console.log("  antigravity-auth status      Show account and proxy status");
    console.log("  antigravity-auth start       Start the proxy server\n");
    console.log("Quick start:");
    console.log("  npx zcode-antigravity-proxy install");
    console.log("  antigravity-auth start\n");
    console.log("Docs: https://github.com/NoeFabris/opencode-antigravity-auth\n");
}
// ---- Entry ----
const command = process.argv[2]?.toLowerCase();
const commands = {
    login: doLogin,
    setup: doSetup,
    install: doInstall,
    uninstall: doUninstall,
    status: doStatus,
    start: doStart,
    help: showHelp,
    "--help": showHelp,
    "-h": showHelp,
};
const handler = commands[command ?? ""];
if (handler) {
    Promise.resolve(handler()).catch((err) => {
        console.error("Fatal error:", err);
        process.exit(1);
    });
}
else if (!command) {
    showHelp();
}
else {
    console.log(`Unknown command: ${command}\n`);
    showHelp();
    process.exit(1);
}
//# sourceMappingURL=auth.js.map