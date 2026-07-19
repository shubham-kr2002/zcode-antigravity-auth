/**
 * Account storage — reads/writes ~/.zcode/antigravity-accounts.json.
 * Ported from opencode-antigravity-auth plugin/storage.ts
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getAccountsFilePath } from "../config.js";

// ---- Types ----

export type CooldownReason = "auth-failure" | "network-error" | "project-error" | "validation-required";

export type ModelFamily = "claude" | "gemini";

export type RateLimitStateV3 = Record<string, number | undefined>;

export interface StoredAccount {
  email?: string;
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number;
  projectId?: string;
  managedProjectId?: string;
  addedAt: number;
  lastUsed: number;
  enabled: boolean;
  lastSwitchReason?: "rate-limit" | "initial" | "rotation";
  rateLimitResetTimes?: RateLimitStateV3;
  coolingDownUntil?: number;
  cooldownReason?: CooldownReason;
  fingerprint?: {
    quotaUser?: string;
    deviceId: string;
    sessionToken?: string;
    userAgent?: string;
    apiClient?: string;
    clientMetadata?: {
      ideType: string;
      platform: string;
      pluginType: string;
    };
    createdAt: number;
    version?: string;
  };
  fingerprintHistory?: Array<{
    fingerprint: StoredAccount["fingerprint"];
    timestamp: number;
    reason: "initial" | "regenerated" | "restored";
  }>;
  /** Cached soft quota data from checkAccountsQuota() */
  cachedQuota?: Record<string, {
    remainingFraction?: number;
    resetTime?: string;
    modelCount: number;
  }>;
  cachedQuotaUpdatedAt?: number;
  /** Set when Google requires account verification */
  verificationRequired?: boolean;
  verificationRequiredAt?: number;
  verificationRequiredReason?: string;
  verificationUrl?: string;
}

export interface AccountStorage {
  version: number;
  accounts: StoredAccount[];
  activeIndex: number;
  activeIndexByFamily?: {
    claude: number;
    gemini: number;
  };
}

// ---- Disk Operations ----

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export async function loadAccounts(): Promise<AccountStorage | null> {
  const filePath = getAccountsFilePath();
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as AccountStorage;
  } catch {
    return null;
  }
}

export async function saveAccounts(data: AccountStorage): Promise<void> {
  const filePath = getAccountsFilePath();
  ensureDir(filePath);
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

export async function clearAccounts(): Promise<void> {
  const filePath = getAccountsFilePath();
  if (existsSync(filePath)) {
    writeFileSync(filePath, JSON.stringify({ version: 1, accounts: [], activeIndex: 0 }), "utf8");
  }
}

// ---- Active Account Resolution ----

export async function getActiveAccount(): Promise<StoredAccount | null> {
  const storage = await loadAccounts();
  if (!storage || storage.accounts.length === 0) return null;

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

export async function addAccount(account: StoredAccount): Promise<void> {
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
      addedAt: accounts[existingIdx]!.addedAt, // Preserve original addedAt
    };
  } else {
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
