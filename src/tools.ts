// Turn normalized operations into MCP tools, and execute calls against the live API.
//
// Two modes:
//   direct  — one MCP tool per operation. Simple, best for small APIs.
//   search  — two meta-tools (search_endpoints, call_endpoint) so an API with hundreds
//             of endpoints doesn't flood the client's tool list. The agent searches for
//             what it needs, then calls it. This is what lets mcp-forge scale.

import type { ForgeConfig, JSONSchema, Operation, ParsedSpec } from "./types.js";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
}
export interface McpResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

const clip = (s: string, n = 300) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** JSON Schema for one operation's inputs: each parameter, plus `body` if it has one. */
export function inputSchema(op: Operation): JSONSchema {
  const properties: Record<string, JSONSchema> = {};
  const required: string[] = [];
  for (const p of op.params) {
    properties[p.name] = { ...p.schema, ...(p.description ? { description: p.description } : {}) };
    if (p.required) required.push(p.name);
  }
  if (op.bodySchema) {
    properties["body"] = op.bodySchema;
    if (op.bodyRequired) required.push("body");
  }
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}

function directTools(ops: Operation[]): McpTool[] {
  return ops.map((op) => ({
    name: op.id,
    description: clip(`${op.method} ${op.path}${op.summary ? ` — ${op.summary}` : ""}`),
    inputSchema: inputSchema(op),
  }));
}

function searchTools(): McpTool[] {
  return [
    {
      name: "search_endpoints",
      description:
        "Search this API's endpoints by keyword. Returns matching operationIds with their method, path, summary, and full input schema. Call this first to discover what to call.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "keywords, e.g. 'create user' or 'pet status'" } },
        required: ["query"],
      },
    },
    {
      name: "call_endpoint",
      description:
        "Call an endpoint by operationId (from search_endpoints). `arguments` is an object of the endpoint's named parameters, plus `body` for a request body.",
      inputSchema: {
        type: "object",
        properties: {
          operationId: { type: "string" },
          arguments: { type: "object", description: "parameters keyed by name; include `body` for the request body" },
        },
        required: ["operationId"],
      },
    },
  ];
}

/** The MCP tool list for this spec + config. */
export function listTools(spec: ParsedSpec, config: ForgeConfig): McpTool[] {
  return config.mode === "search" ? searchTools() : directTools(spec.operations);
}

// --- request building -------------------------------------------------------

export interface BuiltRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export function buildRequest(op: Operation, args: Record<string, any>, config: ForgeConfig): BuiltRequest {
  let path = op.path;
  const query = new URLSearchParams();
  const headers: Record<string, string> = { ...config.headers };

  for (const p of op.params) {
    const val = args?.[p.name];
    if (val === undefined || val === null) {
      if (p.required) throw new Error(`missing required parameter: ${p.name}`);
      continue;
    }
    if (p.in === "path") path = path.replace(`{${p.name}}`, encodeURIComponent(String(val)));
    else if (p.in === "query") {
      if (Array.isArray(val)) for (const v of val) query.append(p.name, String(v));
      else query.set(p.name, String(val));
    } else if (p.in === "header") headers[p.name] = String(val);
  }

  const qs = query.toString();
  const url = `${config.baseUrl}${path}${qs ? `?${qs}` : ""}`;

  let body: string | undefined;
  if (op.bodySchema && args?.body !== undefined) {
    headers["content-type"] = headers["content-type"] ?? "application/json";
    body = typeof args.body === "string" ? args.body : JSON.stringify(args.body);
  } else if (op.bodyRequired && args?.body === undefined) {
    throw new Error("missing required request body: body");
  }
  return { url, method: op.method, headers, body };
}

async function execute(op: Operation, args: Record<string, any>, config: ForgeConfig): Promise<McpResult> {
  const req = buildRequest(op, args, config);
  const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  const raw = await res.text();
  let pretty = raw;
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    /* leave as text */
  }
  return {
    content: [{ type: "text", text: `${req.method} ${req.url}\n→ ${res.status} ${res.statusText}\n\n${pretty}` }],
    isError: !res.ok,
  };
}

/** Rank operations against a query by simple keyword overlap. */
export function searchOperations(ops: Operation[], query: string, limit = 15): Operation[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = ops.map((op) => {
    const hay = `${op.id} ${op.method} ${op.path} ${op.summary} ${op.tags.join(" ")}`.toLowerCase();
    return { op, score: terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0) };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.op);
}

/** Handle an MCP tool call for this spec + config. */
export async function callTool(
  name: string,
  args: Record<string, any>,
  spec: ParsedSpec,
  config: ForgeConfig,
): Promise<McpResult> {
  const err = (text: string): McpResult => ({ content: [{ type: "text", text }], isError: true });

  if (config.mode === "search") {
    if (name === "search_endpoints") {
      const matches = searchOperations(spec.operations, String(args?.query ?? ""));
      const payload = matches.map((op) => ({
        operationId: op.id,
        method: op.method,
        path: op.path,
        summary: op.summary,
        input: inputSchema(op),
      }));
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    }
    if (name === "call_endpoint") {
      const op = spec.operations.find((o) => o.id === args?.operationId);
      if (!op) return err(`unknown operationId: ${args?.operationId}. Use search_endpoints to find valid ids.`);
      return execute(op, args?.arguments ?? {}, config);
    }
    return err(`unknown tool: ${name}`);
  }

  const op = spec.operations.find((o) => o.id === name);
  if (!op) return err(`unknown tool: ${name}`);
  return execute(op, args ?? {}, config);
}
