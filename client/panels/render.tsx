// Arrangement → DOM. A `.panel` is data (§E); this file is the
// renderer that walks its blocks. Degradation is the contract: an
// unknown block renders as a labeled refusal, a failed panel falls
// back to the floor, a subject panel with no entity says so — nothing
// blank, nothing silent.

import {
  Component,
  createContext,
  useContext,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import type { PanelBlock, PanelDef } from '../../core/panels.ts';
import { card, sectionLabel } from '../lib/ui.ts';

export type Glass = 'mounted' | 'held';

/** What every block receives — the seam that later becomes the rung-4
 * props contract (§E extended). Keep it clean: no globals. */
export type BlockCtx = {
  glass: Glass;
  /** Resolved subject entity, when the panel has one. */
  entity?: unknown;
  /** Merged records the identity layer consumes (accents, dials, …). */
  records: Record<string, Record<string, unknown>>;
  /** Sparse write to the subject (list, name, value/max/remove). */
  write?: (edit: Record<string, unknown>) => Promise<void>;
  /**
   * Present only when what's rendering is a PLUGIN's pane (§15's UI
   * tier): its own id, and a call bound to it. A pane reaches its
   * plugin's doors through this and nothing else — it never writes the
   * id, so it cannot address another plugin's, and a pane moved between
   * plugins needs no edit.
   *
   * Absent for every declared panel, which is the honest shape: a block
   * in teller's own `sheet` has no plugin behind it and must not be
   * handed a way to pretend otherwise.
   */
  plugin?: {
    id: string;
    call: <T>(
      door: string,
      opts?: { method?: string; path?: string[]; body?: unknown },
    ) => Promise<T>;
  };
};

export type BlockRenderer = (block: PanelBlock, ctx: BlockCtx) => ReactNode;

const registry = new Map<string, BlockRenderer>();

export function registerBlock(name: string, render: BlockRenderer): void {
  registry.set(name, render);
}

export function Refusal({ children }: { children: ReactNode }) {
  return <p className="text-sm text-stone-600 italic">{children}</p>;
}

/** A custom BLOCK, rung-4 shape: default-exports a component that
 * receives the full BlockCtx as props plus the block declaration that
 * named it (`block`), so it can read its own extra config keys. */
export type CustomBlockComponent = ComponentType<BlockCtx & { block: PanelBlock }>;

/** A panel TAKEOVER: default-exports a component receiving the full
 * BlockCtx and nothing else — it replaces the block walk entirely, so
 * there's no single block declaration to hand it. */
export type TakeoverComponent = ComponentType<BlockCtx>;

function wrapCustom(Comp: CustomBlockComponent): BlockRenderer {
  return (block, ctx) => <Comp {...ctx} block={block} />;
}

/** Which panel's own custom blocks are in scope right now — set by
 * `PanelSurface` for the panel it's rendering, so a name a panel's own
 * `blocks/` folder registers only resolves inside THAT panel's tree
 * (§E UN-DEFERRED: "a custom block only resolves within its own
 * panel's rendering"). Falls back to the global registry outside any
 * panel, or for a name the panel didn't supply itself. */
const PanelBlocksContext = createContext<Record<string, BlockRenderer> | undefined>(
  undefined,
);

export function RenderBlock({
  block,
  ctx,
}: {
  block: PanelBlock;
  ctx: BlockCtx;
}) {
  const panelBlocks = useContext(PanelBlocksContext);
  const render = panelBlocks?.[block.block] ?? registry.get(block.block);
  if (!render)
    return <Refusal>this build doesn't know the block '{block.block}'</Refusal>;
  return <>{render(block, ctx)}</>;
}

// -- the include (§M-5a′) --------------------------------------------------
//
// `{ block: 'panel', name }` — an arrangement includes another panel by
// name, inheriting the subject/records/write context it's placed in.
// Every level of composition becomes a named, mergeable file, and
// later-wins reaches INSIDE arrangements: a pack restating one fragment
// updates every arrangement that includes it, without those
// arrangements being restated.
//
// Two guards, and both refuse OUT LOUD rather than blanking. A CYCLE is
// caught by the trail below and reported again in the load report
// (`includeProblems`, which sees the whole graph); a DANGLING name is
// refused here, because the collection this surface was handed is the
// only truth a render site has.

const PanelCollectionContext = createContext<PanelDef[] | undefined>(undefined);
const IncludeTrailContext = createContext<string[]>([]);

/** Hand a subtree the merged panel collection an include resolves against. */
export function PanelCollection({
  panels,
  children,
}: {
  panels: PanelDef[] | undefined;
  children: ReactNode;
}) {
  return (
    <PanelCollectionContext.Provider value={panels}>{children}</PanelCollectionContext.Provider>
  );
}

/** The `panel` block itself — registered from `blocks.tsx` with the rest. */
export function IncludeBlock({ name, ctx }: { name: string; ctx: BlockCtx }) {
  const panels = useContext(PanelCollectionContext);
  const trail = useContext(IncludeTrailContext);
  const word = name.trim();
  if (!word) return <Refusal>an include with no panel name</Refusal>;
  const key = word.toLowerCase();
  if (trail.includes(key))
    return <Refusal>'{word}' includes itself — {[...trail, key].join(' → ')}</Refusal>;
  const panel = panels?.find((p) => p.name.trim().toLowerCase() === key);
  if (!panel) return <Refusal>no panel named '{word}' to include</Refusal>;
  // The trail is pushed by `PanelSurface` itself, not here, so a panel
  // is on it from the first block it draws — which is what makes an
  // immediate self-include refuse in place instead of drawing one more
  // copy of itself before noticing.
  return (
    <PanelSurface
      panel={panel}
      ctx={ctx}
      fallback={<Refusal>'{word}' failed to render — the floor has it</Refusal>}
    />
  );
}

/** Pick the authored arrangement for this glass — never reflow one
 * into the other (rule 6: two families, one question). */
export function arrangementOf(
  panel: PanelDef,
  glass: Glass,
): PanelBlock[] | undefined {
  return glass === 'mounted' ? (panel.mounted ?? panel.held) : (panel.held ?? panel.mounted);
}

class Boundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// -- loading a panel's own code (§E UN-DEFERRED, rung 3-5) ------------------
//
// `panel.code` only arrives once a panel is TRUSTED (`sweepPanels`), so
// everything below is dark for every panel that carries no code —
// `codeState` starts and stays `{ status: 'none' }` and `useCodeStyle`
// no-ops.

/** One `<link>` per (panel, href), ref-counted across every mounted
 * surface of that panel — removed the moment the last one unmounts. */
const styleRefs = new Map<string, { link: HTMLLinkElement; count: number }>();

function useCodeStyle(panId: string | undefined, href: string | undefined): void {
  useEffect(() => {
    if (!panId || !href) return undefined;
    const key = `${panId}:${href}`;
    let entry = styleRefs.get(key);
    if (!entry) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.panelCode = panId;
      document.head.appendChild(link);
      entry = { link, count: 0 };
      styleRefs.set(key, entry);
    }
    entry.count += 1;
    return () => {
      entry!.count -= 1;
      if (entry!.count <= 0) {
        entry!.link.remove();
        styleRefs.delete(key);
      }
    };
  }, [panId, href]);
}

type CodeState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'ready'; blocks?: Record<string, BlockRenderer>; Takeover?: TakeoverComponent }
  | { status: 'error'; message: string };

/** Dynamic-import every url a panel's `code` names, register its
 * `blocks` into a registry scoped to THIS surface, and resolve its
 * `takeover` if it has one. Modules are cached by `import()` itself —
 * the same url resolves to the same module instance everywhere.
 *
 * That caching is the point rather than a hazard now: a panel's urls
 * carry `?v=<mtime>`, minted from the compiled artifact at sweep
 * (`stamp` in `core/panels-shelf.ts`), so a recompile arrives as a
 * DIFFERENT url and imports fresh, while an untouched panel keeps the
 * module it already has. Nothing here has to know that happened — the
 * effect re-runs because `code` changed. */
function usePanelCode(code: PanelDef['code']): CodeState {
  const key = code ? JSON.stringify(code) : '';
  const [state, setState] = useState<CodeState>(code ? { status: 'loading' } : { status: 'none' });
  useEffect(() => {
    if (!code) {
      setState({ status: 'none' });
      return undefined;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    (async () => {
      const blocks: Record<string, BlockRenderer> = {};
      if (code.blocks) {
        for (const [name, url] of Object.entries(code.blocks)) {
          // @vite-ignore — a runtime-supplied url, never one the dev
          // server's static analysis could resolve at build time.
          const mod = (await import(/* @vite-ignore */ url)) as { default?: unknown };
          if (typeof mod.default !== 'function')
            throw new Error(`blocks/${name} has no default export`);
          blocks[name] = wrapCustom(mod.default as CustomBlockComponent);
        }
      }
      let Takeover: TakeoverComponent | undefined;
      if (code.takeover) {
        // @vite-ignore
        const mod = (await import(/* @vite-ignore */ code.takeover)) as { default?: unknown };
        if (typeof mod.default !== 'function') throw new Error('panel.tsx has no default export');
        Takeover = mod.default as TakeoverComponent;
      }
      return { blocks: Object.keys(blocks).length ? blocks : undefined, Takeover };
    })()
      .then((ready) => {
        if (!cancelled) setState({ status: 'ready', ...ready });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

export function PanelSurface({
  panel,
  ctx,
  fallback,
}: {
  panel: PanelDef;
  ctx: BlockCtx;
  fallback: ReactNode;
}) {
  useCodeStyle(panel.id, panel.code?.style);
  const codeState = usePanelCode(panel.code);
  // What's already being drawn, this panel now included — an include
  // below refuses any name already on it (§M-5a′'s cycle guard).
  const outer = useContext(IncludeTrailContext);
  const trail = [...outer, panel.name.trim().toLowerCase()];

  // Loading states render nothing — the arrangement (or refusal) below
  // is only ever drawn once the panel's own code has resolved one way
  // or the other.
  if (codeState.status === 'loading') return null;

  if (codeState.status === 'error')
    return (
      <div className={card}>
        <p className={sectionLabel}>{panel.label ?? panel.name}</p>
        <Refusal>this panel's code failed to load: {codeState.message}</Refusal>
      </div>
    );

  if (codeState.status === 'ready' && codeState.Takeover) {
    const Takeover = codeState.Takeover;
    return (
      <Boundary fallback={fallback}>
        <IncludeTrailContext.Provider value={trail}>
          <Takeover {...ctx} />
        </IncludeTrailContext.Provider>
      </Boundary>
    );
  }

  const blocks = arrangementOf(panel, ctx.glass);
  if (!blocks?.length)
    return (
      <div className={card}>
        <p className={sectionLabel}>{panel.label ?? panel.name}</p>
        <Refusal>this panel declares no {ctx.glass} arrangement</Refusal>
      </div>
    );
  return (
    <Boundary fallback={fallback}>
      <IncludeTrailContext.Provider value={trail}>
        <PanelBlocksContext.Provider
          value={codeState.status === 'ready' ? codeState.blocks : undefined}
        >
          {blocks.map((b, i) => (
            <RenderBlock key={i} block={b} ctx={ctx} />
          ))}
        </PanelBlocksContext.Provider>
      </IncludeTrailContext.Provider>
    </Boundary>
  );
}
