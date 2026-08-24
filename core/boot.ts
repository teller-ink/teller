// Boot-time loading — the resolution law finding its home (§11).
//
// teller starts, reads the manifest, resolves system and packs against
// the shelf, reports what's missing, degrades. ONCE, at boot — not
// per-request. What comes back is the campaign's whole content stack,
// pre-stacked in precedence order:
//
//   teller's defaults → system → packs (declared order) → the
//   campaign's own template half → the TABLE's own folder
//
// Later wins, all the way up: the install's furniture is the floor, and
// what a human wrote on THIS machine's shelf is the ceiling.
//
// A ref that resolves joins the stack; a ref that doesn't is REPORTED,
// never silently dropped — "you don't have this" beats forgetting it
// existed, and beats an encounter that deploys half-empty at the table.
// A campaign with a missing system still loads: the table plays on
// with whatever layers remain, which is the degradation contract doing
// its job rather than an error page doing its opposite.
//
// This module knows nothing about what the slots MEAN. 'bestiary',
// 'statuses', 'kinds' are the format's words; boot stacks whatever a
// layer holds under a slot and hands the caller the merged reading,
// keyed the way the content couples (§10): declarations by name,
// stampable collections by id.

import { refIn, refsIn, sameName, type Entity, type Ref } from './entity.ts';
import { layerBy, mergeBy, refine } from './merge.ts';
import { byPanelOrder, includeProblems, type PanelDef } from './panels.ts';
import { defaultPanels, sweepPanels } from './panels-shelf.ts';
import { sweepPacks, type PackProblem } from './packs-shelf.ts';
import { sweepSystems, type SystemExport } from './systems-shelf.ts';
import { toTemplate, type Template, type TemplateOf } from './stamp.ts';
import type { Campaign, Shelf } from './store.ts';

export type Missing = { slot: 'system' | 'pack'; ref: Ref };

/**
 * What a load-time requirement check needs to know about the active
 * system: what it's CALLED (the refusal names all three parties) and
 * what it exports. `undefined` is a table with no system at all.
 */
type ExportSurface = { name: string; exports: string[] } | undefined;

/**
 * Whose code asked for what — one entry per pack, panel or system whose
 * compiled files named `system/<name>` specifiers.
 */
export type Requirement = { who: string; needs: string[] };

/**
 * The §M-4a refusal, out loud and at LOAD: a pack (or panel, or the
 * system's own code) importing `system/creation` from a system that
 * exports no such file is a problem in the report, naming all three
 * parties — the asker, the export, the system that doesn't have it.
 *
 * **No version ranges, deliberately.** The requirement is on the
 * SURFACE, not on the bytes that shipped it: house-fork a system under
 * a new id, keep exporting the same names, and every import keeps
 * working. When that isn't true the refusal tells you to update the
 * system, which is the only advice a range would have given anyway.
 */
export function exportProblems(
  system: ExportSurface,
  requirements: Requirement[],
): { dir: string; problem: string }[] {
  const problems: { dir: string; problem: string }[] = [];
  const have = new Set(system?.exports ?? []);
  for (const { who, needs } of requirements) {
    for (const need of needs) {
      if (have.has(need)) continue;
      problems.push({
        dir: who,
        problem: system
          ? `${who} needs \`${need}\` from ${system.name}, which this version doesn't export`
          : `${who} needs \`${need}\` from a system, and this table has none`,
      });
    }
  }
  return problems;
}

/** One content layer's blob, with where it came from for the console to say. */
type Layer = { source: string; data: Record<string, unknown> };

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function slotOf(layer: Layer, slot: string): unknown[] {
  const held = layer.data[slot];
  return Array.isArray(held) ? held : [];
}

export class Loaded {
  readonly manifest: Entity;
  /**
   * The active system. `code` is its own presentations (§M — the
   * function half, from `systems/<name>/presentations/`), present only
   * once a human trusted the `sys_` id; `codePending` says a folder
   * carries compiled code nobody has enabled yet. A system that arrived
   * as a `shelf.db` row or inside a pack folder carries neither.
   */
  readonly system?: {
    id: string;
    name: string;
    version: number;
    code?: {
      presentations: Record<string, string>;
      /** What it EXPORTS (§M-4a) — `system/<name>` resolves against this. */
      exports?: Record<string, SystemExport>;
      /** What its own code imports through `system/<name>`. */
      needs?: string[];
    };
    codePending?: boolean;
  };
  /**
   * Resolved packs, in the precedence order the manifest declared.
   * `code` is the system's own presentations (§L phase 2), present only
   * for a pack a human has trusted; `codePending` says a folder carries
   * compiled code nobody has enabled yet.
   */
  readonly packs: {
    id: string;
    name: string;
    version: number;
    code?: { presentations: Record<string, string>; needs?: string[] };
    codePending?: boolean;
  }[];
  /** Every ref that didn't resolve. The console's business to say out loud. */
  readonly missing: Missing[];
  /** A `panels/*\/panel.json` that failed to parse. Reported, never a crash. */
  readonly panelProblems: { dir: string; problem: string }[];
  /** A `packs/*\/…json` that failed to parse. Same posture — the pack loads what parses. */
  readonly packProblems: PackProblem[];
  #layers: Layer[];
  /** The table's own `panels/` folder — the topmost layer, above the campaign. */
  #table: Layer;
  #campaign: Campaign;
  /**
   * Ids a human switched OFF — the `enabled: 0` rows of the trust table
   * (§15's, the same one code enablement rides). A declaration carrying
   * one of these ids leaves the merge entirely: no tab, no panel to
   * assign a seat to, nothing left of it but the console row that can
   * switch it back on.
   *
   * **A trust row is a switch, not a code permit** (2026-08-19). It used
   * to gate only `code`, so disabling a panel did nothing you could see
   * — the declaration and its tab survived, and a data-only panel had no
   * button at all. Now the row answers the prior question (is this thing
   * on?), and code follows the same answer fail-closed as before: no row
   * means the declaration is IN and its code PENDING; `enabled: 1` means
   * in and running; `enabled: 0` means gone.
   *
   * This is also the sanctioned way to reject one of teller's own
   * defaults: their ids are baked into the files they ship in, so a row
   * naming one is a tombstone the console can write and take back.
   */
  #disabled: Set<string>;

  constructor(
    manifest: Entity,
    layers: Layer[],
    missing: Missing[],
    campaign: Campaign,
    system?: Loaded['system'],
    packs: Loaded['packs'] = [],
    panels: PanelDef[] = [],
    panelProblems: { dir: string; problem: string }[] = [],
    packProblems: PackProblem[] = [],
    tablePanels: PanelDef[] = [],
    disabled: Set<string> = new Set(),
  ) {
    this.manifest = manifest;
    this.system = system;
    this.packs = packs;
    this.missing = missing;
    // What the CONTENT stack asked of the system's export surface
    // (§M-4a). A pack's requirement is a fact about the pack, so it
    // lands in the pack report; a panel's is asked further down, once
    // the panels have merged.
    this.packProblems = [
      ...packProblems,
      ...exportProblems(this.#surface(), [
        ...(system?.code?.needs?.length ? [{ who: system.name, needs: system.code.needs }] : []),
        ...packs
          .filter((p) => p.code?.needs?.length)
          .map((p) => ({ who: p.name, needs: p.code!.needs! })),
      ]),
    ];
    // teller's own furniture is the FLOOR: the panels that ship with
    // the install (`defaults/panels/`), overridable by any layer above
    // restating the name (§E). The one slot teller ships declarations
    // for.
    this.#layers = [
      { source: 'teller', data: { panels } },
      ...layers,
    ];
    // …and the TABLE's own `panels/` folder is the CEILING, above the
    // campaign (§M-6's first wrinkle, fixed 2026-08-19): a table that
    // restates a default's, a system's or a pack's panel wins, which is
    // rule 1 pointing the way it points everywhere else in teller.
    this.#table = { source: 'table', data: { panels: tablePanels } };
    this.#campaign = campaign;
    this.#disabled = disabled;
    // A dangling or circular include is a fact about the MERGED
    // collection, not about any one folder (§M-5a′), so it can only be
    // asked once every layer is stacked — here, at the end of the
    // constructor, and it joins the problems the sweeps already found.
    const merged = this.declarations('panels') as PanelDef[];
    this.panelProblems = [
      ...panelProblems,
      ...includeProblems(merged),
      // A panel's requirement is asked HERE for the same reason an
      // include's is: only the merged collection knows which panel of a
      // name actually won, and it's the winner's code that will run.
      ...exportProblems(
        this.#surface(),
        merged
          .filter((p) => p.code?.needs?.length)
          .map((p) => ({ who: `panel '${p.name}'`, needs: p.code!.needs! })),
      ),
    ];
  }

  /**
   * The active system's export surface — its NAME and the export names
   * `system/<name>` may resolve to. A system whose code nobody trusted
   * has none attached, and that is the honest answer: nothing of its
   * would be served either.
   */
  #surface(): ExportSurface {
    if (!this.system) return undefined;
    return {
      name: this.system.name,
      exports: Object.keys(this.system.code?.exports ?? {}),
    };
  }

  /**
   * What `system/<name>` resolves to right now (§M-4a) — one entry per
   * file in the ACTIVE system's `exports/`, absent for a table with no
   * system or a system nobody trusted. Unlike `presentations()` this
   * never merges: `exports/` is system-tier only, which is exactly what
   * keeps the dependency arrow pointing down.
   */
  exports(): Record<string, SystemExport> {
    return this.system?.code?.exports ?? {};
  }

  /**
   * What the `system` specifier resolves to for this campaign (§L
   * phase 2, re-ordered by §M): the ACTIVE SYSTEM's presentations
   * first, then each trusted pack's, in declared precedence order —
   * LATER WINS on a filename collision.
   *
   * That order is the merge's, and it is exactly what makes "a pack
   * skins the system's dial" work: the system ships the functional face
   * (a spend dial), the pack restates the filename with the book's face
   * (a revolver's cylinder), and the pack's is what a record summons.
   * A pack shadowing another pack works the same way, as before.
   */
  presentations(): Record<string, string> {
    const out: Record<string, string> = { ...(this.system?.code?.presentations ?? {}) };
    for (const pack of this.packs) Object.assign(out, pack.code?.presentations ?? {});
    return out;
  }

  /**
   * A slot's VOCABULARY-coupled reading — declarations, statuses:
   * later restates earlier by name, the campaign's own word last and
   * winning — FIELD BY FIELD (`layerBy`), so the system may carry a
   * status's mechanic and the pack only the book's words about it,
   * neither restating the other's half (rule 4's statuses paragraph, as
   * a merge).
   *
   * **`panels` is the one exception, and it is about CODE.** A panel
   * declaration carries compiled urls and a trust row belonging to the
   * layer that shipped it, so a later layer restating a panel's name
   * REPLACES it whole: branded-over-unbranded (§M-6) means the pack's
   * panel, not a chimera wearing the system's code. Trust never
   * launders through a merge any more than it does through an include.
   *
   * `panels` leaves here SORTED, and that is deliberate: every surface
   * that draws a bar of panels — the console's tabs, the Screens
   * picker, the seat's segmented bar — reads this one endpoint, so the
   * order belongs at the seam they share rather than in three
   * comparators that drift (the `panes.ts` law, arrived at again).
   * Merge order is an accident of which layer spoke last; `order` is
   * something a human wrote down.
   */
  declarations(slot: string): unknown[] {
    const key = (item: unknown) => String(asRecord(item).name ?? '').trim().toLowerCase();
    const stack = this.#live(slot).map((s) => s.items);
    const merged = (slot === 'panels' ? mergeBy(key, ...stack) : layerBy(key, ...stack)).filter(
      (item) => String(asRecord(item).name ?? '').trim(),
    );
    if (slot !== 'panels') return merged;
    return (merged as PanelDef[]).slice().sort(byPanelOrder);
  }

  /**
   * A slot's IDENTITY-coupled reading — bestiary, catalogue: anything
   * stampable, merged by minted id, the campaign overriding a pack's
   * entry by restating its id.
   */
  templates(slot: string): Template[] {
    const stamped = this.#stack(slot)
      .flat()
      .map(toTemplate)
      .filter((t): t is Template => t !== undefined);
    return mergeBy((t: Template) => t.id, stamped);
  }

  /** The lookup `resolve()` wants, over one slot — or several, tried in order. */
  templateOf(...slots: string[]): TemplateOf {
    return (id) => {
      for (const slot of slots) {
        const hit = this.templates(slot).find((t) => t.id === id);
        if (hit) return hit;
      }
      return undefined;
    };
  }

  /**
   * A slot holding one RECORD per layer (the system's visual
   * vocabulary: `accents`, `icons`, `vocabulary`) — merged per key,
   * later layer winning, and a nested record refining rather than
   * replacing (`refine`). The declaration stack for objects that aren't
   * lists: the system states how the money is rolled and the pack states
   * which page says so, under the same key, neither losing the other.
   */
  record(slot: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const layer of this.#layers) {
      const held = layer.data[slot];
      if (held && typeof held === 'object' && !Array.isArray(held)) {
        for (const [key, value] of Object.entries(held as Record<string, unknown>)) {
          out[key] = key in out ? refine(out[key], value) : value;
        }
      }
    }
    return out;
  }

  /**
   * A slot that is one PARAGRAPH per layer — `space`, where a system
   * says in its own words what a distance means and what a step costs.
   *
   * Prose does not merge (`core/merge.ts`: scalars replace whole), so
   * this is the stack's SCALAR reading: the last layer to write any is
   * the one that meant it. It exists because the record teller was
   * already carrying had no reader at all, which is the oldest failure
   * in this codebase wearing a new hat — a fact held and not passed on
   * is a fact the reader invents.
   */
  prose(slot: string): string | undefined {
    let out: string | undefined;
    for (const layer of this.#layers) {
      const held = layer.data[slot];
      if (typeof held === 'string' && held.trim()) out = held.trim();
    }
    return out;
  }

  /**
   * Which layer a merged entry came from — the LAST layer to state the
   * name, because that's the one whose version won. Provenance for a
   * console that wants to say "campaign, overriding the Guidebook".
   */
  sourceOf(slot: string, name: string): string | undefined {
    let from: string | undefined;
    for (const { source, items } of this.#live(slot)) {
      if (
        items.some((item) => {
          const itemName = String(asRecord(item).name ?? '');
          return itemName !== '' && sameName(itemName, name);
        })
      ) {
        from = source;
      }
    }
    return from;
  }

  /**
   * What ONE layer carries, slot by slot, counted — the quiet
   * "65 bestiary · 301 catalog · 6 statuses" line a console wants under
   * a container's name. Whatever the layer holds, in the layer's own
   * words: this module still knows nothing about what a slot MEANS
   * (§10), so it counts and the console does the naming.
   *
   * `panels` is deliberately absent — a container renders those as its
   * expandable children, and counting them here would say the same
   * thing twice in two places that could disagree.
   */
  cargo(source: string): Record<string, number> {
    const layer = this.#layers.find((l) => l.source === source);
    const out: Record<string, number> = {};
    if (!layer) return out;
    for (const [slot, held] of Object.entries(layer.data)) {
      if (slot === 'panels') continue;
      const count = Array.isArray(held)
        ? held.length
        : held && typeof held === 'object'
          ? Object.keys(held).length
          : 0;
      if (count > 0) out[slot] = count;
    }
    return out;
  }

  /**
   * The same stack, LAYER BY LAYER rather than merged — what a console
   * that groups by WHERE IT CAME FROM needs, and the only reading that
   * can answer it. `declarations()` hands back the winners with their
   * provenance flattened away, and `sourceOf()` answers one name at a
   * time; neither can say "here is everything the Guidebook ships".
   *
   * Sources are the same words `sourceOf` returns: `teller`,
   * `system:<id>`, `pack:<id>`, `campaign`, `table`. A layer that
   * restates a name appears in both its own group and the earlier one —
   * that IS the stack, and hiding the shadowed copy would hide the
   * override.
   *
   * Switched-OFF declarations are here too, for the same reason: this is
   * the REGISTRY of everything that exists on this machine, and the
   * merge is what's on. A panel you can't see listed is a panel you
   * can't switch back on — the one-way door this reading exists to keep
   * shut.
   */
  sourced(slot: string): { source: string; items: unknown[] }[] {
    return this.#sourced(slot);
  }

  /**
   * The same stack with the switched-off declarations dropped — PER ID,
   * layer by layer, BEFORE anything merges by name. The order matters:
   * a system panel someone switched off must not shadow-kill a table's
   * own restatement of the same name, and it doesn't, because it never
   * reaches the merge to be restated. The table's is simply the only
   * one left.
   */
  #live(slot: string): { source: string; items: unknown[] }[] {
    if (this.#disabled.size === 0) return this.#sourced(slot);
    return this.#sourced(slot).map(({ source, items }) => ({
      source,
      items: items.filter((item) => {
        const id = asRecord(item).id;
        return !(typeof id === 'string' && this.#disabled.has(id));
      }),
    }));
  }

  /**
   * The full stack for one slot, bottom to top:
   *
   *   teller (the install's defaults) → system → packs → campaign → table
   *
   * The table's own folder is LAST because the table's ruling beats
   * everyone's, including its own campaign's stored declarations.
   */
  #sourced(slot: string): { source: string; items: unknown[] }[] {
    return [
      ...this.#layers.map((layer) => ({
        source: layer.source,
        items: slotOf(layer, slot),
      })),
      { source: 'campaign', items: this.#campaign.templatesIn(slot) },
      { source: this.#table.source, items: slotOf(this.#table, slot) },
    ];
  }

  #stack(slot: string): unknown[][] {
    return this.#sourced(slot).map((s) => s.items);
  }
}

/**
 * Resolve one campaign against one shelf. The manifest's `packs` ref
 * list is precedence order; NO list means every pack for the system
 * applies, in arrival order — a host with one pack must never make
 * anyone tick a box.
 *
 * `dataDir`, when given, is where the sweeps look —
 * `<dataDir>/panels/*\/panel.json` (§E, the TABLE's own layer) and
 * `<dataDir>/packs/*\/` (§L phase 1). teller's shipped defaults come from
 * the INSTALL either way, so a host with no data dir at all — and every
 * test that passes none — still has its furniture.
 *
 * **A folder beats a row.** A system or pack a sweep found is used
 * INSTEAD of the `shelf.db` row of the same id — the file on disk is
 * the authoring copy (rule 4a), so it wins, exactly the way a swept
 * `panel.json` beats the in-memory seed. The rows stay put and stay
 * readable, which is what makes the migration safe one pack at a time:
 * anything not yet folder-ized still loads from the database.
 *
 * For a SYSTEM there are now three places it can come from, and the
 * order is §M's: `systems/<name>/` (its own folder — the function half,
 * with code) beats a `system.json` embedded in a pack folder (phase 1's
 * merged shape) beats a `shelf.db` row. An old pack that still carries
 * its system loads exactly as it did.
 */
export function loadCampaign(shelf: Shelf, campaign: Campaign, dataDir?: string): Loaded {
  const manifest = campaign.root();
  const missing: Missing[] = [];
  const layers: Layer[] = [];

  const sweptPacks = dataDir ? sweepPacks(dataDir, shelf) : undefined;
  const sweptSystems = dataDir ? sweepSystems(dataDir, shelf) : undefined;
  const systemFolders = new Map((sweptSystems?.systems ?? []).map((s) => [s.id, s]));
  const folderSystems = new Map((sweptPacks?.systems ?? []).map((s) => [s.id, s]));
  const folderPacks = new Map((sweptPacks?.packs ?? []).map((p) => [p.id, p]));

  const systemRef = refIn(manifest.refs, 'system');
  let system: Loaded['system'];
  if (systemRef) {
    // Precedence, per id (§M): the system's OWN folder, then a
    // `system.json` embedded in a pack folder (phase 1's shape — old
    // exports keep working), then the `shelf.db` row.
    const own = systemFolders.get(systemRef.id);
    const row = own ?? folderSystems.get(systemRef.id) ?? shelf.system(systemRef.id);
    if (row) {
      system = { id: row.id, name: row.name, version: row.version };
      // Only a system's own folder carries code — an embedded
      // `system.json` has no `presentations/` of its own and a row has
      // no source to compile.
      if (own?.code) system.code = own.code;
      if (own?.codePending) system.codePending = true;
      layers.push({ source: `system:${row.id}`, data: asRecord(row.data) });
    } else {
      missing.push({ slot: 'system', ref: systemRef });
    }
  }

  const declared = refsIn(manifest.refs, 'packs');
  // No declared list means every pack for the system applies, in
  // arrival order — from the shelf AND from the folders, which is where
  // a pack that only ever existed as a folder joins in.
  const undeclared = () => {
    if (!system) return [];
    const ids = shelf.packsFor(system.id);
    for (const pack of folderPacks.values()) {
      if (pack.system === system.id && !ids.includes(pack.id)) ids.push(pack.id);
    }
    return ids.map((id) => ({ id, name: id }));
  };
  const packRefs: Ref[] = declared.length ? declared : undeclared();
  const packs: Loaded['packs'] = [];
  for (const ref of packRefs) {
    const folder = folderPacks.get(ref.id);
    const row = folder ?? shelf.pack(ref.id);
    if (row) {
      const entry: Loaded['packs'][number] = { id: row.id, name: row.name, version: row.version };
      // Only a FOLDER carries code — a `shelf.db` row has no source to compile.
      if (folder?.code) entry.code = folder.code;
      if (folder?.codePending) entry.codePending = true;
      packs.push(entry);
      layers.push({ source: `pack:${row.id}`, data: asRecord(row.data) });
    } else {
      missing.push({ slot: 'pack', ref });
    }
  }

  // teller's own defaults, from the INSTALL — always, data dir or not.
  // The table's `panels/` folder is a separate layer that sits on top,
  // and is empty until a human writes something there.
  const swept = dataDir ? sweepPanels(dataDir, shelf) : undefined;

  // Every id a human switched OFF, read once per load. `enabled: 0` is
  // an explicit act — the sweep never writes here (§15) — so an absent
  // row and a false one are different answers, and only the false one
  // takes a declaration out of the merge.
  const disabled = new Set(
    shelf.pluginTrusts().filter((t) => !t.enabled).map((t) => t.id),
  );

  return new Loaded(
    manifest,
    layers,
    missing,
    campaign,
    system,
    packs,
    defaultPanels(),
    swept?.problems ?? [],
    [...(sweptSystems?.problems ?? []), ...(sweptPacks?.problems ?? [])],
    swept?.panels ?? [],
    disabled,
  );
}
