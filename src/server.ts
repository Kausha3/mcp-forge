// Wire the parsed spec into a low-level MCP server. The low-level Server takes raw JSON
// Schema in its tool list, which is exactly what we generate from OpenAPI.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ForgeConfig, ParsedSpec } from "./types.js";
import { callTool, listTools } from "./tools.js";

export function createServer(spec: ParsedSpec, config: ForgeConfig): Server {
  const server = new Server(
    { name: `mcp-forge (${spec.title})`, version: spec.version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listTools(spec, config) }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      return (await callTool(name, (args as Record<string, any>) ?? {}, spec, config)) as CallToolResult;
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true } as CallToolResult;
    }
  });

  return server;
}

/** Start the server on stdio (the transport MCP clients like Claude Desktop use). */
export async function startStdio(spec: ParsedSpec, config: ForgeConfig): Promise<Server> {
  const server = createServer(spec, config);
  await server.connect(new StdioServerTransport());
  return server;
}
