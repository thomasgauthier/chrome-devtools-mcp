/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type DaemonTransport = 'unix' | 'tcp';

export type DaemonEndpoint =
  | {
      transport: 'unix';
      path: string;
    }
  | {
      transport: 'tcp';
      host: string;
      port: number;
    };

export interface DaemonConnectionOptions {
  daemonUrl?: string;
  transport?: DaemonTransport;
  host?: string;
  port?: number;
}

export type DaemonMessage =
  | {
      method: 'stop';
    }
  | {
      method: 'status';
    }
  | {
      method: 'invoke_tool';
      tool: string;
      args?: Record<string, unknown>;
    };

export interface DaemonResponse {
  success: boolean;
  // Stringified CallToolResult.
  result: string;
  error: unknown;
}
