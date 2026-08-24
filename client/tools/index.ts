// The tool registry — §E's second kind of panel. A tool panel's body
// is one `tool` block whose behavior is code; each tool lives in its
// own file so they port independently. Registering here is what makes
// a tool exist; the block renderer refuses names it can't find.

import type { ReactNode } from 'react';
import type { PanelBlock } from '../../core/panels.ts';
import type { BlockCtx } from '../panels/render.tsx';

export type ToolRenderer = (block: PanelBlock, ctx: BlockCtx) => ReactNode;

const tools = new Map<string, ToolRenderer>();

export function registerTool(name: string, render: ToolRenderer): void {
  tools.set(name, render);
}

export function toolOf(name: string): ToolRenderer | undefined {
  return tools.get(name);
}

// The tool FILES are imported by the consumer (panels/blocks.tsx),
// never from here: a tool file imports registerTool from this module,
// so importing the tools back would make a cycle — and ES evaluation
// runs a module's dependencies before its own body, which put the
// registry Map in its temporal dead zone when the first tool called
// registerTool. This file stays pure so the graph stays a tree.
