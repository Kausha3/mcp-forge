// Load an OpenAPI/Swagger spec (file path or URL, JSON or YAML) and normalize it into a
// flat list of operations with fully-inlined JSON Schemas (no $ref left dangling, since
// MCP clients won't resolve them).

import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { JSONSchema, Operation, Param, ParsedSpec } from "./types.js";

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

/** Read a spec from an http(s) URL or a local file, parsing JSON or YAML. */
export async function loadSpec(source: string): Promise<Record<string, unknown>> {
  let raw: string;
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Failed to fetch spec: ${res.status} ${res.statusText}`);
    raw = await res.text();
  } else {
    raw = await readFile(source, "utf8");
  }
  try {
    return JSON.parse(raw);
  } catch {
    return parseYaml(raw) as Record<string, unknown>;
  }
}

/** Resolve a local "#/..." JSON Pointer against the root document. */
function pointer(root: any, ref: string): any {
  if (!ref.startsWith("#/")) return {};
  return ref
    .slice(2)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((acc, key) => (acc == null ? acc : acc[key]), root);
}

/** Recursively inline local $refs so the resulting schema is self-contained. */
function deref(root: any, node: any, seen = new Set<string>()): any {
  if (node == null || typeof node !== "object") return node;
  if (typeof node.$ref === "string") {
    if (seen.has(node.$ref)) return {}; // cycle guard
    const next = new Set(seen).add(node.$ref);
    return deref(root, pointer(root, node.$ref), next);
  }
  if (Array.isArray(node)) return node.map((n) => deref(root, n, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) out[k] = deref(root, v, seen);
  return out;
}

function opId(explicit: string | undefined, method: string, path: string): string {
  if (explicit) return explicit.replace(/[^A-Za-z0-9_]/g, "_");
  const p = path.replace(/[/{}]/g, " ").trim().split(/\s+/).join("_");
  return `${method}_${p}`.replace(/[^A-Za-z0-9_]/g, "_").toLowerCase();
}

function toParam(root: any, raw: any): Param | null {
  const p = deref(root, raw);
  if (!p?.name || !["path", "query", "header"].includes(p.in)) return null;
  return {
    name: p.name,
    in: p.in,
    required: p.in === "path" ? true : Boolean(p.required),
    schema: (p.schema as JSONSchema) ?? { type: "string" },
    description: p.description,
  };
}

function bodyOf(root: any, op: any): { schema?: JSONSchema; required: boolean } {
  const body = deref(root, op.requestBody);
  const json = body?.content?.["application/json"]?.schema;
  if (!json) return { required: false };
  return { schema: json as JSONSchema, required: Boolean(body.required) };
}

/** Normalize a whole spec into operations. */
export function parseSpec(spec: any, baseUrlOverride?: string): ParsedSpec {
  const info = spec.info ?? {};
  // OpenAPI 3 uses `servers`; Swagger 2 uses `host` + `basePath`.
  const serverUrl = spec.servers?.[0]?.url ?? (spec.host ? `https://${spec.host}${spec.basePath ?? ""}` : "");
  const baseUrl = (baseUrlOverride || serverUrl || "").replace(/\/$/, "");

  const operations: Operation[] = [];
  for (const [path, pathItemRaw] of Object.entries<any>(spec.paths ?? {})) {
    const pathItem = pathItemRaw ?? {};
    const sharedParams = (pathItem.parameters ?? []).map((p: any) => toParam(spec, p)).filter(Boolean) as Param[];
    for (const method of METHODS) {
      const op = pathItem[method];
      if (!op) continue;
      const params = [
        ...sharedParams,
        ...((op.parameters ?? []).map((p: any) => toParam(spec, p)).filter(Boolean) as Param[]),
      ];
      const { schema, required } = bodyOf(spec, op);
      operations.push({
        id: opId(op.operationId, method, path),
        method: method.toUpperCase(),
        path,
        summary: op.summary ?? "",
        description: op.description ?? op.summary ?? "",
        tags: op.tags ?? [],
        params,
        bodySchema: schema,
        bodyRequired: required,
      });
    }
  }

  return { title: info.title ?? "API", version: info.version ?? "1.0.0", baseUrl, operations };
}
