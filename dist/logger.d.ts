/**
 * File-based debug logging for zcode-antigravity-proxy.
 * Writes structured logs to ~/.zcode/antigravity-logs/ with daily rotation.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    data?: unknown;
}
/**
 * Initialize the logger. Must be called once before logging.
 */
export declare function initLogger(debug: boolean): void;
/**
 * Write a log entry to the daily log file.
 * Only writes debug/info when debug mode is enabled.
 * Always writes warn/error.
 */
export declare function writeLog(level: LogLevel, message: string, data?: unknown): void;
export declare const log: {
    debug: (msg: string, data?: unknown) => void;
    info: (msg: string, data?: unknown) => void;
    warn: (msg: string, data?: unknown) => void;
    error: (msg: string, data?: unknown) => void;
};
//# sourceMappingURL=logger.d.ts.map