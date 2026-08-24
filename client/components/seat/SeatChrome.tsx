// The seat, assembled — and since §M-5a, ASSEMBLED IS ALL IT DOES.
//
// What lives here is what stays teller's: which entity this seat is
// pointed at, what the tab list is, where the fight stands, which note
// arrived, and the one write a seat may make into the order. What it
// LOOKS like doesn't — the five chrome seams (`seams.tsx`) resolve to a
// presentation the same way every other face does, system-first,
// pack-winning, teller's floor last.
//
// Two shapes, one file, and the SEAT PICKS NEITHER (Brian, 2026-08-20):
// a seat takes the role and the character, and no layout at all. So the
// shape is resolved from the merge — `seatComposite` in core — and the
// two answers are: a COMPOSITE, a panel carrying `tabs`, which declares
// the seat outright (the order is its list, a stray appends rather than
// vanishing, and its `chrome` map may name a presentation per seam); or,
// where a shelf declares none, the floor assembly around `sheet`,
// exactly the shipped old behavior — its blocks are the first tab, the
// carried screens and panes follow, More catches the strays.
//
// `initialPanel` is what remains of the old `params.layout`, and it is
// the CONSOLE's now, not a seat's: the `#panel=<name>&entity=<id>` route
// previewing one arrangement on a screen that isn't a seat. A composite
// still wins over it, because there is one seat and this is a look at
// it.
//
// The seam from the old app, unchanged and now the Header floor's:
// `SheetHeader` read the trade/player off `groups.title`/`groups.player`
// FIELDS and priced its chips off `use.costCounter`/`use.costs`. The new
// `Entity` gives the trade for free (`entity.type`) and the player is the
// SEAT's own identity now (rule 7 — a seat belongs to a person, and that
// person is who the DM named the display for), so `seatName` is preferred
// and the `meta` list's own "Player" entry is only the fallback.

import { useCallback, useEffect, useState } from 'react';
import { isDraft, type Entity } from '../../../core/entity.ts';
import type { PanelBlock, PanelDef } from '../../../core/panels.ts';
import { draftTakeover, PLACED, seatComposite, surfaceable } from '../../../core/panels.ts';
import { toSpends } from '../../../core/effects.ts';
import { ladderList, toLadder } from '../LadderFloor.tsx';
import { api, displaySlot, panes as fetchPanes, scoreEntry, type Pane } from '../../lib/api.ts';
import { paneToPanel, pluginCtx, showing } from '../../lib/panes.ts';
import { DECLARED, onNudge, PLUGIN_WORD, PROVIDED } from '../../lib/use-session.ts';
import { useOptimistic, writeEntry, type EntryEdit } from '../../lib/entry.ts';
import { entriesOf, shaped } from '../../panels/blocks.tsx';
import { ConnectionHint } from '../ConnectionHint.tsx';
import { PanelCollection, PanelSurface, type BlockCtx, type Glass } from '../../panels/render.tsx';
import type { ScreenDecl } from '../items/types.ts';
import { useTurnCall } from './TurnCall.tsx';
import { usePassedNotes } from './PassedNote.tsx';
import { useSeams, type SeatTab } from './seams.tsx';

type Records = Record<string, Record<string, unknown>>;

const RECORD_SLOTS = ['accents', 'dials', 'brand', 'portraits', 'pins', 'use', 'currency', 'icons', 'groups', 'dice', 'marks', 'spends', 'vocabulary'];

/** Every declared screen's own claimed counters, lower-cased, in one set. */
function screenClaims(screens: ScreenDecl[]): Set<string> {
  return new Set(screens.flatMap((s) => s.counters ?? []).map((n) => n.toLowerCase()));
}

/** Every kind ANY declared screen claims — what a `rest` screen (Inventory) catches is what's left over. */
function allClaimedKinds(screens: ScreenDecl[]): string[] {
  return [...new Set(screens.flatMap((s) => s.kinds ?? []).map((k) => k.toLowerCase()))];
}

/** A synthetic PanelDef for one declared screen — the `carried` block
 * (`client/panels/blocks.tsx` → `client/components/items/Screen.tsx`)
 * does the actual work: weapon/ability/ammo/gear tiles, the chamber
 * select and trigger, the purse. */
function carriedPanel(screen: ScreenDecl, allScreens: ScreenDecl[]): PanelDef {
  const blocks: PanelBlock[] = [
    { block: 'carried', screen, claimedKinds: allClaimedKinds(allScreens) },
  ];
  return { name: screen.name, subject: 'entity', mounted: blocks, held: blocks };
}

// The SHOP tab used to be synthesized right here, off `/api/shop`, and
// it was the strongest argument in the pane tier's favour: a tab that
// comes and goes with a fact about the moment, wanted by a feature that
// had no business being in teller. It is a provided pane now — the
// store plugin declares `pane.shop` with `when: 'shop'`, and the loop
// below offers it exactly while that door answers with something. One
// declared word replaced a hard-coded screen, and the next plugin that
// wants a tab that comes and goes writes `when` instead of a patch to
// this file.

/** The old app's holding pen ('More'), as teller's FLOOR: every resource
 * the Sheet screen and every declared carried-screen didn't claim, plus
 * the strays the `rest` block already knows how to surface, plus
 * notes/children.
 *
 * §M-5a says More stops being code and becomes a `.panel` file, and it
 * has: a system that ships `panels/more/` gets its own, merged and
 * overridable like everything else. This stays as the answer for a
 * system that ships none — the floor, synthesized, because the strays
 * a system never placed still have to land somewhere.
 *
 * The declared standing scales ride here too (the old app's precedent:
 * `LadderPanel` rode on More), and the `ladders` block draws nothing at
 * all on a system that declares none — so this stays one arrangement
 * whether or not anybody has a standing scale. Their lists join
 * `rest`'s exclusions for the same reason every placed list does: a
 * list drawn as a ladder above must not surface again as a stray
 * below. */
function morePanel(
  claimed: Set<string>,
  ladderLists: string[],
  /** Whether declared carried screens already show what's carried —
   * if they do, More re-listing every child (stats, prices and all)
   * is a duplicate inventory with the shop's numbers leaking through;
   * the block only rides for a system with no screens of its own. */
  hasCarriedScreens = false,
): PanelDef {
  const blocks: PanelBlock[] = [
    { block: 'spend-door' },
    { block: 'list', list: 'resources', filter: 'except-named', names: [...claimed], as: 'ledger' },
    { block: 'ladders' },
    { block: 'rest', except: [...PLACED, ...ladderLists] },
    ...(hasCarriedScreens ? [] : [{ block: 'children' } as PanelBlock]),
    { block: 'notes' },
  ];
  return { name: 'More', subject: 'entity', mounted: blocks, held: blocks };
}

/** One tab: the bar's own key/label/icon, decoupled from whichever
 * PanelDef it renders. The NAME is the key (what `current` holds and
 * what a composite's `tabs` list names); the LABEL is only what a
 * person reads, so a pack's `sheet` can still say 'Character Sheet'. */
type Tab = SeatTab & {
  panel: PanelDef;
  /** Set for a PLUGIN's pane — what binds its door caller into the ctx. */
  pane?: Pane;
};

const word = (name: string): string => name.trim().toLowerCase();


/** A tab a composite asked for that nothing supplies — a labeled
 * refusal wearing a tab's clothes, because a name that resolves to
 * nothing is the author's own typo and must not vanish quietly. */
function missingTab(name: string): Tab {
  const blocks: PanelBlock[] = [
    { block: 'aside', text: `no panel named '${name}' — the seat asked for it and nothing declares it` },
  ];
  return {
    name,
    label: name,
    panel: { name, subject: 'entity', mounted: blocks, held: blocks },
  };
}

export function SeatChrome({
  entityId,
  initialPanel,
  seatName,
  glass,
}: {
  entityId: string;
  /** One ARRANGEMENT to open on, for the console previewing an
   * entity-subject panel through `#panel=`. A real seat passes nothing
   * — it takes no layout (the ruling above) — and a declared composite
   * outranks this wherever it's set. */
  initialPanel?: string;
  seatName?: string;
  glass: Glass;
}) {
  const [panels, setPanels] = useState<PanelDef[] | undefined>(undefined);
  const [screenDecls, setScreenDecls] = useState<ScreenDecl[]>([]);
  const [records, setRecords] = useState<Records>({});
  const [entity, setEntity] = useState<Entity | undefined>(undefined);
  // Remembered per SCREEN, like the console's pane and the display id:
  // a refresh mid-fight must not yank a player back to Sheet, and one
  // slotted tab's pick must not aim another's next load. A remembered
  // name the composite no longer offers falls through `?? tabs[0]`.
  const tabKey = displaySlot() ? `teller.seat.tab.${displaySlot()}` : 'teller.seat.tab';
  const [current, setCurrentState] = useState(
    () => localStorage.getItem(tabKey) ?? 'Sheet',
  );
  const setCurrent = (name: string) => {
    setCurrentState(name);
    try {
      localStorage.setItem(tabKey, name);
    } catch {
      // Storage full or blocked — the tap still works for this visit.
    }
  };
  /** How many standing scales the system declares — 'More' has to know
   * whether the `ladders` block will draw anything before it offers a
   * tab that might turn out to be empty — and `rest` needs their names
   * so a standing doesn't surface twice. */
  const [ladderLists, setLadderLists] = useState<string[]>([]);
  /** The plugins' entity-subject panes that are SHOWING right now —
   * asked on the same nudge as everything else, because `when` is a
   * fact about the moment (`client/lib/panes.ts`). */
  const [panes, setPanes] = useState<Pane[]>([]);
  // Where this seat stands in the fight, and the one thing it may say
  // back into it (`TurnCall.tsx`).
  const call = useTurnCall(entityId);
  // What was passed to THIS screen — never the room's business
  // (`PassedNote.tsx`). Asked on the same nudge as everything else.
  const passed = usePassedNotes();

  // THREE loads, not one, because they answer to three different words.
  //
  // This used to be a single `load()` on every nudge — eleven requests
  // each time, for a screen whose vocabulary cannot change during play.
  // Over a link with six connections to spend (rule 6) that is what a
  // tap on a counter felt like.
  const loadStack = useCallback(() => {
    api<PanelDef[]>('/api/stack/declarations/panels').then(setPanels).catch(() => setPanels([]));
    api<ScreenDecl[]>('/api/stack/declarations/screens').then(setScreenDecls).catch(() => setScreenDecls([]));
    api<unknown[]>('/api/stack/declarations/ladders')
      .then((raw) =>
        setLadderLists(
          raw.map(toLadder).filter((l) => l !== undefined).map(ladderList),
        ),
      )
      .catch(() => setLadderLists([]));
    Promise.all(
      RECORD_SLOTS.map((slot) =>
        api<Record<string, unknown>>(`/api/stack/record/${slot}`).then((r) => [slot, r] as const),
      ),
    )
      .then((pairs) => setRecords(Object.fromEntries(pairs)))
      .catch(() => {});
  }, []);

  /** Which plugin tabs are SHOWING — `when` is a fact about the moment,
   *  so this answers to the plugins' own words as well as to `plugins`. */
  const loadPanes = useCallback(() => {
    fetchPanes()
      .then((all) => showing(all.filter((p) => p.subject === 'entity')))
      .then(setPanes)
      .catch(() => setPanes([]));
  }, []);

  const loadEntity = useCallback(() => {
    api<Entity>(`/api/entities/${entityId}?resolved=1`)
      .then(setEntity)
      .catch(() => setEntity(undefined));
  }, [entityId]);

  useEffect(loadStack, [loadStack]);
  useEffect(loadPanes, [loadPanes]);
  useEffect(loadEntity, [loadEntity]);
  useEffect(() => onNudge(loadStack, DECLARED), [loadStack]);
  useEffect(() => onNudge(loadPanes, [...PROVIDED, PLUGIN_WORD]), [loadPanes]);
  useEffect(() => onNudge(loadEntity, ['entities']), [loadEntity]);

  // Stored, plus whatever a tap is still asking for. Every block on
  // this screen reads the same overlay, so the gauge and the ledger
  // can't disagree about a number mid-flight (`client/lib/entry.ts`).
  const shown = useOptimistic(entity);

  const accent = shown?.type ? ((records.accents?.[shown.type] as string | undefined) ?? undefined) : undefined;

  const ctx: BlockCtx = {
    glass,
    entity: shown,
    records,
    write: (edit) => writeEntry(entityId, edit as EntryEdit),
  };

  // What shape this seat wears, and nobody chose it: the merge's own
  // COMPOSITE if one is declared — it drives the tab set and may name a
  // presentation per chrome seam — and otherwise the floor assembly
  // below, exactly what it always was. `initialPanel` only ever names
  // the arrangement that floor opens on (the console's preview route).
  const layoutPanels = (panels ?? []).filter((p) => p.subject === 'entity');
  const named = initialPanel
    ? layoutPanels.find((p) => word(p.name) === word(initialPanel))
    : undefined;
  const composite = seatComposite(panels ?? []);
  const seams = useSeams(composite?.chrome);

  // The composite's DRAFT takeover (§M-4a's companion): while the
  // subject still wears its draft mark, one named panel gets the whole
  // strip — no tabs, no seams, nothing of teller's around it. The outer
  // glass clip is NOT part of the deal (it is `App.tsx`'s, outside this
  // component entirely), because that law is structural and never
  // yields. The decision itself is `draftTakeover`'s, in core, which is
  // also where the dangling-name refusal is worded.
  const takeover = draftTakeover(composite, panels ?? [], isDraft(shown));
  const draftPanel = takeover && 'panel' in takeover ? takeover.panel : undefined;
  const draftRefusal = takeover && 'refusal' in takeover ? takeover.refusal : undefined;

  // What the Sheet screen itself draws for `resources` — Health + Grit,
  // whatever's pinned-to or dialled a cylinder (fix 6's generic rule,
  // `shaped()`, ported from the 'sheet' block's own selection). Anything
  // else is either claimed by a declared carried-screen (Aces on
  // Abilities, Dollars/Supplies on Inventory) or falls to 'More' —
  // nothing silently drops (the old app's holding-pen promise).
  const resourceEntries = entriesOf(shown, 'resources');
  const claimedBySheet = new Set(
    resourceEntries.filter((en) => shaped(ctx, shown, en)).map((en) => en.name.toLowerCase()),
  );
  const claimedByScreens = screenClaims(screenDecls);
  const allClaimed = new Set([...claimedBySheet, ...claimedByScreens]);
  const spareResources = resourceEntries.filter((en) => !allClaimed.has(en.name.toLowerCase()));
  const strayLists = Object.keys(shown?.lists ?? {}).some(
    (l) =>
      !PLACED.includes(l.toLowerCase()) &&
      !ladderLists.some((n) => n.toLowerCase() === l.toLowerCase()) &&
      entriesOf(shown, l).length > 0,
  );
  // The advancement menu, if the system declares one. The affordance,
  // the overlay and the whole feature exist only because `spends` is in
  // the merged records — a system without it grows no button.
  const spends = toSpends(records.spends);

  const hasSpare =
    spareResources.length > 0 ||
    strayLists ||
    ladderLists.length > 0 ||
    Boolean(spends) ||
    Boolean(shown?.notes) ||
    Boolean(shown?.children?.length);

  // Everything that COULD be a tab, in one namespace, because §M-5a puts
  // the carried screens and the plugins' panes in the same one the
  // declared panels are in — that's what lets a composite order them.
  const screenTabs: Tab[] = screenDecls.map((s) => ({
    name: s.name,
    label: s.name,
    ...(s.icon ? { icon: s.icon } : {}),
    panel: carriedPanel(s, screenDecls),
  }));
  const paneTabs: Tab[] = panes.map((p) => ({
    name: p.name,
    label: p.label ?? p.name,
    ...(p.icon ? { icon: p.icon } : {}),
    panel: paneToPanel(p),
    pane: p,
  }));
  // The holding pen. A system that ships `panels/more/` supplies it —
  // §M-5a's "More stops being code" — and teller synthesizes one only
  // when nobody did, and only when there is something spare to hold.
  // Either way it is ONE tab and it is called More, on both paths.
  const declaredMore = layoutPanels.find((p) => word(p.name) === 'more');
  const moreTabs: Tab[] = declaredMore
    ? [
        {
          name: 'More',
          label: declaredMore.label ?? 'More',
          icon: declaredMore.icon ?? 'more',
          panel: declaredMore,
        },
      ]
    : hasSpare
      ? [
          {
            name: 'More',
            label: 'More',
            icon: 'more',
            panel: morePanel(allClaimed, ladderLists, screenDecls.length > 0),
          },
        ]
      : [];

  let tabs: Tab[];
  if (composite) {
    // The composite drives. Its `tabs` list is the ORDER, and a stray —
    // an entity-subject surface it never named — APPENDS rather than
    // vanishing (the `rest` law, applied to navigation). `omit` is the
    // way out for the author who means it.
    const pool: Tab[] = [
      ...layoutPanels
        .filter(surfaceable)
        .filter((p) => word(p.name) !== word(composite.name) && word(p.name) !== 'more')
        .map((p) => ({
          name: p.name,
          label: p.label ?? p.name,
          ...(p.icon ? { icon: p.icon } : {}),
          panel: p,
        })),
      ...screenTabs,
      ...paneTabs,
      ...moreTabs,
    ];
    const by = new Map(pool.map((t) => [word(t.name), t]));
    const listed = composite.tabs!.map((n) => by.get(word(n)) ?? missingTab(n));
    const claimed = new Set(composite.tabs!.map(word));
    const omitted = new Set((composite.omit ?? []).map(word));
    const strays = pool.filter((t) => !claimed.has(word(t.name)) && !omitted.has(word(t.name)));
    tabs = [...listed, ...strays];
  } else {
    // No composite: the floor, and the floor is exactly what the seat
    // did before any of this — the assigned arrangement as the first
    // tab (always worded 'Sheet', whatever the layout is called), then
    // the carried screens, the panes, and More for the strays.
    const sheetPanel = named ?? layoutPanels.find((p) => word(p.name) === 'sheet');
    tabs = sheetPanel
      ? [
          { name: 'Sheet', label: 'Sheet', icon: 'sheet', panel: sheetPanel },
          ...screenTabs,
          ...paneTabs,
          ...moreTabs,
        ]
      : [];
  }
  const tab = tabs.find((t) => t.name === current) ?? tabs[0];

  const { Header, ScreenBar, TurnCall, NoteBanner, SeatFrame } = seams;
  const mounted = glass === 'mounted';

  if (draftPanel) {
    return (
      <PanelCollection panels={panels}>
        <ConnectionHint />
        <div className={`flex min-h-0 flex-col ${mounted ? 'h-full overflow-hidden' : 'min-h-full'}`}>
          <PanelSurface
            panel={draftPanel}
            ctx={ctx}
            fallback={
              <p className="p-8 text-sm text-stone-500">
                '{draftPanel.label ?? draftPanel.name}' failed to render — the floor has it
              </p>
            }
          />
        </div>
      </PanelCollection>
    );
  }

  return (
    <PanelCollection panels={panels}>
      {/* Outside the frame on purpose: the five seams are the author's
          to theme (§M-5a) and this is not one of them — it is teller
          saying its own wire is down, which a theme must not be able to
          quiet. Fixed-position, so where it sits in the tree costs the
          layout nothing. */}
      <ConnectionHint />
      <SeatFrame glass={glass} accent={accent}>
        <NoteBanner
          note={passed.notes[0]}
          waiting={Math.max(0, passed.notes.length - 1)}
          onDismiss={passed.dismiss}
          glass={glass}
        />

        {/* Identity and the order's call, side by side on mounted glass
            (a fixed 515px has no row to spare) and stacked on held (a
            phone can afford the line). The ring TurnCall draws is
            absolute and costs neither. */}
        <div className={mounted ? 'flex shrink-0 items-center gap-3' : 'flex shrink-0 flex-col gap-1.5'}>
          <div className={mounted ? 'min-w-0 flex-1' : 'contents'}>
            <Header
              entity={shown}
              seatName={seatName}
              records={records}
              glass={glass}
              write={(edit) => void ctx.write?.(edit)}
            />
          </div>
          <TurnCall
            up={call.up}
            onDeck={call.onDeck}
            rolling={call.rolling}
            {...(typeof call.entry?.score === 'number' ? { myScore: call.entry.score } : {})}
            {...(call.entry
              ? {
                  submitScore: (score: number) =>
                    scoreEntry(call.entry!.id, score).then(() => call.reload()),
                }
              : {})}
            glass={glass}
          />
        </div>

        {draftRefusal && (
          <p className="shrink-0 px-2 text-xs text-amber-400/90">{draftRefusal}</p>
        )}

        <div className={`flex min-h-0 flex-1 flex-col ${mounted ? 'overflow-hidden' : ''}`}>
          {tab ? (
            <PanelSurface
              panel={tab.panel}
              ctx={tab.pane ? { ...ctx, plugin: pluginCtx(tab.pane) } : ctx}
              fallback={
                <p className="p-8 text-sm text-stone-500">
                  '{tab.label}' failed to render — the floor has it
                </p>
              }
            />
          ) : (
            <p className="p-8 text-sm text-stone-500">no seat layout declared</p>
          )}
        </div>

        {/* Sticky only where the card scrolls — held glass. Mounted glass
            never scrolls (rule 6), so there is nothing for the bar to
            stick to. */}
        <div className={`z-10 shrink-0 ${mounted ? '' : 'sticky bottom-0'}`}>
          <ScreenBar
            tabs={tabs.map(({ name, label, icon }) => ({ name, label, ...(icon ? { icon } : {}) }))}
            current={tab?.name ?? current}
            onGo={setCurrent}
            glass={glass}
          />
        </div>
      </SeatFrame>
    </PanelCollection>
  );
}
