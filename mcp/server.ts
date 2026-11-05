import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { context } from './data.ts';
import { registerTools } from './tools.ts';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
const server = new McpServer({ name: 'globehops', version: pkg.version });
registerTools(server, context);
try {
  await server.connect(new StdioServerTransport());
} catch (error) {
  console.error('GlobeHops MCP startup failed:', error);
  process.exitCode = 1;
}
