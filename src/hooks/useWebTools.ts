import { useEffect, useLayoutEffect, useRef } from 'react';
import { WEB_TOOL_DEFINITIONS, type WebToolName } from '../agent/webTools.ts';

interface BrowserTool {
  name: string;
  description: string;
  inputSchema: object;
  execute: (args: unknown) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>;
}
interface ModelContext {
  registerTool?: (tool: BrowserTool, options?: { signal: AbortSignal }) => void;
  unregisterTool?: (name: string) => void;
  provideContext?: (context: { tools: BrowserTool[] }) => void;
}
/** Experimental WebMCP is optional; a broken or missing implementation cannot break the app. */
export function useWebTools(
  ready: boolean,
  execute: (name: WebToolName, args: unknown, signal: AbortSignal) => Promise<unknown>,
) {
  const latest = useRef(execute);
  useLayoutEffect(() => {
    latest.current = execute;
  });
  useEffect(() => {
    if (!ready) return;
    const registered: string[] = [];
    const controller = new AbortController();
    let context: ModelContext | undefined;
    let provided = false;
    let active = true;
    const cleanup = () => {
      active = false;
      controller.abort();
      for (const name of registered) {
        try {
          context?.unregisterTool?.(name);
        } catch {
          /* Experimental API. */
        }
      }
      if (provided) {
        try {
          context?.provideContext?.({ tools: [] });
        } catch {
          /* Experimental API. */
        }
      }
    };
    try {
      const modern = (document as Document & { modelContext?: ModelContext }).modelContext;
      context = modern ?? (navigator as Navigator & { modelContext?: ModelContext }).modelContext;
      if (!context) return;
      const tools: BrowserTool[] = WEB_TOOL_DEFINITIONS.map((definition) => ({
        ...definition,
        execute: async (args) => {
          try {
            if (!active) throw new Error('GlobeHops tools are no longer active.');
            return {
              content: [
                { type: 'text', text: JSON.stringify(await latest.current(definition.name, args, controller.signal)) },
              ],
            };
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ error: error instanceof Error ? error.message : 'Tool failed.' }),
                },
              ],
            };
          }
        },
      }));
      if (context.registerTool && (modern || context.unregisterTool)) {
        for (const tool of tools) {
          context.registerTool(tool, { signal: controller.signal });
          registered.push(tool.name);
        }
      } else if (context.provideContext) {
        context.provideContext({ tools });
        provided = true;
      }
    } catch {
      cleanup();
    }
    return cleanup;
  }, [ready]);
}
