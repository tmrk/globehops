import { WEB_TOOL_NAMES } from '../src/agent/webTools.ts';
import type { Page } from '@playwright/test';
import { expect } from './fixtures.ts';

/** Legacy registrations answer in MCP's shape; the current draft's get plain data, or `{error}`. */
interface McpResult {
  content: { text: string }[];
  isError?: boolean;
}
type ToolResult = McpResult | Record<string, unknown>;
interface Tool {
  name: string;
  title?: string;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute: (args: unknown) => Promise<ToolResult>;
}
declare global {
  interface Window {
    globeAgentTools: Record<string, Tool>;
    globeAgentRegistrations: number;
    globeAgentRemovals: number;
  }
}
export async function installTools(page: Page, mode: 'legacy' | 'modern' | 'provide' | 'broken' = 'legacy') {
  await page.addInitScript((mode) => {
    window.globeAgentTools = {};
    window.globeAgentRegistrations = 0;
    window.globeAgentRemovals = 0;
    const api =
      mode === 'provide'
        ? {
            provideContext: ({ tools }: { tools: Tool[] }) => {
              window.globeAgentTools = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
            },
          }
        : {
            registerTool: (tool: Tool, options?: { signal: AbortSignal }) => {
              if (mode === 'broken' && tool.name === 'set_route') throw new Error('Experimental API failure');
              const clash = !!window.globeAgentTools[tool.name];
              if (clash && mode !== 'modern') throw new Error('Duplicate tool');
              if (!clash) {
                window.globeAgentTools[tool.name] = tool;
                window.globeAgentRegistrations++;
                options?.signal.addEventListener('abort', () => {
                  delete window.globeAgentTools[tool.name];
                });
              }
              // The current draft settles a promise instead of throwing.
              if (mode === 'modern')
                return clash ? Promise.reject(new DOMException('Duplicate tool')) : Promise.resolve();
            },
            ...(mode !== 'modern'
              ? {
                  unregisterTool: (name: string) => {
                    delete window.globeAgentTools[name];
                    window.globeAgentRemovals++;
                  },
                }
              : {}),
          };
    Object.defineProperty(mode === 'modern' ? document : navigator, 'modelContext', { value: api, configurable: true });
  }, mode);
}
/** A tool's outcome in either shape: its data, or the error message an agent would read. */
export async function call(page: Page, name: string, args: unknown = {}) {
  const result = await page.evaluate(async ({ name, args }) => window.globeAgentTools[name].execute(args), {
    name,
    args,
  });
  if ('content' in result && Array.isArray(result.content)) {
    const mcp = result as McpResult;
    const data = JSON.parse(mcp.content[0].text) as Record<string, unknown>;
    return mcp.isError ? { error: String(data.error) } : { data };
  }
  const data = result as Record<string, unknown>;
  return typeof data.error === 'string' ? { error: data.error } : { data };
}
export async function invoke<T>(page: Page, name: string, args: unknown = {}): Promise<T> {
  const outcome = await call(page, name, args);
  expect(outcome.error).toBeUndefined();
  return outcome.data as T;
}
export async function ready(page: Page) {
  await expect.poll(() => page.evaluate(() => Object.keys(window.globeAgentTools).length)).toBe(WEB_TOOL_NAMES.length);
}
