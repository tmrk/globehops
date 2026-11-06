import type { Page } from '@playwright/test';
import { expect } from './fixtures.ts';

interface ToolResult {
  content: { text: string }[];
  isError?: boolean;
}
interface Tool {
  name: string;
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
              if (window.globeAgentTools[tool.name]) throw new Error('Duplicate tool');
              window.globeAgentTools[tool.name] = tool;
              window.globeAgentRegistrations++;
              options?.signal.addEventListener('abort', () => {
                delete window.globeAgentTools[tool.name];
              });
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
export async function invoke<T>(page: Page, name: string, args: unknown = {}): Promise<T> {
  const result = await page.evaluate(async ({ name, args }) => window.globeAgentTools[name].execute(args), {
    name,
    args,
  });
  expect(result.isError, result.content[0].text).not.toBe(true);
  return JSON.parse(result.content[0].text) as T;
}
export async function ready(page: Page) {
  await expect.poll(() => page.evaluate(() => Object.keys(window.globeAgentTools).length)).toBe(6);
}
