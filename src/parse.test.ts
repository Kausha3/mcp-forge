import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSpec } from "./openapi.js";

const SPEC = {
  openapi: "3.0.0",
  info: { title: "Pets", version: "2.0" },
  servers: [{ url: "https://api.example.com/v1/" }],
  components: {
    parameters: { PetId: { name: "petId", in: "path", required: true, schema: { type: "integer" } } },
    schemas: { Pet: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  },
  paths: {
    "/pet/{petId}": {
      parameters: [{ $ref: "#/components/parameters/PetId" }], // path-level shared param via $ref
      get: { operationId: "getPet", summary: "Get a pet" },
      post: {
        summary: "Update a pet",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } },
      },
    },
    "/pet/findByStatus": {
      get: { operationId: "findByStatus", parameters: [{ name: "status", in: "query", required: true, schema: { type: "string" } }] },
    },
  },
};

test("base URL is taken from servers and trailing slash trimmed", () => {
  assert.equal(parseSpec(SPEC).baseUrl, "https://api.example.com/v1");
});

test("every path × method becomes an operation", () => {
  const ops = parseSpec(SPEC).operations;
  assert.equal(ops.length, 3);
});

test("$ref parameters and schemas are resolved and inlined", () => {
  const ops = parseSpec(SPEC).operations;
  const getPet = ops.find((o) => o.id === "getPet")!;
  const petId = getPet.params.find((p) => p.name === "petId")!;
  assert.equal(petId.in, "path");
  assert.equal(petId.required, true);
  assert.deepEqual(petId.schema, { type: "integer" }, "$ref parameter resolved");
});

test("path-level params are inherited and request bodies are resolved", () => {
  const ops = parseSpec(SPEC).operations;
  const update = ops.find((o) => o.method === "POST")!;
  assert.ok(update.params.some((p) => p.name === "petId"), "inherits the path-level petId param");
  assert.equal(update.bodyRequired, true);
  assert.deepEqual(update.bodySchema, { type: "object", properties: { name: { type: "string" } }, required: ["name"] });
});

test("operationId is generated when missing", () => {
  const update = parseSpec(SPEC).operations.find((o) => o.method === "POST")!;
  assert.match(update.id, /pet/, "generated id references the path");
});
