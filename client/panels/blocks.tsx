// The standard blocks — §E's nouns, registered into the renderer.
//
// The visual reckoning: these blocks' internals now match the old app's
// components (the reference, not inspiration) — Vitals, TagSection,
// Counters (Big/Ledger/Rows), the sheet chrome and the Grit cylinder —
// without touching the block names or the BlockCtx seam.

import { useEffect, useState, type ComponentType } from 'react';
import type { Entity, Entry } from '../../core/entity.ts';
import type { Amendment } from '../../core/effects.ts';
import type { PanelBlock } from '../../core/panels.ts';
import { api, fileUrl } from '../lib/api.ts';
import { card, sectionLabel } from '../lib/ui.ts';
import type { DiceRecord } from '../lib/dice.ts';
import { useRuleLookup, usePanelNote, type RuleHit } from '../lib/rules.ts';
import { CounterStepper } from '../components/Vitals.tsx';
import { TagSection } from '../components/TagSection.tsx';
import { BigGauge, LedgerRow, SkillRow, stepValue } from '../components/Counters.tsx';
import { SheetPanel } from '../components/sheet/SheetPanel.tsx';
import { presentationOf, useSystemFaces } from '../lib/presentations.ts';
import { IncludeBlock, registerBlock, Refusal, RenderBlock, type BlockCtx } from './render.tsx';
import { CarriedScreen } from '../components/items/Screen.tsx';
import { SpendDoor } from '../components/SpendDoor.tsx';
import type { ScreenDecl } from '../components/items/types.ts';

// The faces this file summons by name (§L, phase 3.5 complete). They are
// NOT imported and teller no longer ships any of them: a `HealthPanel`
// is one printed sheet's health box and a `Cylinder` is a revolver, so
// both belong to the system that prints them and arrive as system- or
// pack-carried code through `presentationOf`.
//
// These types used to be read off teller's own demoted copies
// (`typeof import('../components/sheet/Cylinder.tsx').Cylinder`). With
// the copies deleted they are written out here, which is what they
// always were: **the contract this file passes**. A system's face
// satisfies these props or it doesn't get drawn the way this block
// means; nothing else about it is teller's business.
type CylinderFace = ComponentType<{
  entry: Entry;
  onSet: (next: number) => void;
  note?: string;
  fill?: boolean;
  accent?: string;
}>;

type HealthFace = ComponentType<{
  entry: Entry;
  pinned: Entry[];
  onSet: (next: number) => void;
  note?: string;
  fill?: boolean;
  /**
   * THE SEAM, declared and not yet fed: what the entity's own WORN gear
   * works out for a pinned stat, by the stat's lower-cased name — the
   * same `Amendment` a weapon's pools wear. Nothing passes it today
   * because nothing in the data says what's worn (see
   * `client/lib/amend.ts`); the face already draws the breakdown its
   * lines will land in.
   */
  amended?: Map<string, Amendment>;
}>;

/** One row of the system's `statuses` declaration — the mechanic, never the prose. */
export type StatusDecl = { name: string; relief?: string; effect?: string };

type StatusFace = ComponentType<{
  declared: StatusDecl[];
  entries: { name: string; value?: number | string }[];
  onWrite: (edit: { name: string; value?: number; remove?: boolean }) => void;
  title?: string;
  note?: string;
  fill?: boolean;
  lookup?: (name: string) => RuleHit | undefined;
}>;

/**
 * Past twelve chambers a ring stops being countable — so a `dials` word
 * on a bigger counter is ignored and the floor's gauge draws it.
 *
 * §L flagged this as one face's constraint wearing the seam's clothes,
 * and it still is: it lived in `Cylinder.tsx` and gated EVERY dial, not
 * just cylinders. It moved here rather than dying when the cylinder did,
 * because deleting it would silently change what a big dialled counter
 * draws as, on a day nobody asked for that. The honest fix is unchanged
 * and still owed: a face declaring its own fitness.
 */
function dialable(entry: Entry): boolean {
  return typeof entry.max === 'number' && entry.max > 0 && entry.max <= 12;
}

/** 'skills' → 'Skills'. The one heading this file supplies rather than reads off a pack. */
function titleCase(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function subject(ctx: BlockCtx): Entity | undefined {
  return ctx.entity as Entity | undefined;
}

export function entriesOf(e: Entity | undefined, list: string): Entry[] {
  if (!e) return [];
  const key = Object.keys(e.lists).find(
    (k) => k.toLowerCase() === list.toLowerCase(),
  );
  return key ? e.lists[key] : [];
}

export function accentOf(ctx: BlockCtx, e: Entity | undefined): string | undefined {
  return e?.type ? (ctx.records.accents?.[e.type] as string | undefined) : undefined;
}

export function dialOf(ctx: BlockCtx, entry: Entry): string | undefined {
  return ctx.records.dials?.[entry.name] as string | undefined;
}

/** An entry by name, wherever it lives — the `pins` record names an
 * entry, never a list, so a pinned field could be under `stats`,
 * `meta`, anywhere. */
export function entryNamed(e: Entity | undefined, name: string): Entry | undefined {
  if (!e) return undefined;
  for (const entries of Object.values(e.lists)) {
    const hit = entries.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (hit) return hit;
  }
  return undefined;
}

/**
 * The entries the system pinned to this counter — a stat that reads
 * beside a gauge rather than in the list it lives in.
 *
 * A PINNED NAME ALWAYS READS, and it reads ZERO when the entity holds
 * nothing for it (§M-8, "absent is zero": absence is the number, not
 * "untracked"). A declaration that says this stat belongs beside this
 * counter is saying the slot exists for everyone the system runs; an
 * entity that never wrote a value has the base value, which is 0, and a
 * dash in its place claimed a stat the arithmetic uses simply wasn't
 * there.
 *
 * The reading is synthesized, never stored: storage stays sparse and
 * nothing writes a 0 into an entity or a template. A person typing over
 * the slot materializes the stat the ordinary way (rule 1) — the write
 * door is the same one every other entry uses.
 *
 * Which stat this is, is the system's word (`pins`), never teller's.
 */
export function pinsOf(ctx: BlockCtx, e: Entity | undefined, entry: Entry): Entry[] {
  const names = (ctx.records.pins?.[entry.name] as string[] | undefined) ?? [];
  return names.map((n) => {
    const held = entryNamed(e, n);
    if (held && held.value !== undefined && held.value !== '') return held;
    return { ...(held ?? {}), name: held?.name ?? n, value: 0 };
  });
}

/**
 * Does this entry get its own face on a 'sheet'-shaped panel — a
 * `HealthPanel` (something's pinned to it) or a `Cylinder` (dialled
 * that way and small enough)? The generic rule (rule 2) behind "Sheet
 * shows Health + Grit" (fix 6): nothing here names either counter, it's
 * a fact about the DECLARATION, so it's also how the seat chrome knows
 * what the Sheet screen already claims when it builds the 'More' screen
 * (`SeatChrome.tsx`).
 */
export function shaped(ctx: BlockCtx, e: Entity | undefined, entry: Entry): boolean {
  return pinsOf(ctx, e, entry).length > 0 || (dialOf(ctx, entry) === 'cylinder' && dialable(entry));
}

function filterEntries(entries: Entry[], filter: unknown, names?: unknown): Entry[] {
  const capped = (e: Entry) => typeof e.max === 'number' && e.max > 0;
  if (filter === 'capped') return entries.filter(capped);
  if (filter === 'uncapped') return entries.filter((e) => !capped(e));
  const wanted = new Set(
    Array.isArray(names) ? names.map((n) => String(n).toLowerCase()) : [],
  );
  if (filter === 'named') return entries.filter((e) => wanted.has(e.name.toLowerCase()));
  if (filter === 'except-named') return entries.filter((e) => !wanted.has(e.name.toLowerCase()));
  return entries;
}

/** A path from a records slot, resolved to a fetchable url — or nothing. */
function useArt(path: string | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!path) {
      setUrl(undefined);
      return;
    }
    let cancelled = false;
    fileUrl(path).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);
  return url;
}

// ---- header --------------------------------------------------------------
// Old sheet header grammar: a serif name, the type as an accent-coloured
// caption, and the pack's own portrait for that type (ported plate shape
// from src/components/sheet/SheetHeader.tsx — trimmed to what the panel
// declares: no player/trade fields, no spend chips yet).

function HeaderBlock({ ctx }: { ctx: BlockCtx }) {
  const e = subject(ctx);
  const accent = accentOf(ctx, e);
  const portraitPath = e?.type
    ? (ctx.records.portraits?.[e.type] as string | undefined)
    : undefined;
  const portraitUrl = useArt(portraitPath);

  if (!e) return <Refusal>no entity to head</Refusal>;
  return (
    <header className="flex items-center gap-3 px-1">
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-serif text-2xl text-stone-100">{e.name}</h1>
        {e.type && (
          <span
            className={`block ${sectionLabel}`}
            style={accent ? { color: accent } : undefined}
          >
            {e.type}
          </span>
        )}
      </div>
      {portraitUrl && (
        <img
          src={portraitUrl}
          alt=""
          className="h-[4.2rem] w-[4.2rem] shrink-0 rounded-full border-2 object-cover"
          style={{ borderColor: accent ? `${accent}88` : '#57534e' }}
        />
      )}
    </header>
  );
}

registerBlock('header', (_block, ctx) => <HeaderBlock ctx={ctx} />);

// ---- brand -----------------------------------------------------------
// The system's mark, when a pack brought one (record 'brand'). Sized as
// the vanilla client's own `.brand-logo`.

function BrandBlock({ ctx }: { ctx: BlockCtx }) {
  const logoPath = ctx.records.brand?.logo as string | undefined;
  const url = useArt(logoPath);
  if (!url) return null;
  return <img src={url} alt="" className="mx-auto block max-h-[4.5rem] max-w-[60%]" />;
}

registerBlock('brand', (_block, ctx) => <BrandBlock ctx={ctx} />);

// ---- list ------------------------------------------------------------
// `as` maps to the old app's counter layouts; a per-entry `dials` record
// of 'cylinder' overrides whatever the arrangement asked for, same as
// the vanilla client's presentation() — the system's word for THIS name
// beats the panel's generic one.

/** The floor's own auto grammar, one entry: bare → chip, string → row, number → stepper. */
function AutoEntry({
  entry,
  onWrite,
}: {
  entry: Entry;
  onWrite: (edit: Record<string, unknown>) => void;
}) {
  if (entry.value === undefined) {
    return (
      <span className="flex w-fit items-center gap-1.5 overflow-hidden rounded-full bg-amber-950/60 py-1 pl-2.5 pr-2 text-xs text-amber-200">
        {entry.name}
        <button
          className="text-amber-500/60 transition-colors hover:text-red-300"
          onClick={() => onWrite({ remove: true })}
          title="remove"
        >
          ✕
        </button>
      </span>
    );
  }
  if (typeof entry.value === 'string') {
    return (
      <div className="flex items-baseline gap-2">
        <span className="text-sm text-stone-200">{entry.name}</span>
        <span className="ml-auto font-mono text-sm text-stone-300">{entry.value}</span>
      </div>
    );
  }
  return (
    <CounterStepper
      entry={entry}
      onBump={(d) => onWrite({ value: stepValue(entry, d) })}
    />
  );
}

/**
 * The `rows` skills list, wrapped so it can call `useRuleLookup` — the
 * `list` block's own registration is a plain function, not a component,
 * and hooks need one (same reason `StatusesBlock`/`HeaderBlock` exist
 * as their own components below).
 */
function RowsBlock({
  title,
  entries,
  accent,
  dice,
  markedNames,
  markTitle,
}: {
  title: string;
  entries: Entry[];
  accent?: string;
  dice?: DiceRecord;
  /** Lowercased skill names whose Talent is bought (the `marks` list — see the `marks` record). */
  markedNames?: Set<string>;
  markTitle?: string;
}) {
  const lookup = useRuleLookup();
  const note = usePanelNote();
  return (
    <SheetPanel title={title} note={note(title)} className="w-full">
      <div className="divide-y divide-stone-800/80">
        {entries.map((entry) => (
          <SkillRow
            key={entry.name}
            entry={entry}
            accent={accent}
            dice={dice}
            marked={markedNames?.has(entry.name.toLowerCase())}
            markTitle={markTitle}
            lookup={lookup}
          />
        ))}
      </div>
    </SheetPanel>
  );
}

/**
 * The `sheet` layout's own gauge treatment, wrapped so it can call
 * `usePanelNote` — a pinned counter (Health, with Defense beside it)
 * gets `HealthPanel`; a counter dialled a cylinder (Grit) gets
 * `Cylinder`; anything else is not this shape and sits out (fix 6 —
 * "Sheet shows Health + Grit", not every capped resource; the rest
 * surface on the seat chrome's declared-screens tabs instead, see
 * `SeatChrome.tsx`'s 'More').
 *
 * Both faces are SUMMONED (§L phase 3), not imported — and a system that
 * supplies neither still gets a working sheet: `shaped()` is a fact
 * about the DECLARATION (something is pinned here, this one is dialled),
 * so the counter is still the one the sheet means to show, and with no
 * face to draw it in, the floor's own stepper draws it. That is the
 * neutral bottom of §L's target state, wired now rather than promised.
 */
function SheetListBlock({
  entries,
  ctx,
  e,
  accent,
  write,
}: {
  entries: Entry[];
  ctx: BlockCtx;
  e: Entity | undefined;
  accent?: string;
  write: (entryName: string, edit: Record<string, unknown>) => void;
}) {
  useSystemFaces(); // re-render when the system module lands (url-loaded, async)
  const note = usePanelNote();
  const shown = entries.filter((entry) => shaped(ctx, e, entry));
  if (!shown.length) return null;
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' }}
    >
      {shown.map((entry) => {
        const pinned = pinsOf(ctx, e, entry);
        if (pinned.length) {
          const Health = presentationOf<HealthFace>('HealthPanel');
          return Health ? (
            <Health
              key={entry.name}
              entry={entry}
              pinned={pinned}
              note={note(entry.name)}
              onSet={(v) => write(entry.name, { value: v })}
            />
          ) : (
            <CounterStepper
              key={entry.name}
              entry={entry}
              onBump={(d) => write(entry.name, { value: stepValue(entry, d) })}
            />
          );
        }
        const Dial = presentationOf<CylinderFace>(dialOf(ctx, entry) ?? '');
        return Dial ? (
          <Dial
            key={entry.name}
            entry={entry}
            note={note(entry.name)}
            onSet={(v) => write(entry.name, { value: v })}
            accent={accent}
          />
        ) : (
          <CounterStepper
            key={entry.name}
            entry={entry}
            onBump={(d) => write(entry.name, { value: stepValue(entry, d) })}
          />
        );
      })}
    </div>
  );
}

registerBlock('list', (block, ctx) => {
  const e = subject(ctx);
  const name = typeof block.list === 'string' ? block.list : '';
  if (!name) return <Refusal>a list block with no list</Refusal>;
  const as = typeof block.as === 'string' ? block.as : 'auto';
  const accent = accentOf(ctx, e);
  const entries = filterEntries(entriesOf(e, name), block.filter, block.names);

  const write = (entryName: string, edit: Record<string, unknown>) =>
    ctx.write?.({ list: name, name: entryName, ...edit });

  if (as === 'chips') {
    if (!entries.length) return null;
    return (
      <TagSection
        entries={entries}
        onWrite={(edit) => write(edit.name, edit)}
        label={name}
      />
    );
  }

  // A read-only glance strip — the generic stat chips the old app drew
  // under a seat layout that doesn't place its own fields (every layout
  // but Sheet). Not `chips` (TagSection): these are fixed named values,
  // not a removable tag list, and offering a ✕ on "Charm" made no sense.
  if (as === 'strip') {
    if (!entries.length) return null;
    return (
      <div className="flex flex-wrap gap-1">
        {entries.map((entry) => (
          <span key={entry.name} className="rounded-md bg-stone-900 px-2 py-1 text-xs">
            <span className="font-mono text-stone-100">{entry.value ?? '—'}</span>
            <span className="ml-1 uppercase tracking-wider text-stone-500">{entry.name}</span>
          </span>
        ))}
      </div>
    );
  }

  if (as === 'rows') {
    if (!entries.length) return null;
    const markedNames = new Set(
      entriesOf(e, 'marks').map((m) => m.name.toLowerCase()),
    );
    const marksRecord = ctx.records.marks as { text?: string } | undefined;
    return (
      <RowsBlock
        title={titleCase(name)}
        entries={entries}
        accent={accent}
        dice={ctx.records.dice as DiceRecord | undefined}
        markedNames={markedNames}
        markTitle={marksRecord?.text}
      />
    );
  }

  if (as === 'sheet') {
    if (!entries.length) return null;
    return <SheetListBlock entries={entries} ctx={ctx} e={e} accent={accent} write={write} />;
  }

  if (as === 'big') {
    if (!entries.length) return null;
    return (
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' }}
      >
        {entries.map((entry) => {
          // The dial word names a face; the SYSTEM decides whether one
          // exists. No face, no drama — `BigGauge` is the floor and was
          // always what an undialled counter got here.
          //
          // `dialable` is a Cylinder-ism (a ring of more than twelve
          // chambers stops being countable) still gating every dial,
          // which is one face's constraint wearing the seam's clothes.
          // Kept as-is because it's what shipped; the honest fix is a
          // face declaring its own fitness, and it is still owed.
          const Dial = dialable(entry)
            ? presentationOf<CylinderFace>(dialOf(ctx, entry) ?? '')
            : undefined;
          return Dial ? (
            <Dial
              key={entry.name}
              entry={entry}
              onSet={(v) => write(entry.name, { value: v })}
              accent={accent}
            />
          ) : (
            <BigGauge
              key={entry.name}
              entry={entry}
              onWrite={(v) => write(entry.name, { value: v })}
            />
          );
        })}
      </div>
    );
  }

  if (as === 'ledger') {
    if (!entries.length) return null;
    return (
      <div className="flex flex-col">
        {entries.map((entry) => (
          <LedgerRow
            key={entry.name}
            entry={entry}
            onWrite={(v) => write(entry.name, { value: v })}
          />
        ))}
      </div>
    );
  }

  if (as === 'bars') {
    if (!entries.length) return null;
    return (
      <div className="flex flex-col gap-2">
        {entries.map((entry) => (
          <CounterStepper
            key={entry.name}
            entry={entry}
            onBump={(d) => write(entry.name, { value: stepValue(entry, d) })}
          />
        ))}
      </div>
    );
  }

  // auto — the floor's grammar, dressed in a labelled card.
  return (
    <section className={`${card} flex flex-col gap-2`}>
      <p className={sectionLabel}>{name}</p>
      {entries.length === 0 && <Refusal>nothing here yet</Refusal>}
      {entries.map((entry) => (
        <AutoEntry
          key={entry.name}
          entry={entry}
          onWrite={(edit) => write(entry.name, edit)}
        />
      ))}
    </section>
  );
});

// ---- statuses ----------------------------------------------------------
// The system's statuses (`/api/stack/declarations/statuses`), drawn the
// way the printed sheet does — the WHOLE declared list, always, each row
// a Severity box and the relieving Skill underneath the name (ported
// `StatusPanel`, not a chip strip). The entity's own `conditions` list
// is the stored truth; the declaration only supplies the row and the
// relief. What a status DOES, in words, is the pack's — read off the
// merged sections through `useRuleLookup`, never off the declaration's
// `effect` keyword (rule 4's split: system mechanic, pack prose).

function StatusesBlock({ ctx, title = 'Statuses' }: { ctx: BlockCtx; title?: string }) {
  useSystemFaces(); // re-render when the system module lands (url-loaded, async)
  const e = subject(ctx);
  const lookup = useRuleLookup();
  const note = usePanelNote();
  const [decls, setDecls] = useState<StatusDecl[] | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    api<StatusDecl[]>('/api/stack/declarations/statuses')
      .then((d) => {
        if (!cancelled) setDecls(d);
      })
      .catch(() => {
        if (!cancelled) setDecls([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!e || !decls) return null;
  const entries = entriesOf(e, 'conditions');

  // Summoned, not imported (§L phase 3) — severity boxes with a relief
  // caption are how the WiW sheet PRINTS its statuses, not how every
  // system has them. Without a face the stored list still shows, in the
  // floor's own grammar: a labelled card of steppers you can edit. The
  // declaration's relief column and the pack's own words are what's
  // lost, and losing them is honest — nothing renders them.
  const Status = presentationOf<StatusFace>('StatusPanel');
  if (!Status) {
    if (!entries.length) return null;
    return (
      <section className={`${card} flex flex-col gap-2`}>
        <p className={sectionLabel}>{title}</p>
        {entries.map((entry) => (
          <AutoEntry
            key={entry.name}
            entry={entry}
            onWrite={(edit) => ctx.write?.({ list: 'conditions', name: entry.name, ...edit })}
          />
        ))}
      </section>
    );
  }

  return (
    <Status
      declared={decls}
      entries={entries}
      onWrite={(edit) => ctx.write?.({ list: 'conditions', ...edit })}
      lookup={lookup}
      title={title}
      note={note(title)}
    />
  );
}

registerBlock('statuses', (_block, ctx) => <StatusesBlock ctx={ctx} />);

// ---- panel (the include — §M-5a′) --------------------------------------
// The one block that isn't a drawing: it names another panel, and
// whatever that name MERGES to is rendered here, inheriting this
// context whole. Every level of composition becomes a named, mergeable
// file — and a pack restating one fragment updates every arrangement
// that includes it. The refusals (a cycle, a name nobody declares) live
// with the machinery in `render.tsx`.

registerBlock('panel', (block, ctx) => (
  <IncludeBlock name={typeof block.name === 'string' ? block.name : ''} ctx={ctx} />
));

// ---- aside ---------------------------------------------------------------
// A plain, teller-authored line — never pack content (rule 4), so this
// is the one text block that's safe to write straight into a panel's
// `blurb`/`text`. The seat chrome uses it for the honest "no items yet"
// note on a screen whose subsystem hasn't landed (fix 1).

registerBlock('aside', (block, _ctx) => {
  const text = typeof block.text === 'string' ? block.text : '';
  return text ? <Refusal>{text}</Refusal> : null;
});

// ---- spend-door (the way in to a declared advancement menu) -------------
// Self-contained since §M-5a: it reads `spends` off the merged records
// and the wallet off the subject, so a DECLARED panel may carry it —
// which is what let 'More' stop being code and become a system's own
// `.panel` file. The component (door + overlay) is
// `client/components/SpendDoor.tsx`.

registerBlock('spend-door', (_block, ctx) => <SpendDoor ctx={ctx} />);

// ---- carried (§K — the system's own Weapons/Abilities/Inventory) -------
// The seat chrome synthesizes one of these per declared screen
// (`carriedPanel`, `client/components/seat/SeatChrome.tsx`) — the block
// itself just hands the screen declaration and the kinds every OTHER
// screen already claimed (so a `rest` screen knows what's left over) to
// `CarriedScreen`, which does the actual work.

registerBlock('carried', (block, ctx) => (
  <CarriedScreen
    ctx={ctx}
    screen={block.screen as ScreenDecl}
    claimedKinds={new Set((block.claimedKinds as string[] | undefined) ?? [])}
  />
));

// The `shop` block lived here — the seat's side of the counter, handed
// a `/api/shop` answer by the chrome above it. It is the store plugin's
// own pane now (§15's UI tier), which is why there is no block for it
// and no import of one: a plugin's surface is a TAKEOVER, so it needs
// no noun in teller's grammar to hang itself on.

// ---- notes -------------------------------------------------------------

registerBlock('notes', (_block, ctx) => {
  const e = subject(ctx);
  if (!e?.notes) return null;
  return (
    <section className={`${card} flex flex-col gap-2`}>
      <p className={sectionLabel}>notes</p>
      <p className="text-sm whitespace-pre-wrap text-stone-300">{e.notes}</p>
    </section>
  );
});

// ---- children ----------------------------------------------------------
// A nested entity gets its own small card — name, type, and its lists in
// the floor's plain grammar. Not a full sheet-in-a-sheet; a stray in the
// same sense `rest` catches strays, just one level down.

registerBlock('children', (_block, ctx) => {
  const e = subject(ctx);
  if (!e?.children?.length) return null;
  return (
    <>
      {e.children.map((child) => (
        <section key={child.id} className={`${card} flex flex-col gap-2`}>
          <div className="flex items-baseline gap-2">
            <p className="text-sm font-medium text-stone-100">{child.name}</p>
            {child.type && <span className={sectionLabel}>{child.type}</span>}
          </div>
          {Object.entries(child.lists).map(([listName, entries]) => (
            <div key={listName} className="flex flex-col gap-1">
              <p className="text-[10px] uppercase tracking-widest text-stone-600">
                {listName}
              </p>
              {entries.map((entry) => (
                <div key={entry.name} className="flex items-baseline gap-2 text-sm">
                  <span className="text-stone-300">{entry.name}</span>
                  {entry.value !== undefined && (
                    <span className="ml-auto font-mono text-stone-400">
                      {entry.value}
                      {entry.max !== undefined && (
                        <span className="text-stone-600"> / {entry.max}</span>
                      )}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </section>
      ))}
    </>
  );
});

// ---- floor (§7 — every stored value, one control each) ----------------
// The `bare` panel's block, and the port of `server/public/panel.js`'s
// `renderPanel` (vanilla, view-source-is-the-source) — the complete,
// ugly, fully-operable sheet a table still has with zero declarations.
// The control follows the value's SHAPE, not a declaration: this is
// `AutoEntry`'s own grammar (chip / inline text / stepper), applied to
// EVERY list rather than the one `rest` was handed, plus the vanilla
// panel's add-entry and add-list affordances neither `rest` nor `list`
// ever needed — a declared block places specific lists by name, so it
// never had to invent one.
//
// Name/type edits are old scope, noted in the task: `ctx.write` is the
// seat's one door (`POST /entities/:id/entry`) and only ever touches an
// entry inside a list — renaming the entity or its type needs a whole-
// entity PUT that isn't part of `BlockCtx`. The `header` block already
// draws name/type read-only, so the floor reuses it rather than doing a
// half job of its own.
//
// `ctx.entity` arrives already resolved (every caller fetches with
// `?resolved=1` — `App.tsx`, `SeatChrome.tsx`) — fine for the read-only
// header/notes/children below, but the floor's OWN editable grid has to
// show what's actually STORED, the same distinction the vanilla panel
// drew between `renderPanel` (stored, editable) and its "reads as"
// aside (resolved, read-only) — so this fetches the stored entity
// itself rather than trusting the ambient one.

function FloorAddEntry({ onAdd }: { onAdd: (name: string, value: number | string | undefined, max: number | undefined) => void }) {
  return (
    <button
      className="text-[11px] text-stone-500 hover:text-stone-300"
      onClick={() => {
        const name = window.prompt('name?')?.trim();
        if (!name) return;
        const raw = window.prompt('value? (blank = held, number = count, words = text)')?.trim() ?? '';
        if (!raw) return onAdd(name, undefined, undefined);
        const asNumber = Number(raw);
        if (!Number.isFinite(asNumber)) return onAdd(name, raw, undefined);
        const cap = window.prompt('max? (blank = none)')?.trim() ?? '';
        const max = cap && Number.isFinite(Number(cap)) ? Number(cap) : undefined;
        onAdd(name, asNumber, max);
      }}
    >
      + add
    </button>
  );
}

function FloorBlock({ ctx }: { ctx: BlockCtx }) {
  const id = subject(ctx)?.id;
  const [stored, setStored] = useState<Entity | undefined>(undefined);
  const [resolved, setResolved] = useState<Entity | undefined>(undefined);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!id) {
      setStored(undefined);
      setResolved(undefined);
      return;
    }
    let cancelled = false;
    Promise.all([
      api<Entity>(`/api/entities/${id}`),
      api<Entity>(`/api/entities/${id}?resolved=1`),
    ]).then(([s, r]) => {
      if (!cancelled) {
        setStored(s);
        setResolved(r);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id, tick]);

  if (!id || !stored) return <Refusal>no entity to show</Refusal>;

  const write = (list: string, entryName: string, edit: Record<string, unknown>) => {
    ctx.write?.({ list, name: entryName, ...edit })?.then(() => setTick((t) => t + 1));
  };

  const addEntry = (list: string, name: string, value: number | string | undefined, max: number | undefined) =>
    write(list, name, max !== undefined ? { value, max } : { value });

  const addList = () => {
    const name = window.prompt('list name? (skills, resources, conditions, …)')?.trim();
    if (!name) return;
    // A list needs a first entry to exist at all — `writeEntry` vivifies
    // the list on the entry write, there's no bare "create an empty
    // list" door without a whole-entity PUT (see the note above).
    const entryName = window.prompt('its first entry — name?')?.trim();
    if (!entryName) return;
    const raw = window.prompt('value? (blank = held, number = count, words = text)')?.trim() ?? '';
    if (!raw) return addEntry(name, entryName, undefined, undefined);
    const asNumber = Number(raw);
    if (!Number.isFinite(asNumber)) return addEntry(name, entryName, raw, undefined);
    const cap = window.prompt('max? (blank = none)')?.trim() ?? '';
    const max = cap && Number.isFinite(Number(cap)) ? Number(cap) : undefined;
    addEntry(name, entryName, asNumber, max);
  };

  return (
    <div className="flex flex-col gap-3">
      <RenderBlock block={{ block: 'header' }} ctx={ctx} />

      {Object.entries(stored.lists).map(([listName, entries]) => (
        <section key={listName} className={`${card} flex flex-col gap-2`}>
          <div className="flex items-center justify-between">
            <p className={sectionLabel}>{listName}</p>
            <FloorAddEntry onAdd={(name, value, max) => addEntry(listName, name, value, max)} />
          </div>
          {entries.length === 0 && <Refusal>nothing here yet</Refusal>}
          {entries.map((entry) => (
            <AutoEntry
              key={entry.name}
              entry={entry}
              onWrite={(edit) => write(listName, entry.name, edit)}
            />
          ))}
        </section>
      ))}

      <button className="w-fit text-[11px] text-stone-500 hover:text-stone-300" onClick={addList}>
        + add list
      </button>

      <RenderBlock block={{ block: 'notes' }} ctx={ctx} />
      <RenderBlock block={{ block: 'children' }} ctx={ctx} />

      {resolved && (
        <details className={card}>
          <summary className={`${sectionLabel} cursor-pointer`}>
            reads as (resolved through templates)
          </summary>
          <pre className="mt-2 overflow-x-auto text-xs text-stone-400">
            {JSON.stringify(resolved, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

registerBlock('floor', (_block, ctx) => <FloorBlock ctx={ctx} />);

// ---- rest (strays surface — the degradation contract, arranged) -------

registerBlock('rest', (block, ctx) => {
  const e = subject(ctx);
  if (!e) return null;
  const placed = new Set(
    (Array.isArray(block.except) ? block.except : []).map((n) =>
      String(n).toLowerCase(),
    ),
  );
  // Every entry name a `pins` declaration already drew somewhere else
  // (Defense, pinned into Health's own panel) — excluded per-ENTRY
  // rather than dropping its whole list, so a sibling stat the system
  // never pinned (Speed, beside Defense in `stats`) still surfaces here.
  const pinned = new Set(
    Object.values((ctx.records.pins as Record<string, string[]> | undefined) ?? {})
      .flat()
      .map((n) => n.toLowerCase()),
  );
  const strays = Object.keys(e.lists).filter((k) => !placed.has(k.toLowerCase()));
  const sections = strays
    .map((name) => ({
      name,
      entries: e.lists[name].filter((entry) => !pinned.has(entry.name.toLowerCase())),
    }))
    .filter((s) => s.entries.length > 0);
  if (!sections.length) return null;
  return (
    <>
      {sections.map(({ name, entries }) => (
        <section key={name} className={`${card} flex flex-col gap-2`}>
          <p className={sectionLabel}>{name}</p>
          {entries.map((entry) => (
            <AutoEntry
              key={entry.name}
              entry={entry}
              onWrite={(edit) => ctx.write?.({ list: name, name: entry.name, ...edit })}
            />
          ))}
        </section>
      ))}
    </>
  );
});

// ---- columns -----------------------------------------------------------

registerBlock('columns', (block, ctx) => {
  const cols = Array.isArray(block.columns) ? block.columns : [];
  return (
    <div className="flex gap-4">
      {cols.map((col, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col gap-4">
          {Array.isArray(col) &&
            col.map((b, j) =>
              b && typeof b === 'object' && 'block' in b ? (
                <RenderInColumn key={j} block={b as PanelBlock} ctx={ctx} />
              ) : null,
            )}
        </div>
      ))}
    </div>
  );
});

function RenderInColumn({ block, ctx }: { block: PanelBlock; ctx: BlockCtx }) {
  return <RenderBlock block={block} ctx={ctx} />;
}

// ---- tool (dispatch into the registry) --------------------------------
// The tool files are imported HERE, not from the registry: they import
// registerTool from tools/index.ts, so the registry importing them back
// was a cycle — and the first tool evaluated before the registry's Map
// existed (TDZ). The consumer imports both sides; the graph is a tree.

import { toolOf } from '../tools/index.ts';
import '../tools/roster.tsx';
import '../tools/runner.tsx';
import '../tools/encounters.tsx';
import '../tools/bestiary.tsx';
import '../tools/screens.tsx';
import '../tools/shelf.tsx';
import '../tools/plugins.tsx';
import '../tools/boards.tsx';
import '../tools/handouts.tsx';
import '../tools/log.tsx';
import '../tools/rules.tsx';
import '../tools/books.tsx';
// `store` was here and is GONE (§15, 2026-08-20): it was a squatter's
// residence from the day it landed and it moved out to the plugin it
// was always going to be. A system declaring `tool: store` now gets the
// registry's ordinary refusal — which is correct, and is why the
// system-layer store panels went with it.

registerBlock('tool', (block, ctx) => {
  const name = typeof block.tool === 'string' ? block.tool : '';
  const render = toolOf(name);
  if (!render)
    return <Refusal>this build doesn't know the tool '{name || '?'}'</Refusal>;
  return <>{render(block, ctx)}</>;
});

// The 'turn' block registers in tools/runner.tsx — it and the runner
// tool are one port and share their pieces.

// ---- ladders (§15's standing scales, arranged) --------------------------
// One panel per declared ladder (`/api/stack/declarations/ladders`), the
// roster read off the declared SECTION the ladder names — parties are
// world content and live in the pack, so the block learns them at
// runtime and never from code.
//
// The face is SUMMONED like every other (§L phase 3): a system that
// prints its standing scales a particular way ships `LadderPanel.tsx`
// and gets it; a system that ships none still gets a working, tappable
// scale, because `LadderFloor` is a fact about the DECLARATION (an
// ordered list of rungs over a `steps` kind) and needs no vocabulary.

import { useRuleSections } from '../lib/rules.ts';
import { LadderFloor, ladderList, toLadder, type LadderDecl, type LadderPanelProps } from '../components/LadderFloor.tsx';

type LadderFace = typeof LadderFloor;

function LaddersBlock({ ctx }: { ctx: BlockCtx }) {
  useSystemFaces(); // re-render when the system module lands (url-loaded, async)
  const e = subject(ctx);
  const sections = useRuleSections();
  const lookup = useRuleLookup();
  const note = usePanelNote();
  const accent = accentOf(ctx, e);
  const [decls, setDecls] = useState<LadderDecl[] | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<unknown[]>('/api/stack/declarations/ladders')
      .then((raw) => {
        if (!cancelled)
          setDecls(raw.map(toLadder).filter((l): l is LadderDecl => l !== undefined));
      })
      .catch(() => {
        if (!cancelled) setDecls([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!decls?.length) return null;
  const Ladder = presentationOf<LadderFace>('LadderPanel') ?? LadderFloor;
  const shown = open ? lookup(open) : undefined;

  return (
    <>
      {decls.map((ladder) => {
        // The roster: every entry name in the declared section, in the
        // order the merged stack gives them.
        const roster = sections
          .filter((s) => s.name.trim().toLowerCase() === (ladder.section ?? '').trim().toLowerCase())
          .flatMap((s) => s.entries.map((entry) => entry.name))
          .filter((name, i, all) => all.indexOf(name) === i);
        const props: LadderPanelProps = {
          ladder,
          entity: e,
          roster,
          note: note(ladder.label ?? ladder.name),
          accent,
          hasEntry: (name) => Boolean(lookup(name)?.text),
          onOpen: (name) => setOpen(open === name ? null : name),
          // The rung, plainly. The `steps` kind on the write door is
          // what makes tapping the resting rung REMOVE the row rather
          // than store a default — one law, wherever the write came
          // from (`core/kind.ts`, `Session.writeEntry`).
          onSet: ctx.write
            ? (name, step) =>
                void ctx.write?.({ list: ladderList(ladder), name, value: step })
            : undefined,
        };
        return <Ladder key={ladder.name} {...props} />;
      })}
      {shown && (
        <section className={`${card} flex flex-col gap-1`}>
          <p className={sectionLabel}>{shown.name}</p>
          <p className="text-sm whitespace-pre-wrap text-stone-300">{shown.text}</p>
        </section>
      )}
    </>
  );
}

registerBlock('ladders', (_block, ctx) => <LaddersBlock ctx={ctx} />);
