#!/usr/bin/env node
// mcp-forge — turn any OpenAPI/Swagger spec into an MCP server.
//
//   mcp-forge <spec>                       start an MCP server (stdio) for the spec
//   mcp-forge <spec> --config              print the Claude Desktop config snippet
//   mcp-forge <spec> --header "Authorization: Bearer $TOKEN"
//   mcp-forge <spec> --mode search         force search mode (default: auto)
//
// IMPORTANT: stdout is the MCP protocol channel — all human logging goes to stderr.

import { loadSpec, parseSpec } from "./openapi.js";
import { startStdio } from "./server.js";
import type { ForgeConfig } from "./types.js";

interface Args {
  spec?: string;
  baseUrl?: string;
  headers: Record<string, string>;
  mode: "direct" | "search" | "auto";
  threshold: number;
  printConfig: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { headers: {}, mode: "auto", threshold: 40, printConfig: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--config") args.printConfig = true;
    else if (a === "--base-url") args.baseUrl = argv[++i];
    else if (a === "--bearer") args.headers["Authorization"] = `Bearer ${argv[++i]}`;
    else if (a === "--header") {
      const h = argv[++i] ?? "";
      const idx = h.indexOf(":");
      if (idx > 0) args.headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
    } else if (a === "--mode") args.mode = (argv[++i] as Args["mode"]) ?? "auto";
    else if (a === "--search-threshold") args.threshold = Number(argv[++i]) || 40;
    else if (!a.startsWith("-") && !args.spec) args.spec = a;
  }
  return args;
}

const HELP = `mcp-forge — turn any OpenAPI/Swagger spec into an MCP server

Usage:
  mcp-forge <spec> [options]

  <spec>                 path or URL to an OpenAPI/Swagger spec (JSON or YAML)

Options:
  --config               print a Claude Desktop / MCP client config snippet and exit
  --base-url <url>       override the API base URL from the spec
  --header "K: V"        add a request header (repeatable), e.g. auth
  --bearer <token>       shorthand for --header "Authorization: Bearer <token>"
  --mode <m>             direct | search | auto  (default: auto)
  --search-threshold <n> switch auto mode to search above n operations (default: 40)
  -h, --help             show this help

Modes:
  direct  one tool per endpoint (best for small APIs)
  search  two tools (search_endpoints, call_endpoint) so large APIs don't flood the
          client — the agent searches for what it needs, then calls it
`;

function configSnippet(spec: string, argv: string[]): string {
  const passthrough = argv.filter((a) => a !== "--config");
  return JSON.stringify(
    { mcpServers: { api: { command: "npx", args: ["-y", "mcp-forge", ...passthrough] } } },
    null,
    2,
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.help || !args.spec) {
    process.stderr.write(HELP);
    process.exit(args.spec ? 0 : 1);
  }

  const spec = parseSpec(await loadSpec(args.spec), args.baseUrl);
  if (!spec.baseUrl) {
    process.stderr.write("Warning: no base URL in spec; pass --base-url <url>.\n");
  }

  const mode: ForgeConfig["mode"] =
    args.mode === "auto" ? (spec.operations.length > args.threshold ? "search" : "direct") : args.mode;

  if (args.printConfig) {
    process.stdout.write(configSnippet(args.spec, argv) + "\n");
    return;
  }

  process.stderr.write(
    `mcp-forge: ${spec.title} v${spec.version} — ${spec.operations.length} operations, ${mode} mode\n`,
  );
  await startStdio(spec, { baseUrl: spec.baseUrl, headers: args.headers, mode });
}

main().catch((e) => {
  process.stderr.write(`mcp-forge error: ${(e as Error).message}\n`);
  process.exit(1);
});
