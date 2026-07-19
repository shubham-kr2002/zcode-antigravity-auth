/**
 * File-based debug logging for zcode-antigravity-proxy.
 * Writes structured logs to ~/.zcode/antigravity-logs/ with daily rotation.
 */
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { getLogDir } from "./config.js";
// ---- Module State ----
let logDir = null;
let logFilePath = null;
let debugEnabled = false;
// ---- Helpers ----
function pad(n) {
    return n.toString().padStart(2, "0");
}
function formatDate(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function formatTime(d) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${d
        .getMilliseconds()
        .toString()
        .padStart(3, "0")}`;
}
function ensureLogDir() {
    if (!logDir) {
        logDir = getLogDir();
        if (!existsSync(logDir)) {
            mkdirSync(logDir, { recursive: true });
        }
    }
    return logDir;
}
function getTodayLogPath() {
    const today = formatDate(new Date());
    return `${ensureLogDir()}/antigravity-${today}.log`;
}
// ---- Public API ----
/**
 * Initialize the logger. Must be called once before logging.
 */
export function initLogger(debug) {
    debugEnabled = debug;
    logFilePath = getTodayLogPath();
    ensureLogDir();
}
/**
 * Write a log entry to the daily log file.
 * Only writes debug/info when debug mode is enabled.
 * Always writes warn/error.
 */
export function writeLog(level, message, data) {
    // Skip debug/info unless debug mode is on
    if ((level === "debug" || level === "info") && !debugEnabled) {
        return;
    }
    const now = new Date();
    const entry = {
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
        appendFileSync(logFilePath, line, "utf8");
    }
    catch {
        // Silently fail — don't crash the proxy over logging issues
        // Fallback to console.error
        console.error(`[logger] ${line.trim()}`);
    }
}
// Convenience methods
export const log = {
    debug: (msg, data) => writeLog("debug", msg, data),
    info: (msg, data) => writeLog("info", msg, data),
    warn: (msg, data) => writeLog("warn", msg, data),
    error: (msg, data) => writeLog("error", msg, data),
};
//# sourceMappingURL=logger.js.map