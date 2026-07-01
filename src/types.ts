/** A JSON Schema object (loosely typed — we pass it through to the MCP client). */
export type JSONSchema = Record<string, unknown>;

export interface Param {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  schema: JSONSchema;
  description?: string;
}

/** One API operation, normalized from an OpenAPI path + method. */
export interface Operation {
  id: string;
  method: string; // upper-case: GET, POST, ...
  path: string; // e.g. /pet/{petId}
  summary: string;
  description: string;
  tags: string[];
  params: Param[];
  bodySchema?: JSONSchema; // application/json request body, if any
  bodyRequired: boolean;
}

export interface ParsedSpec {
  title: string;
  version: string;
  baseUrl: string;
  operations: Operation[];
}

export interface ForgeConfig {
  /** Overrides the base URL from the spec's `servers`. */
  baseUrl: string;
  /** Headers sent with every request (auth, etc.). */
  headers: Record<string, string>;
  /**
   * "direct": one MCP tool per operation. "search": two meta-tools
   * (search_endpoints + call_endpoint) so huge APIs don't overwhelm the client.
   */
  mode: "direct" | "search";
}
