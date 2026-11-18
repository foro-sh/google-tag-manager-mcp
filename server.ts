import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { CORE_VERSION } from 'google-tag-manager-mcp-core'
import { BrokerTokens, brokerConfigFromEnv } from './broker.ts'
import { registerTools } from './tools.ts'

const broker = new BrokerTokens(brokerConfigFromEnv())

// One server per request: the auth provider is the caller's, and with per-user
// grants two callers see different Tag Manager accounts.
const handler = createMcpHandler(({ requestInfo }) => {
  const server = new McpServer({ name: 'google-tag-manager-mcp', version: CORE_VERSION })
  registerTools(server, { auth: broker.forRequest(requestInfo?.headers ?? new Headers()) })
  return server
})
const serve = toNodeHandler(handler)

const http = createServer((req, res) => {
  // foro's generated client configs point at `<url>/mcp`.
  if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/mcp') {
    res.writeHead(404).end()
    return
  }
  serve(req, res)
})

// foro sets PORT. Bind all interfaces: a server on 127.0.0.1 fails the health check.
http.listen(Number(process.env.PORT ?? 8000), () => {
  const { port } = http.address() as AddressInfo
  console.log(`Google Tag Manager MCP server listening on http://localhost:${port}/mcp`)
})
