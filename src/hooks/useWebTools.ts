import { useEffect, useLayoutEffect, useRef } from 'react';
import { WEB_TOOL_DEFINITIONS, type WebToolName } from '../agent/webTools.ts';

/** Older drafts and polyfills expect MCP's call result; the current draft serialises whatever execute returns. */
interface McpResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}
interface BrowserTool {
  name: WebToolName;
  title: string;
  description: string;
  inputSchema: object;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute: (args: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>;
}
interface ModelContext {
  /** The current draft returns a promise that rejects on a clash; older shapes returned nothing or threw. */
  registerTool?: (tool: BrowserTool, options?: { signal: AbortSignal }) => unknown;
  unregisterTool?: (name: string) => void;
  provideContext?: (context: { tools: BrowserTool[] }) => void;
}
const message = (error: unknown) => (error instanceof Error ? error.message : 'Tool failed.');
/** Cancelled when the app unmounts the tools or, in the current draft, when the agent cancels the call. */
const callSignal = (own: AbortSignal, caller: AbortSignal | undefined) =>
  caller && typeof AbortSignal.any === 'function' ? AbortSignal.any([own, caller]) : own;

/**
 * Experimental WebMCP is optional; a broken or missing implementation cannot break the app. The current draft
 * (`document.modelContext`) receives results as plain data and errors as `{error}` objects, whose message
 * reaches the agent; legacy `navigator.modelContext` gets MCP-style text content.
 */
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
      if (!active) return;
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
      const run = async (name: WebToolName, args: unknown, signal?: AbortSignal) => {
        if (!active) throw new Error('GlobeHops tools are no longer active.');
        return latest.current(name, args, callSignal(controller.signal, signal));
      };
      const tools: BrowserTool[] = WEB_TOOL_DEFINITIONS.map((definition) => ({
        ...definition,
        execute: modern
          ? async (args, options) => {
              try {
                return await run(definition.name, args, options?.signal);
              } catch (error) {
                return { error: message(error) };
              }
            }
          : async (args): Promise<McpResult> => {
              try {
                return { content: [{ type: 'text', text: JSON.stringify(await run(definition.name, args)) }] };
              } catch (error) {
                return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: message(error) }) }] };
              }
            },
      }));
      if (context.registerTool && (modern || context.unregisterTool)) {
        for (const tool of tools) {
          const registration = context.registerTool(tool, { signal: controller.signal });
          registered.push(tool.name);
          // A rejected registration (a clashing name, say) withdraws them all rather than leave a partial set.
          Promise.resolve(registration).catch(cleanup);
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
