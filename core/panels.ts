// The standard panel collection — teller's furniture (§E, settled
// 2026-08-18).
//
// A `.panel` is a named declaration that arranges components on a
// surface. It rides the same stack as every other declaration —
// vocabulary-coupled, merged by NAME, later wins — under a `panels`
// slot on any layer. THIS file is the TYPES only. The arrangements
// teller ships — the HOST's own tools, since a play screen without a
// system has nothing to arrange — are files in the install's
// `defaults/panels/`, and they are the layer below everything. A
// system, pack, campaign or the TABLE itself adds its own or overrides
// one by restating its word; the table's is topmost and wins (rule 1
// for UI). Furniture, not content — a panel gates nothing and grants
// nothing; the ROLE decides what a screen may do, the panel only
// decides how it looks.
//
// Two authored arrangements, never one responsive layout: `mounted`
// (fixed height, never scrolls, columns) and `held` (a hand's glass,
// scrolls down, one column). Blocks are nouns — layout + components
// only, never control flow.
//
// "E extended again" (2026-08-18): nothing here is gatekept. teller's
// defaults ship as `.panel` folders in the INSTALL (`defaults/panels/`)
// and the data dir's `panels/` belongs to the table alone — teller never
// writes into it (2026-08-19, §M-6's first wrinkle). A duplicated folder
// — copy `sheet/` to `my-sheet/`, edit `name` inside — is just another
// file in the collection; the NAME is still the merge key, the minted
// `pan_` id only names the file. The fs-touching half lives in the
// sibling `panels-shelf.ts` and not here: THIS file is type-imported
// straight from `client/` (the panel renderer wants
// `PanelDef`/`PanelBlock`), so it must stay import-safe for a browser
// build — no `node:fs`, no `node:path`.
//
// Art-in-panel (`art/` beside `panel.json`, refs rewritten to a
// namespaced key at install, same as a pack) is specced in §E but not
// built here — TODO(§E, "a panel carries its art") when that lands.

export type PanelBlock = { block: string } & Record<string, unknown>;

/**
 * The five chrome seams a COMPOSITE may name a presentation for (§M-5a).
 * Each key is an OVERRIDE hook, never a requirement: absent, the seam
 * resolves the normal way (its default name, system-first, pack-winning,
 * teller's floor last), so a themed set arrives with zero composite
 * edits.
 */
export type PanelChrome = {
  header?: string;
  bar?: string;
  frame?: string;
  turncall?: string;
  notebanner?: string;
};

export type PanelDef = {
  /** The word. Later layers override by restating it. */
  name: string;
  label?: string;
  blurb?: string;
  /** The bar's own glyph for this panel, when it wears one. */
  icon?: string;
  /** What it arranges: one entity, or nothing (a tool panel). */
  subject?: 'entity' | 'none';
  mounted?: PanelBlock[];
  held?: PanelBlock[];
  /**
   * **The COMPOSITE** (§M-5a): an ordered list of panel NAMES this panel
   * assembles into a bar of tabs. A panel with `tabs` declares the SEAT
   * — which screens it holds and in what order — and merges by name like
   * everything else, so a table reorders everyone's tabs in four lines
   * of json.
   *
   * Strays SURFACE: an entity-subject panel not listed here APPENDS
   * rather than vanishing (the `rest` law applied to navigation).
   * `omit` is the explicit exclusion for the author who means it.
   */
  tabs?: string[];
  /** Names deliberately kept OUT of the tab bar — the stray append's opt-out. */
  omit?: string[];
  /**
   * **The composite's DRAFT takeover** (§M-4a's companion): the name of
   * a panel that takes the whole seat while the subject entity still
   * carries its draft mark — no tabs, no chrome seams, the strip whole.
   * Absent, the floor is today's behavior unchanged.
   *
   * A `surface: false` panel is a legal target: a builder is nowhere
   * anyone can be POINTED, it is where the seat goes on its own while a
   * character is being made, and it hands the seat back the moment the
   * mark clears. The outer glass clip is not part of the deal — that
   * one law is structural and never yields (§M-5a).
   */
  draft?: string;
  /** Seam presentations, by seam. Only a composite reads them. */
  chrome?: PanelChrome;
  /**
   * `false` makes this declaration a FRAGMENT (§M-5a′): merged and
   * overridable exactly as ever, and includable by name from another
   * panel's arrangement — but never offered as a tab, a console pane or
   * an assignment. The `panes.ts` law inverted on purpose: a fragment is
   * deliberately not a place anyone can be pointed.
   */
  surface?: boolean;
  /**
   * Where this panel sits in a bar of tabs. Ordinary declaration data,
   * so it merges like everything else — a later layer restating the
   * name with a different `order` moves the tab, and the table's
   * restatement moves anything (rule 1, pointed at the furniture).
   * Undeclared means `PANEL_ORDER_DEFAULT`; see `byPanelOrder`.
   */
  order?: number;
  /**
   * `pan_…`, minted once at seed/authoring and baked into the file.
   * Identity for the FILE (namespaces its art, names it on disk) — the
   * merge key stays `name`, exactly as `pak_` doesn't touch a pack's.
   */
  id?: string;
  /**
   * The ladder's rungs 3-5 (§E UN-DEFERRED, 2026-08-19). Attached at
   * LOAD, by the sweep, and only once the panel is TRUSTED — never
   * carried in `panel.json` itself. URLs point at
   * `/panel-code/<pan_id>/…`, serving `<folder>/.build/` output only.
   */
  code?: {
    style?: string;
    blocks?: Record<string, string>;
    takeover?: string;
    /**
     * The `system/<name>` exports this panel's code imports (§M-4a),
     * recorded by the compile and checked at load — a name the active
     * system doesn't export is a labeled problem in the report, never a
     * module that 404s at render time.
     */
    needs?: string[];
  };
  /**
   * Set instead of `code` when a folder carries compiled code but no
   * human has enabled it yet — the client's cue to say "this panel
   * carries code awaiting enablement" rather than pretend it's inert.
   */
  codePending?: boolean;
};

/** Forgiving read for a panel arriving in pack JSON — keep what parses. */
export function toPanel(raw: unknown): PanelDef | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name) return undefined;
  const blocks = (v: unknown): PanelBlock[] | undefined =>
    Array.isArray(v)
      ? (v.filter(
          (b) => b && typeof b === 'object' && typeof (b as PanelBlock).block === 'string',
        ) as PanelBlock[])
      : undefined;
  const words = (v: unknown): string[] | undefined =>
    Array.isArray(v)
      ? v.filter((n): n is string => typeof n === 'string' && n.trim() !== '').map((n) => n.trim())
      : undefined;
  const out: PanelDef = { name };
  if (typeof r.label === 'string' && r.label.trim()) out.label = r.label;
  if (typeof r.blurb === 'string' && r.blurb.trim()) out.blurb = r.blurb;
  if (typeof r.icon === 'string' && r.icon.trim()) out.icon = r.icon.trim();
  if (r.subject === 'entity' || r.subject === 'none') out.subject = r.subject;
  if (r.surface === false) out.surface = false;
  const tabs = words(r.tabs);
  const omit = words(r.omit);
  if (tabs) out.tabs = tabs;
  if (omit) out.omit = omit;
  if (typeof r.draft === 'string' && r.draft.trim()) out.draft = r.draft.trim();
  if (r.chrome && typeof r.chrome === 'object' && !Array.isArray(r.chrome)) {
    const raw = r.chrome as Record<string, unknown>;
    const chrome: PanelChrome = {};
    for (const seam of ['header', 'bar', 'frame', 'turncall', 'notebanner'] as const) {
      const word = raw[seam];
      if (typeof word === 'string' && word.trim()) chrome[seam] = word.trim();
    }
    if (Object.keys(chrome).length) out.chrome = chrome;
  }
  const mounted = blocks(r.mounted);
  const held = blocks(r.held);
  if (mounted) out.mounted = mounted;
  if (held) out.held = held;
  if (typeof r.id === 'string' && r.id.trim()) out.id = r.id;
  if (typeof r.order === 'number' && Number.isFinite(r.order)) out.order = r.order;
  return out;
}

/**
 * Whether a declaration may be OFFERED — a tab, a console pane, a seat
 * assignment. `surface: false` is the only thing that says no (§M-5a′):
 * a fragment merges and overrides like any other panel and is includable
 * by name, but nobody can be pointed at it.
 */
export function surfaceable(panel: PanelDef): boolean {
  return panel.surface !== false;
}

/** Every panel NAME an arrangement includes, blocks nested in `columns` included. */
export function includedNames(panel: PanelDef): string[] {
  const out: string[] = [];
  const walk = (blocks: unknown): void => {
    if (!Array.isArray(blocks)) return;
    for (const raw of blocks) {
      if (!raw || typeof raw !== 'object') continue;
      const block = raw as PanelBlock;
      if (block.block === 'panel' && typeof block.name === 'string' && block.name.trim())
        out.push(block.name.trim());
      if (Array.isArray(block.columns)) for (const col of block.columns) walk(col);
    }
  };
  walk(panel.mounted);
  walk(panel.held);
  return [...new Set(out)];
}

/**
 * What's wrong with the includes in a merged collection — a dangling
 * name, or a cycle (§M-5a′: "cycles and dangling includes refuse out
 * loud … in the load report AND at the render site").
 *
 * It lives HERE, over the merged declarations, because that's the only
 * place either fact is knowable: an include resolves against whatever
 * the name merges to, so a pack restating one fragment can make or break
 * a cycle in an arrangement it never touched. The renderer refuses in
 * place as well — it must, since it also draws panels no collection ever
 * reported (a plugin's pane) — but it can only ever see the one branch
 * it walked, while this sees the graph.
 */
export function includeProblems(panels: PanelDef[]): { dir: string; problem: string }[] {
  const by = new Map<string, PanelDef>();
  for (const panel of panels) by.set(panel.name.trim().toLowerCase(), panel);
  const problems: { dir: string; problem: string }[] = [];
  const done = new Set<string>();

  const walk = (panel: PanelDef, trail: string[]): void => {
    for (const name of includedNames(panel)) {
      const key = name.toLowerCase();
      if (trail.includes(key)) {
        problems.push({
          dir: `panel '${panel.name}'`,
          problem: `includes '${name}', which includes it back — ${[...trail, key].join(' → ')}`,
        });
        continue;
      }
      const held = by.get(key);
      if (!held) {
        problems.push({
          dir: `panel '${panel.name}'`,
          problem: `includes '${name}', and no panel by that name is declared`,
        });
        continue;
      }
      walk(held, [...trail, key]);
    }
  };

  for (const panel of panels) {
    const key = panel.name.trim().toLowerCase();
    if (done.has(key)) continue;
    done.add(key);
    walk(panel, [key]);
  }
  return problems;
}

/**
 * What a composite's `draft` key resolves to, given the merged
 * collection and whether the subject is still a draft (§M-4a's
 * companion).
 *
 * Three answers, and the third is why this is a function rather than a
 * lookup: the panel (take the seat over), a REFUSAL (the name resolves
 * to nothing — say so, and the caller carries on with the normal seat,
 * because a blank strip would strand a player mid-creation), or nothing
 * at all (no `draft` key, or the mark is already cleared — today's
 * behavior, unchanged, which is the floor this key promises).
 *
 * The lookup is over EVERY declaration, `surface: false` included: a
 * builder is exactly the kind of panel that should be a fragment — it
 * is nowhere anyone can be POINTED, it's where the seat goes on its own
 * — so refusing one here would ban the intended target.
 */
export function draftTakeover(
  composite: PanelDef | undefined,
  panels: PanelDef[],
  drafting: boolean,
): { panel: PanelDef } | { refusal: string } | undefined {
  const name = composite?.draft?.trim();
  if (!name || !drafting) return undefined;
  const held = panels.find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
  if (held) return { panel: held };
  return {
    refusal: `no panel named '${name}' — this seat's draft takeover asked for it and nothing declares it`,
  };
}

/**
 * WHICH composite the seat is (§M-5a, ruled 2026-08-20 by Brian): a
 * seat takes exactly two things from the DM — the role and the
 * character — and NO layout, so the shape it wears is the merge's to
 * decide, not a dropdown's.
 *
 * The answer is the merged collection's entity-subject panel carrying
 * `tabs`. Nothing declares one on a bare host, which is why this
 * returns `undefined` rather than inventing one: the floor assembly
 * around `sheet` is still the answer for a system that ships no
 * composite, exactly as §M-5a promised.
 *
 * More than one is possible — a pack may add a composite beside the
 * system's instead of restating its name — so the tie-break is stated
 * rather than left to whichever folder the sweep opened first: the one
 * named `seat` wins, else the lowest `order`, else the earliest in the
 * merged list (floor, system, pack, campaign, table). A collision
 * anybody minds is fixed the way every other one is — restate the name.
 *
 * `surface: false` is not consulted. A fragment is "nowhere anyone can
 * be POINTED" (§M-5a′), and since the ruling nobody is pointed at a
 * seat's shape at all — the same reason `draftTakeover` looks at every
 * declaration too.
 */
export function seatComposite(panels: PanelDef[]): PanelDef | undefined {
  const composites = panels.filter((p) => p.subject === 'entity' && p.tabs?.length);
  const named = composites.find((p) => p.name.trim().toLowerCase() === 'seat');
  if (named) return named;
  return composites.reduce<PanelDef | undefined>(
    (best, p) =>
      !best || (p.order ?? PANEL_ORDER_DEFAULT) < (best.order ?? PANEL_ORDER_DEFAULT) ? p : best,
    undefined,
  );
}

/**
 * Where an undeclared panel sits: the MIDDLE, not the end. A system's
 * play screens declare nothing today, and they are the reason anyone
 * opens the console — so the rule has to read right when the number is
 * absent. Low sorts first, high sorts last, and silence lands between
 * them: teller's own host tools carry 90-98 and sit after the play
 * screens, a system that wants one of its screens first says 10.
 */
export const PANEL_ORDER_DEFAULT = 50;

/**
 * The ONE order a bar of panels is drawn in — the console's tabs, the
 * Screens picker's pane list, anything that offers panels to choose
 * from. Declared number first, then the visible word, so a shelf full
 * of undeclared panels still reads alphabetically instead of by
 * whichever folder the sweep happened to open first.
 */
export function byPanelOrder(a: PanelDef, b: PanelDef): number {
  const order = (p: PanelDef) => p.order ?? PANEL_ORDER_DEFAULT;
  return (
    order(a) - order(b) ||
    (a.label ?? a.name).toLowerCase().localeCompare((b.label ?? b.name).toLowerCase())
  );
}

/** Every list a sheet places by hand, so `rest` can catch the strays.
 * Exported for the seat chrome's synthesized 'More' screen
 * (`client/components/seat/SeatChrome.tsx`, fix 1/6) — the same strays
 * that used to spill onto held-glass Sheet now spill there instead. */
export const PLACED = ['skills', 'resources', 'conditions', 'meta'];

// The panels teller SHIPS — boards, books, log, plugins, screens, shelf,
// the ones about this machine and the room around it — used to live
// here as an in-code array. They are files now:
// `defaults/panels/<name>/panel.json` in the install, loaded by
// `defaultPanels()` in `panels-shelf.ts`. Nothing about a panel is a
// special case any more; teller's own are read by the same sweep that
// reads a system's, a pack's and the table's.
