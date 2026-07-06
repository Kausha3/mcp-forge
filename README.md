# mcp-forge

[![CI](https://github.com/Kausha3/mcp-forge/actions/workflows/ci.yml/badge.svg)](https://github.com/Kausha3/mcp-forge/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@kausha17/mcp-forge.svg)](https://www.npmjs.com/package/@kausha17/mcp-forge)

**Turn any OpenAPI/Swagger spec into an MCP server your AI agent can actually call.**
Point it at a spec, and every endpoint becomes a tool for Claude Desktop, Cursor, Cline,
or any [MCP](https://modelcontextprotocol.io) client. One command, no code.

```bash
npx @kausha17/mcp-forge https://petstore3.swagger.io/api/v3/openapi.json \
  --base-url https://petstore3.swagger.io/api/v3
# → an MCP server exposing 19 tools (addPet, findPetsByStatus, getPetById, …)
```

That example is real and tested — an MCP client connects, lists 19 tools, calls
`findPetsByStatus`, and gets live pet data back (see `src/e2e.test.ts`).

## Use it in Claude Desktop (or any MCP client)

Print a ready-to-paste config with `--config`:

```bash
npx @kausha17/mcp-forge <your-spec> --config
```

```jsonc
{
  "mcpServers": {
    "api": { "command": "npx", "args": ["-y", "@kausha17/mcp-forge", "<your-spec>"] }
  }
}
```

Drop it into your MCP client's config and your agent can call the API.

## Scales to large APIs (the part other tools miss)

A naive "one tool per endpoint" bridge falls over on real APIs: 200 endpoints means 200
tools flooding the model's context, and it picks the wrong one. `mcp-forge` switches to
**search mode** automatically above 40 operations (configurable). Instead of hundreds of
tools it exposes two:

- **`search_endpoints({ query })`** — the agent searches the API for what it needs and
  gets back the matching operations with their schemas.
- **`call_endpoint({ operationId, arguments })`** — then calls the one it found.

So a 400-endpoint enterprise API stays usable. Force it with `--mode search`, or keep
`--mode direct` for small APIs.

## Auth

Pass headers through to the upstream API:

```bash
npx @kausha17/mcp-forge <spec> --bearer "$TOKEN"
npx @kausha17/mcp-forge <spec> --header "X-API-Key: $KEY" --header "Accept: application/json"
```

## Options

```
mcp-forge <spec> [options]

  <spec>                  path or URL to an OpenAPI/Swagger spec (JSON or YAML)
  --config                print an MCP client config snippet and exit
  --base-url <url>        override the API base URL from the spec
  --header "K: V"         add a request header (repeatable)
  --bearer <token>        shorthand for Authorization: Bearer <token>
  --mode <m>              direct | search | auto   (default: auto)
  --search-threshold <n>  auto switches to search above n operations (default: 40)
```

## How it works

1. **Parse** the spec (OpenAPI 3.x or Swagger 2.0, JSON or YAML), resolving `$ref`s and
   inlining schemas so MCP clients get self-contained JSON Schema.
2. **Generate** an MCP tool per operation (or the two search tools), with inputs derived
   from path/query/header parameters and the request body.
3. **Serve** over stdio. On a tool call, it builds the HTTP request (path substitution,
   query, headers, body), calls the upstream API, and returns the response.

## As a library

```ts
import { loadSpec, parseSpec, createServer } from "@kausha17/mcp-forge";

const spec = parseSpec(await loadSpec("./openapi.yaml"), "https://api.example.com");
const server = createServer(spec, { baseUrl: spec.baseUrl, headers: {}, mode: "auto" });
// connect `server` to any MCP transport
```

## Develop

```bash
npm install
npm test        # unit + a full offline end-to-end (local API + MCP client round-trip)
npm run build
```

## License

MIT
