/**
 * Account storage — reads/writes ~/.zcode/antigravity-accounts.json.
 * Ported from opencode-antigravity-auth plugin/storage.ts
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getAccountsFilePath } from "../config.js";
// ---- Disk Operations ----
function ensureDir(filePath) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}
export async function loadAccounts() {
    const filePath = getAccountsFilePath();
    if (!existsSync(filePath))
        return null;
    try {
        const raw = readFileSync(filePath, "utf8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export async function saveAccounts(data) {
    const filePath = getAccountsFilePath();
    ensureDir(filePath);
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}
export async function clearAccounts() {
    const filePath = getAccountsFilePath();
    if (existsSync(filePath)) {
        writeFileSync(filePath, JSON.stringify({ version: 1, accounts: [], activeIndex: 0 }), "utf8");
    }
}
// ---- Active Account Resolution ----
export async function getActiveAccount() {
    const storage = await loadAccounts();
    if (!storage || storage.accounts.length === 0)
        return null;
    // Get the active account
    const activeIdx = Math.max(0, storage.activeIndex);
    const account = storage.accounts[activeIdx];
    if (!account || account.enabled === false) {
        // Find first enabled account
        const enabled = storage.accounts.find((a) => a.enabled !== false);
        return enabled ?? null;
    }
    return account;
}
// ---- Account Addition ----
export async function addAccount(account) {
    const storage = await loadAccounts();
    const accounts = storage?.accounts ?? [];
    // Check for existing account by email
    const existingIdx = account.email
        ? accounts.findIndex((a) => a.email === account.email)
        : -1;
    if (existingIdx >= 0) {
        // Update existing
        accounts[existingIdx] = {
            ...accounts[existingIdx],
            ...account,
            addedAt: accounts[existingIdx].addedAt, // Preserve original addedAt
        };
    }
    else {
        accounts.push(account);
    }
    await saveAccounts({
        version: 1,
        accounts,
        activeIndex: existingIdx >= 0 ? existingIdx : accounts.length - 1,
        activeIndexByFamily: {
            claude: existingIdx >= 0 ? existingIdx : accounts.length - 1,
            gemini: existingIdx >= 0 ? existingIdx : accounts.length - 1,
        },
    });
}
//# sourceMappingURL=storage.js.map