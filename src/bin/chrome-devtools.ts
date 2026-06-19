#!/usr/bin/env node

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

process.title = 'chrome-devtools';

import process from 'node:process';

import type {Options, PositionalOptions} from 'yargs';

import {
  startDaemon,
  stopDaemon,
  sendCommand,
  handleResponse,
} from '../daemon/client.js';
import type {
  DaemonConnectionOptions,
  DaemonTransport,
} from '../daemon/types.js';
import {
  DEFAULT_DAEMON_HOST,
  DEFAULT_DAEMON_PORT,
  isDaemonRunning,
  serializeArgs,
} from '../daemon/utils.js';
import {logDisclaimers} from '../index.js';
import {hideBin, yargs, type CallToolResult} from '../third_party/index.js';
import {checkForUpdates} from '../utils/check-for-updates.js';
import {VERSION} from '../version.js';

import {commands} from './chrome-devtools-cli-options.js';
import {cliOptions, parseArguments} from './chrome-devtools-mcp-cli-options.js';

await checkForUpdates(
  'Run `npm install -g chrome-devtools-mcp@latest` and `chrome-devtools start` to update and restart the daemon.',
);

async function start(
  args: string[],
  sessionId: string,
  daemonOptions: DaemonConnectionOptions = {},
) {
  const combinedArgs = [...args, ...defaultArgs];
  await startDaemon(combinedArgs, sessionId, daemonOptions);
  logDisclaimers(parseArguments(VERSION, combinedArgs));
}

const defaultArgs = ['--viaCli', '--experimentalStructuredContent'];

interface DaemonCliArgv {
  daemonUrl?: unknown;
  daemonTransport?: unknown;
  daemonHost?: unknown;
  daemonPort?: unknown;
}

function parseDaemonTransportArg(value: unknown): DaemonTransport | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'unix' || value === 'tcp') {
    return value;
  }
  throw new Error(`Invalid daemon transport: ${String(value)}`);
}

function getDaemonOptions(
  argv: DaemonCliArgv,
  includeDaemonUrl: boolean,
): DaemonConnectionOptions {
  const options: DaemonConnectionOptions = {};
  if (includeDaemonUrl && typeof argv.daemonUrl === 'string') {
    options.daemonUrl = argv.daemonUrl;
  }
  const transport = parseDaemonTransportArg(argv.daemonTransport);
  if (transport) {
    options.transport = transport;
  }
  if (typeof argv.daemonHost === 'string') {
    options.host = argv.daemonHost;
  }
  if (typeof argv.daemonPort === 'number') {
    options.port = argv.daemonPort;
  }
  return options;
}

const daemonCliOptions = {
  daemonTransport: {
    alias: 'daemon-transport',
    choices: ['unix', 'tcp'],
    default: 'unix',
    description: 'Transport for the background daemon.',
  },
  daemonHost: {
    alias: 'daemon-host',
    type: 'string',
    default: DEFAULT_DAEMON_HOST,
    description: 'Host for TCP daemon transport.',
  },
  daemonPort: {
    alias: 'daemon-port',
    type: 'number',
    default: DEFAULT_DAEMON_PORT,
    description: 'Port for TCP daemon transport.',
  },
  daemonUrl: {
    alias: 'daemon-url',
    type: 'string',
    description:
      'Daemon URL for commands to connect to, e.g. tcp://127.0.0.1:9229.',
  },
} satisfies Record<string, Options>;

const startCliOptions = {
  ...cliOptions,
} as Partial<typeof cliOptions>;

// Missing CLI serialization.
delete startCliOptions.viewport;

// Change the defaults for the CLI.
delete startCliOptions.experimentalStructuredContent;
delete startCliOptions.experimentalInteropTools;
delete startCliOptions.experimentalPageIdRouting;
if (!('default' in cliOptions.headless)) {
  throw new Error('headless cli option unexpectedly does not have a default');
}
if ('default' in cliOptions.isolated) {
  throw new Error('isolated cli option unexpectedly has a default');
}
startCliOptions.headless!.default = true;
startCliOptions.isolated!.description =
  'If specified, creates a temporary user-data-dir that is automatically cleaned up after the browser is closed. Defaults to true unless userDataDir is provided.';
startCliOptions.categoryExtensions!.default = true;

const y = yargs(hideBin(process.argv))
  .scriptName('chrome-devtools')
  .showHelpOnFail(true)
  .usage('chrome-devtools <command> [...args] --flags')
  .usage(
    `Run 'chrome-devtools <command> --help' for help on the specific command.`,
  )
  .option('sessionId', {
    type: 'string',
    description: 'Session ID for daemon scoping',
    default: '',
    hidden: true,
  })
  .options(daemonCliOptions)
  .demandCommand()
  .version(VERSION)
  .strict()
  .help(true)
  .wrap(120);

y.command(
  'start',
  'Start or restart chrome-devtools-mcp',
  y =>
    y
      .options(startCliOptions)
      .example(
        '$0 start --browserUrl http://localhost:9222',
        'Start the server connecting to an existing browser',
      )
      .strict(),
  async argv => {
    const daemonOptions = getDaemonOptions(argv, false);
    if (isDaemonRunning(argv.sessionId)) {
      await stopDaemon(argv.sessionId, daemonOptions);
    }
    // Defaults but we do not want to affect the yargs conflict resolution.
    if (argv.isolated === undefined && argv.userDataDir === undefined) {
      argv.isolated = true;
    }
    if (argv.headless === undefined) {
      argv.headless = true;
    }
    const args = serializeArgs(cliOptions, argv);
    await start(args, argv.sessionId, daemonOptions);
    process.exit(0);
  },
).strict(); // Re-enable strict validation for other commands; this is applied to the yargs instance itself

y.command(
  'status',
  'Checks if chrome-devtools-mcp is running',
  y => y,
  async argv => {
    const daemonOptions = getDaemonOptions(argv, true);
    if (daemonOptions.daemonUrl || isDaemonRunning(argv.sessionId)) {
      const response = await sendCommand(
        {
          method: 'status',
        },
        argv.sessionId,
        daemonOptions,
      );
      if (response.success) {
        console.log('chrome-devtools-mcp daemon is running.');
        const data = JSON.parse(response.result) as {
          pid: number | null;
          socketPath: string;
          startDate: string;
          version: string;
          args: string[];
        };
        console.log(
          `pid=${data.pid} socket=${data.socketPath} start-date=${data.startDate} version=${data.version}`,
        );
        console.log(`args=${JSON.stringify(data.args)}`);
      } else {
        console.error('Error:', response.error);
        process.exit(1);
      }
    } else {
      console.log('chrome-devtools-mcp daemon is not running.');
    }
    process.exit(0);
  },
);

y.command(
  'stop',
  'Stop chrome-devtools-mcp if any',
  y => y,
  async argv => {
    const sessionId = argv.sessionId as string;
    const daemonOptions = getDaemonOptions(argv, true);
    if (!daemonOptions.daemonUrl && !isDaemonRunning(sessionId)) {
      process.exit(0);
    }
    await stopDaemon(sessionId, daemonOptions);
    process.exit(0);
  },
);

for (const [commandName, commandDef] of Object.entries(commands)) {
  const args = commandDef.args;
  const requiredArgNames = Object.keys(args).filter(
    name => args[name].required,
  );

  const optionalArgNames = Object.keys(args).filter(
    name => !args[name].required,
  );

  let commandStr = commandName;
  for (const arg of requiredArgNames) {
    commandStr += ` <${arg}>`;
  }

  for (const arg of optionalArgNames) {
    commandStr += ` [--${arg}]`;
  }

  y.command(
    commandStr,
    commandDef.description,
    y => {
      y.option('output-format', {
        choices: ['md', 'json'],
        default: 'md',
      });
      for (const [argName, opt] of Object.entries(args)) {
        const type =
          opt.type === 'integer' || opt.type === 'number'
            ? 'number'
            : opt.type === 'boolean'
              ? 'boolean'
              : opt.type === 'array'
                ? 'array'
                : 'string';

        if (opt.required) {
          const options: PositionalOptions = {
            describe: opt.description,
            type: type as PositionalOptions['type'],
          };
          if (opt.default !== undefined) {
            options.default = opt.default;
          }
          if (opt.enum) {
            options.choices = opt.enum as Array<string | number>;
          }
          y.positional(argName, options);
        } else {
          const options: Options = {
            describe: opt.description,
            type: type as Options['type'],
          };
          if (opt.default !== undefined) {
            options.default = opt.default;
          }
          if (opt.enum) {
            options.choices = opt.enum as Array<string | number>;
          }
          y.option(argName, options);
        }
      }
    },
    async argv => {
      const sessionId = argv.sessionId as string;
      const daemonOptions = getDaemonOptions(argv, true);
      try {
        if (!daemonOptions.daemonUrl && !isDaemonRunning(sessionId)) {
          await start([], sessionId, daemonOptions);
        }

        const commandArgs: Record<string, unknown> = {};
        for (const argName of Object.keys(args)) {
          if (argName in argv) {
            commandArgs[argName] = argv[argName];
          }
        }

        const response = await sendCommand(
          {
            method: 'invoke_tool',
            tool: commandName,
            args: commandArgs,
          },
          sessionId,
          daemonOptions,
        );

        if (response.success) {
          console.log(
            await handleResponse(
              JSON.parse(response.result) as unknown as CallToolResult,
              argv['output-format'] as 'json' | 'md',
            ),
          );
        } else {
          console.error('Error:', response.error);
          process.exit(1);
        }
      } catch (error) {
        console.error('Failed to execute command:', error);
        process.exit(1);
      }
    },
  );
}

await y.parse();
