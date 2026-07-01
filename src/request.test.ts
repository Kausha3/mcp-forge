import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSpec } from "./openapi.js";
import { buildRequest, inputSchema, searchOperations } from "./tools.js";
import type { ForgeConfig } from "./types.js";

const SPEC = {
  openapi: "3.0.0",
  info: { title: "Pets", version: "1" },
  servers: [{ url: "https://api.example.com" }],
  paths: {
    "/pet/{petId}": { get: { operationId: "getPet", parameters: [{ name: "petId", in: "path", required: true, schema: { type: "integer" } }] } },
    "/pet/findByStatus": { get: { operationId: "findByStatus", summary: "find pets by status", parameters: [{ name: "status", in: "query", required: true, schema: { type: "string" } }] } },
    "/pet": { post: { operationId: "addPet", requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" } } } } } } } },
  },
};

const spec = parseSpec(SPEC);
const op = (id: string) => spec.operations.find((o) => o.id === id)!;
const config = (headers: Record<string, string> = {}): ForgeConfig => ({ baseUrl: spec.baseUrl, headers, mode: "direct" });

test("path parameters are substituted into the URL", () => {
  const r = buildRequest(op("getPet"), { petId: 7 }, config());
  assert.equal(r.url, "https://api.example.com/pet/7");
  assert.equal(r.method, "GET");
});

test("query parameters are appended", () => {
  const r = buildRequest(op("findByStatus"), { status: "available" }, config());
  assert.equal(r.url, "https://api.example.com/pet/findByStatus?status=available");
});

test("configured headers (auth) are passed through", () => {
  const r = buildRequest(op("getPet"), { petId: 1 }, config({ Authorization: "Bearer xyz" }));
  assert.equal(r.headers["Authorization"], "Bearer xyz");
});

test("a missing required parameter throws a clear error", () => {
  assert.throws(() => buildRequest(op("getPet"), {}, config()), /missing required parameter: petId/);
});

test("a JSON body is serialized with a content-type", () => {
  const r = buildRequest(op("addPet"), { body: { name: "Milo" } }, config());
  assert.equal(r.method, "POST");
  assert.equal(r.body, JSON.stringify({ name: "Milo" }));
  assert.equal(r.headers["content-type"], "application/json");
});

test("inputSchema exposes each parameter with its required set", () => {
  const s = inputSchema(op("getPet")) as { properties: Record<string, unknown>; required: string[] };
  assert.ok("petId" in s.properties);
  assert.deepEqual(s.required, ["petId"]);
});

test("searchOperations ranks by keyword overlap", () => {
  const hits = searchOperations(spec.operations, "status");
  assert.equal(hits[0]!.id, "findByStatus");
});
