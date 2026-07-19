/**
 * File-based debug logging for zcode-antigravity-proxy.
 * Writes structured logs to ~/.zcode/antigravity-logs/ with daily rotation.
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { getLogDir } from "./config.js";

// ---- Types ----

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

// ---- Module State ----

let logDir: string | null = null;
let logFilePath: string | null = null;
let debugEnabled = false;

// ---- Helpers ----

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${d
    .getMilliseconds()
    .toString()
    .padStart(3, "0")}`;
}

function ensureLogDir(): string {
  if (!logDir) {
    logDir = getLogDir();
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
  }
  return logDir;
}

function getTodayLogPath(): string {
  const today = formatDate(new Date());
  return `${ensureLogDir()}/antigravity-${today}.log`;
}

// ---- Public API ----

/**
 * Initialize the logger. Must be called once before logging.
 */
export function initLogger(debug: boolean): void {
  debugEnabled = debug;
  logFilePath = getTodayLogPath();
  ensureLogDir();
}

/**
 * Write a log entry to the daily log file.
 * Only writes debug/info when debug mode is enabled.
 * Always writes warn/error.
 */
export function writeLog(
  level: LogLevel,
  message: string,
  data?: unknown,
): void {
  // Skip debug/info unless debug mode is on
  if ((level === "debug" || level === "info") && !debugEnabled) {
    return;
  }

  const now = new Date();
  const entry: LogEntry = {
    timestamp: `${formatDate(now)}T${formatTime(now)}`,
    level,
    message,
    ...(data !== undefined ? { data } : {}),
  };

  const line = JSON.stringify(entry) + "\n";

  try {
    // Check if date changed (new day)
    const currentPath = getTodayLogPath();
    if (currentPath !== logFilePath) {
      logFilePath = currentPath;
    }
    appendFileSync(logFilePath!, line, "utf8");
  } catch {
    // Silently fail — don't crash the proxy over logging issues
    // Fallback to console.error
    console.error(`[logger] ${line.trim()}`);
  }
}

// Convenience methods
export const log = {
  debug: (msg: string, data?: unknown) => writeLog("debug", msg, data),
  info: (msg: string, data?: unknown) => writeLog("info", msg, data),
  warn: (msg: string, data?: unknown) => writeLog("warn", msg, data),
  error: (msg: string, data?: unknown) => writeLog("error", msg, data),
};
