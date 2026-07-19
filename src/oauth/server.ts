/**
 * OAuth callback server — captures the Google OAuth redirect on localhost.
 * Ported from opencode-antigravity-auth plugin/server.ts
 */

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";

// ---- Environment Detection ----

function isWSL(): boolean {
  if (process.platform !== "linux") return false;
  try {
    const release = readFileSync("/proc/version", "utf8").toLowerCase();
    return release.includes("microsoft") || release.includes("wsl");
  } catch {
    return false;
  }
}

function isRemoteEnvironment(): boolean {
  if (process.env.SSH_CLIENT || process.env.SSH_TTY || process.env.SSH_CONNECTION) {
    return true;
  }
  if (process.env.REMOTE_CONTAINERS || process.env.CODESPACES) {
    return true;
  }
  return false;
}

function getBindAddress(): string {
  const envBind = process.env.ANTIGRAVITY_OAUTH_BIND;
  if (envBind) return envBind;
  if (isWSL() || isRemoteEnvironment()) return "0.0.0.0";
  return "127.0.0.1";
}

// ---- OAuth Listener ----

export interface OAuthListener {
  waitForCallback(): Promise<URL>;
  close(): Promise<void>;
}

const SUCCESS_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authentication Successful</title>
  <style>
    :root { --bg: #FAFAFA; --card-bg: #FFFFFF; --text-primary: #1F2937;
            --text-secondary: #6B7280; --accent: #2563EB; --success: #10B981; --border: #E5E7EB; }
    @media (prefers-color-scheme: dark) {
      :root { --bg: #111827; --card-bg: #1F2937; --text-primary: #F9FAFB;
              --text-secondary: #9CA3AF; --accent: #3B82F6; --success: #34D399; --border: #374151; }
    }
    body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
           font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
           background:var(--bg); color:var(--text-primary); padding:1rem; }
    .card { background:var(--card-bg); border-radius:16px; padding:3rem 2rem; width:100%;
            max-width:400px; text-align:center;
            box-shadow:0 4px 6px -1px rgba(0,0,0,0.1); border:1px solid var(--border); }
    .icon { width:64px; height:64px; background:rgba(16,185,129,0.1); border-radius:50%;
            display:flex; align-items:center; justify-content:center; margin:0 auto 1.5rem; }
    .icon svg { width:32px; height:32px; color:var(--success); }
    h1 { font-size:1.5rem; font-weight:600; margin:0 0 0.5rem; }
    p { color:var(--text-secondary); font-size:0.95rem; line-height:1.5; margin:0 0 2rem; }
    .btn { display:inline-flex; align-items:center; justify-content:center;
           background:var(--text-primary); color:var(--card-bg); font-weight:500;
           padding:0.75rem 1.5rem; border-radius:8px; border:none; cursor:pointer;
           width:100%; box-sizing:border-box; font-size:0.95rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
    </svg></div>
    <h1>All set!</h1>
    <p>You've successfully authenticated with Antigravity. You can now return to your terminal.</p>
    <button class="btn" onclick="window.close()">Close this tab</button>
  </div>
</body>
</html>`;

/**
 * Starts a lightweight HTTP server that listens for the Antigravity OAuth redirect
 * and resolves with the captured callback URL.
 */
export async function startOAuthListener(
  port: number = 51121,
): Promise<OAuthListener> {
  const callbackPath = "/oauth-callback";
  const origin = `http://localhost:${port}`;

  let settled = false;
  let resolveCallback: (url: URL) => void;
  let rejectCallback: (error: Error) => void;
  let timeoutHandle: NodeJS.Timeout;

  const callbackPromise = new Promise<URL>((resolve, reject) => {
    resolveCallback = (url: URL) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve(url);
    };
    rejectCallback = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      reject(error);
    };
  });

  timeoutHandle = setTimeout(() => {
    rejectCallback(new Error("Timed out waiting for OAuth callback"));
  }, 5 * 60 * 1000);
  timeoutHandle.unref?.();

  const server = createServer((request, response) => {
    if (!request.url) {
      response.writeHead(400, { "Content-Type": "text/plain" });
      response.end("Invalid request");
      return;
    }

    const url = new URL(request.url, origin);
    if (url.pathname !== callbackPath) {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(SUCCESS_PAGE);
    resolveCallback(url);

    setImmediate(() => {
      server.close();
    });
  });

  const bindAddress = getBindAddress();

  await new Promise<void>((resolve, reject) => {
    const handleError = (error: NodeJS.ErrnoException) => {
      server.off("error", handleError);
      if (error.code === "EADDRINUSE") {
        reject(new Error(`Port ${port} is already in use.`));
        return;
      }
      reject(error);
    };
    server.once("error", handleError);
    server.listen(port, bindAddress, () => {
      server.off("error", handleError);
      resolve();
    });
  });

  server.on("error", (error) => {
    rejectCallback(error instanceof Error ? error : new Error(String(error)));
  });

  return {
    waitForCallback: () => callbackPromise,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
            reject(error);
            return;
          }
          if (!settled) {
            rejectCallback(new Error("OAuth listener closed before callback"));
          }
          resolve();
        });
      }),
  };
}
