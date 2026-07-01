// End-to-end, fully offline: a local HTTP "API" + a real MCP client talking to the
// generated MCP server in-process. Exercises tool listing, direct + search modes, and a
// live HTTP round-trip — the whole pipeline, no external network.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttp, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { parseSpec } from "./openapi.js";
import { createServer } from "./server.js";
import type { ForgeConfig } from "./types.js";

let api: HttpServer;
let port: number;

before(async () => {
  api = createHttp((req, res) => {
    if (req.method === "GET" && req.url?.startsWith("/pet/findByStatus")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify([{ id: 1, name: "Rex", status: "available" }]));
    } else if (req.method === "POST" && req.url === "/pet") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.statusCode = 201;
        res.setHeader("content-type", "application/json");
        res.end(body);
      });
    } else {
      res.statusCode = 404;
      res.end("not found");
    }
  });
  await new Promise<void>((r) => api.listen(0, r));
  port = (api.address() as AddressInfo).port;
});

after(() => api.close());

function makeSpec() {
  return {
    openapi: "3.0.0",
    info: { title: "Pets", version: "1" },
    servers: [{ url: `http://127.0.0.1:${port}` }],
    paths: {
      "/pet/findByStatus": {
        get: { operationId: "findByStatus", summary: "find pets by status", parameters: [{ name: "status", in: "query", required: true, schema: { type: "string" } }] },
      },
      "/pet": {
        post: { operationId: "addPet", summary: "add a pet", requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } } } },
      },
    },
  };
}

async function connect(mode: ForgeConfig["mode"]): Promise<Client> {
  const spec = parseSpec(makeSpec());
  const server = createServer(spec, { baseUrl: spec.baseUrl, headers: {}, mode });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" }, { capabilities: {} });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

const firstText = (r: any): string => (r.content as Array<{ text: string }>)[0]!.text;

test("direct mode: one tool per endpoint, and a real call hits the API", async () => {
  const client = await connect("direct");
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["addPet", "findByStatus"]);

  const get = await client.callTool({ name: "findByStatus", arguments: { status: "available" } });
  assert.match(firstText(get), /Rex/, "the live API response comes back through MCP");

  const post = await client.callTool({ name: "addPet", arguments: { body: { name: "Milo" } } });
  assert.match(firstText(post), /Milo/);
  assert.match(firstText(post), /201/, "status code is surfaced");
});

test("search mode: two meta-tools; agent searches then calls (scales to large APIs)", async () => {
  const client = await connect("search");
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["call_endpoint", "search_endpoints"]);

  const found = await client.callTool({ name: "search_endpoints", arguments: { query: "status" } });
  assert.match(firstText(found), /findByStatus/);

  const called = await client.callTool({
    name: "call_endpoint",
    arguments: { operationId: "findByStatus", arguments: { status: "available" } },
  });
  assert.match(firstText(called), /Rex/);
});

test("an unknown tool returns an MCP error, not a crash", async () => {
  const client = await connect("direct");
  const r = await client.callTool({ name: "nope", arguments: {} });
  assert.equal((r as { isError?: boolean }).isError, true);
  assert.match(firstText(r), /unknown tool/);
});
