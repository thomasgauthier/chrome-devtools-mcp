/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {logger} from '../logger.js';
import type {YargsOptions} from '../third_party/index.js';

import type {
  DaemonConnectionOptions,
  DaemonEndpoint,
  DaemonTransport,
} from './types.js';

export const DAEMON_SCRIPT_PATH = path.join(import.meta.dirname, 'daemon.js');
export const INDEX_SCRIPT_PATH = path.join(
  import.meta.dirname,
  '..',
  'bin',
  'chrome-devtools-mcp.js',
);

const APP_NAME = 'chrome-devtools-mcp';
export const DAEMON_CLIENT_NAME = 'chrome-devtools-cli-daemon';
export const DEFAULT_DAEMON_HOST = '127.0.0.1';
export const DEFAULT_DAEMON_PORT = 9229;

// Using these paths due to strict limits on the POSIX socket path length.
export function getSocketPath(sessionId: string): string {
  const uid = os.userInfo().uid;
  const suffix = sessionId ? `-${sessionId}` : '';
  const appName = APP_NAME + suffix;

  if (IS_WINDOWS) {
    // Windows uses Named Pipes, not file paths.
    // This format is required for server.listen()
    return path.join('\\\\.\\pipe', appName, 'server.sock');
  }

  // 1. Try XDG_RUNTIME_DIR (Linux standard, sometimes macOS)
  if (process.env.XDG_RUNTIME_DIR) {
    return path.join(process.env.XDG_RUNTIME_DIR, appName, 'server.sock');
  }

  // 2. macOS/Unix Fallback: Use /tmp/
  // We use /tmp/ because it is much shorter than ~/Library/Application Support/
  // and keeps us well under the 104-character limit.
  return path.join('/tmp', `${appName}-${uid}.sock`);
}

export function getDaemonEndpoint(
  sessionId: string,
  options: DaemonConnectionOptions = {},
): DaemonEndpoint {
  if (options.daemonUrl) {
    return parseDaemonUrl(options.daemonUrl);
  }

  if (options.transport === 'tcp') {
    return {
      transport: 'tcp',
      host: options.host || DEFAULT_DAEMON_HOST,
      port: options.port || DEFAULT_DAEMON_PORT,
    };
  }

  return {
    transport: 'unix',
    path: getSocketPath(sessionId),
  };
}

export function parseDaemonUrl(daemonUrl: string): DaemonEndpoint {
  const url = new URL(daemonUrl);
  if (url.protocol !== 'tcp:') {
    throw new Error(`Unsupported daemon URL protocol: ${url.protocol}`);
  }
  if (!url.hostname) {
    throw new Error('Daemon URL must include a host');
  }
  const port = Number(url.port || DEFAULT_DAEMON_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid daemon URL port: ${url.port}`);
  }
  return {
    transport: 'tcp',
    host: url.hostname,
    port,
  };
}

export function formatDaemonEndpoint(endpoint: DaemonEndpoint): string {
  if (endpoint.transport === 'tcp') {
    return `tcp://${endpoint.host}:${endpoint.port}`;
  }
  return endpoint.path;
}

export function parseDaemonTransport(
  value: string | undefined,
): DaemonTransport | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  if (value === 'tcp' || value === 'unix') {
    return value;
  }
  throw new Error(`Invalid daemon transport: ${value}`);
}

export function getRuntimeHome(sessionId: string): string {
  const platform = os.platform();
  const uid = os.userInfo().uid;
  const suffix = sessionId ? `-${sessionId}` : '';
  const appName = APP_NAME + suffix;

  // 1. Check for the modern Unix standard
  if (process.env.XDG_RUNTIME_DIR) {
    return path.join(process.env.XDG_RUNTIME_DIR, appName);
  }

  // 2. Fallback for macOS and older Linux
  if (platform === 'darwin' || platform === 'linux') {
    // /tmp is cleared on boot, making it perfect for PIDs
    return path.join('/tmp', `${appName}-${uid}`);
  }

  // 3. Windows Fallback
  return path.join(os.tmpdir(), appName);
}

export const IS_WINDOWS = os.platform() === 'win32';

export function getPidFilePath(sessionId: string) {
  const runtimeDir = getRuntimeHome(sessionId);
  return path.join(runtimeDir, 'daemon.pid');
}

export function getDaemonPid(sessionId: string) {
  try {
    const pidFile = getPidFilePath(sessionId);
    logger?.(`Daemon pid file ${pidFile} sessionId=${sessionId}`);
    if (!fs.existsSync(pidFile)) {
      return null;
    }
    const pidContent = fs.readFileSync(pidFile, 'utf-8');
    const pid = parseInt(pidContent.trim(), 10);
    logger?.(`Daemon pid: ${pid}`);
    if (isNaN(pid)) {
      return null;
    }
    return pid;
  } catch {
    return null;
  }
}

export function isDaemonRunning(sessionId: string): boolean {
  const pid = getDaemonPid(sessionId);
  if (pid) {
    try {
      process.kill(pid, 0); // Throws if process doesn't exist
      return true;
    } catch {
      // Process is dead, stale PID file. Proceed with startup.
    }
  }
  return false;
}

export function serializeArgs(
  options: Record<string, YargsOptions>,
  argv: Record<string, unknown>,
): string[] {
  const args: string[] = [];
  for (const key of Object.keys(options)) {
    if (argv[key] === undefined || argv[key] === null) {
      continue;
    }
    const value = argv[key];
    const kebabKey = key.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);

    if (typeof value === 'boolean') {
      if (value) {
        args.push(`--${kebabKey}`);
      } else {
        args.push(`--no-${kebabKey}`);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        args.push(`--${kebabKey}`, String(item));
      }
    } else {
      args.push(`--${kebabKey}`, String(value));
    }
  }
  return args;
}
