/**
 * Tests for account storage (loadAccounts, saveAccounts, clearAccounts,
 * getActiveAccount, addAccount).
 *
 * Uses a real temp directory + ZCODE_CONFIG_DIR to control where
 * the accounts file is written, avoiding fs module mocking issues.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import {
  mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadAccounts,
  saveAccounts,
  clearAccounts,
  getActiveAccount,
  addAccount,
  type AccountStorage,
  type StoredAccount,
} from "../src/accounts/storage.js";

// ---- Temp directory setup ----

let dataDir: string;
let accountsFilePath: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "storage-test-"));
  process.env.ZCODE_CONFIG_DIR = dataDir;
  accountsFilePath = join(dataDir, "antigravity-accounts.json");
});

afterAll(() => {
  delete process.env.ZCODE_CONFIG_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.restoreAllMocks();
  // Remove any accounts file left from previous tests
  try {
    rmSync(accountsFilePath, { force: true });
  } catch { /* ignore */ }
});

// ---- Helpers ----

function makeAccount(overrides: Partial<StoredAccount> = {}): StoredAccount {
  return {
    email: "test@example.com",
    refreshToken: "rt_test_token",
    accessToken: "at_test_token",
    expiresAt: Date.now() + 3600_000,
    addedAt: Date.now(),
    lastUsed: Date.now(),
    enabled: true,
    ...overrides,
  };
}

function makeStorage(overrides: Partial<AccountStorage> = {}): AccountStorage {
  return {
    version: 1,
    accounts: [makeAccount()],
    activeIndex: 0,
    ...overrides,
  };
}

// ===================================================================
// loadAccounts
// ===================================================================

describe("loadAccounts", () => {
  it("returns null when the file does not exist", async () => {
    const result = await loadAccounts();
    expect(result).toBeNull();
  });

  it("returns null when the file contains corrupted JSON", async () => {
    writeFileSync(accountsFilePath, "not-valid-json{{{", "utf8");
    const result = await loadAccounts();
    expect(result).toBeNull();
  });

  it("returns parsed AccountStorage when the file is valid", async () => {
    const data: AccountStorage = makeStorage({
      accounts: [
        makeAccount({ email: "alice@example.com" }),
        makeAccount({ email: "bob@example.com", enabled: false }),
      ],
      activeIndex: 1,
    });
    writeFileSync(accountsFilePath, JSON.stringify(data), "utf8");

    const result = await loadAccounts();
    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
    expect(result!.accounts).toHaveLength(2);
    expect(result!.accounts[0]!.email).toBe("alice@example.com");
    expect(result!.accounts[1]!.email).toBe("bob@example.com");
    expect(result!.activeIndex).toBe(1);
  });

  it("returns null when file is empty", async () => {
    writeFileSync(accountsFilePath, "", "utf8");
    const result = await loadAccounts();
    expect(result).toBeNull();
  });
});

// ===================================================================
// saveAccounts
// ===================================================================

describe("saveAccounts", () => {
  it("writes correct structure to disk", async () => {
    const data: AccountStorage = makeStorage({
      accounts: [
        makeAccount({ email: "a@example.com" }),
      ],
      activeIndex: 0,
    });

    await saveAccounts(data);

    expect(existsSync(accountsFilePath)).toBe(true);
    const raw = readFileSync(accountsFilePath, "utf8");
    const parsed = JSON.parse(raw) as AccountStorage;
    expect(parsed.version).toBe(1);
    expect(parsed.accounts).toHaveLength(1);
    expect(parsed.accounts[0]!.email).toBe("a@example.com");
    expect(parsed.activeIndex).toBe(0);
  });

  it("creates the directory structure if missing", async () => {
    // Remove the temp directory entirely
    rmSync(dataDir, { recursive: true, force: true });
    expect(existsSync(dataDir)).toBe(false);

    const data: AccountStorage = makeStorage();
    await saveAccounts(data);

    expect(existsSync(dataDir)).toBe(true);
    expect(existsSync(accountsFilePath)).toBe(true);

    const raw = readFileSync(accountsFilePath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.accounts).toHaveLength(1);
  });

  it("overwrites any existing file", async () => {
    // Write an initial file
    writeFileSync(accountsFilePath, JSON.stringify({ version: 1, accounts: [], activeIndex: 0 }), "utf8");

    const data: AccountStorage = makeStorage({
      accounts: [
        makeAccount({ email: "updated@example.com" }),
      ],
    });
    await saveAccounts(data);

    const raw = readFileSync(accountsFilePath, "utf8");
    const parsed = JSON.parse(raw) as AccountStorage;
    expect(parsed.accounts).toHaveLength(1);
    expect(parsed.accounts[0]!.email).toBe("updated@example.com");
  });
});

// ===================================================================
// clearAccounts
// ===================================================================

describe("clearAccounts", () => {
  it("writes an empty accounts structure when the file exists", async () => {
    // First create a file with data
    const data: AccountStorage = makeStorage({
      accounts: [makeAccount({ email: "user@example.com" })],
    });
    await saveAccounts(data);

    await clearAccounts();

    expect(existsSync(accountsFilePath)).toBe(true);
    const raw = readFileSync(accountsFilePath, "utf8");
    const parsed = JSON.parse(raw) as AccountStorage;
    expect(parsed.version).toBe(1);
    expect(parsed.accounts).toEqual([]);
    expect(parsed.activeIndex).toBe(0);
  });

  it("does not throw when the file does not exist yet", async () => {
    // File should not exist at this point
    expect(existsSync(accountsFilePath)).toBe(false);

    // Should not throw
    await expect(clearAccounts()).resolves.toBeUndefined();
  });

  it("leaves the file empty of accounts after clearing", async () => {
    // Save with accounts
    const data: AccountStorage = makeStorage({
      accounts: [
        makeAccount({ email: "remove-me@example.com" }),
      ],
    });
    await saveAccounts(data);

    await clearAccounts();

    const result = await loadAccounts();
    expect(result).not.toBeNull();
    expect(result!.accounts).toHaveLength(0);
  });
});

// ===================================================================
// getActiveAccount
// ===================================================================

describe("getActiveAccount", () => {
  it("returns null when there are no accounts", async () => {
    // No file at all
    const result = await getActiveAccount();
    expect(result).toBeNull();
  });

  it("returns null when file exists but accounts array is empty", async () => {
    writeFileSync(
      accountsFilePath,
      JSON.stringify({ version: 1, accounts: [], activeIndex: 0 }),
      "utf8",
    );
    const result = await getActiveAccount();
    expect(result).toBeNull();
  });

  it("returns the first enabled account when activeIndex points to a disabled account", async () => {
    const accounts: StoredAccount[] = [
      makeAccount({ email: "disabled@example.com", enabled: false }),
      makeAccount({ email: "enabled@example.com", enabled: true }),
    ];
    writeFileSync(
      accountsFilePath,
      JSON.stringify({ version: 1, accounts, activeIndex: 0 }),
      "utf8",
    );

    const result = await getActiveAccount();
    expect(result).not.toBeNull();
    expect(result!.email).toBe("enabled@example.com");
  });

  it("returns the account at activeIndex when it is enabled", async () => {
    const accounts: StoredAccount[] = [
      makeAccount({ email: "first@example.com" }),
      makeAccount({ email: "second@example.com" }),
    ];
    writeFileSync(
      accountsFilePath,
      JSON.stringify({ version: 1, accounts, activeIndex: 1 }),
      "utf8",
    );

    const result = await getActiveAccount();
    expect(result).not.toBeNull();
    expect(result!.email).toBe("second@example.com");
  });

  it("returns the first enabled account when activeIndex is out of bounds", async () => {
    const accounts: StoredAccount[] = [
      makeAccount({ email: "alpha@example.com" }),
    ];
    // activeIndex is 99, way beyond array length
    writeFileSync(
      accountsFilePath,
      JSON.stringify({ version: 1, accounts, activeIndex: 99 }),
      "utf8",
    );

    const result = await getActiveAccount();
    expect(result).not.toBeNull();
    // Math.max(0, 99) = 99, which is out of bounds, so it falls through
    // to find first enabled account
    expect(result!.email).toBe("alpha@example.com");
  });
});

// ===================================================================
// addAccount
// ===================================================================

describe("addAccount", () => {
  it("appends a new account when no file exists yet", async () => {
    // No file exists
    const account: StoredAccount = makeAccount({ email: "new@example.com" });
    await addAccount(account);

    const storage = await loadAccounts();
    expect(storage).not.toBeNull();
    expect(storage!.accounts).toHaveLength(1);
    expect(storage!.accounts[0]!.email).toBe("new@example.com");
    expect(storage!.activeIndex).toBe(0);
  });

  it("appends a new account to existing accounts", async () => {
    // Pre-populate with one account
    const existing: StoredAccount = makeAccount({ email: "existing@example.com" });
    await addAccount(existing);

    const newAccount: StoredAccount = makeAccount({ email: "new@example.com" });
    await addAccount(newAccount);

    const storage = await loadAccounts();
    expect(storage).not.toBeNull();
    expect(storage!.accounts).toHaveLength(2);
    expect(storage!.accounts[0]!.email).toBe("existing@example.com");
    expect(storage!.accounts[1]!.email).toBe("new@example.com");
    // activeIndex should point to the newly added account
    expect(storage!.activeIndex).toBe(1);
  });

  it("updates existing account when email matches", async () => {
    const account: StoredAccount = makeAccount({
      email: "same@example.com",
      refreshToken: "rt_original",
    });

    // First add
    await addAccount(account);

    // Now add with same email but updated data
    const updated: StoredAccount = makeAccount({
      email: "same@example.com",
      refreshToken: "rt_updated",
      accessToken: "at_updated",
    });
    await addAccount(updated);

    const storage = await loadAccounts();
    expect(storage).not.toBeNull();
    expect(storage!.accounts).toHaveLength(1);
    expect(storage!.accounts[0]!.refreshToken).toBe("rt_updated");
    expect(storage!.accounts[0]!.accessToken).toBe("at_updated");
    // activeIndex should stay at 0 (index of existing)
    expect(storage!.activeIndex).toBe(0);
  });

  it("preserves the original addedAt when updating an existing account", async () => {
    const addedAtOriginal = 1_000_000;
    const account: StoredAccount = makeAccount({
      email: "persist@example.com",
      addedAt: addedAtOriginal,
    });
    await addAccount(account);

    const updated: StoredAccount = makeAccount({
      email: "persist@example.com",
      addedAt: Date.now(), // this should be overwritten by addAccount
    });
    await addAccount(updated);

    const storage = await loadAccounts();
    expect(storage!.accounts[0]!.addedAt).toBe(addedAtOriginal);
  });

  it("adds account without an email as a new entry (no duplicate check)", async () => {
    const noEmail1: StoredAccount = makeAccount({ email: undefined });
    const noEmail2: StoredAccount = makeAccount({ email: undefined });

    await addAccount(noEmail1);
    await addAccount(noEmail2);

    const storage = await loadAccounts();
    expect(storage!.accounts).toHaveLength(2);
  });

  it("sets activeIndexByFamily for both claude and gemini", async () => {
    const account: StoredAccount = makeAccount({ email: "family@example.com" });
    await addAccount(account);

    const storage = await loadAccounts();
    expect(storage!.activeIndexByFamily).toBeDefined();
    expect(storage!.activeIndexByFamily!.claude).toBe(0);
    expect(storage!.activeIndexByFamily!.gemini).toBe(0);
  });
});
