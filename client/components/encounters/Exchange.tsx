// THE EXCHANGE — the four earned steps the old app's ✦ card ran, ported
// against structured data (src/components/TurnStage.tsx, steps 1–3, and
// the arithmetic its `/resolve` route did on the other end).
//
// It has no card of its own: it is drawn INSIDE the ✦ card at the foot
// of the stage (`ProviderSlot`, as its children), which is where the old
// app's flow lived too. The card and every step in it are teller's own
// furniture and render with no plugin installed anywhere; the one row
// that isn't is `ReadItOut`, which asks `propose.narrate` and is absent
// when nothing provides it.
//
// Roll · target · defense · resolve. Each step appears only once the one
// above it has something to hand down, and NOTHING in it applies itself:
// the resolve row does the arithmetic the system's own numbers ask for
// and then waits to be told (rule 1). Every number in it is a stepper
// before it is a fact.
//
// What changed from the old one, and only this: the old app read all of
// it out of prose with a regex — the pool, the cost, the inflicted
// status, the target's defense — and this reads it off entries, because
// attacks are child entities now (§I). The flow is the same flow. The
// two chips the old app invented in CODE (light/heavy cover, and dodge
// at one die per point spent) are gone rather than reproduced: those are
// one system's rules living in a component, and what replaces them is
// the honest thing the old app also offered — a number the Warden types,
// because the table just rolled it in front of them.
//
// AOE is the one thing that widens step ②, and the gate is DATA: an
// action whose printed profile carries the marker (`isAoe`) catches
// everyone the Warden taps, and everything else stays exactly one deep.
// One throw, then a separate argument with each of them — their own
// defense, their own tolerance, their own severities, their own line in
// the ledger — and the cost paid ONCE, because the action was taken
// once. Nothing about that is a second flow: the single-target exchange
// is this one with one name in the list.
//
// The writes go through the ordinary entry door, one at a time, in the
// plan's own order — the same posture as `client/lib/spend.ts`, and for
// the same reason. Not atomic, and better for saying so: a half-applied
// exchange leaves ordinary values a stepper can fix.

import { useRef, useState, type ComponentType } from 'react';
import { findEntry, numberOf, type Entity, type Entry } from '../../../core/entity.ts';
import { FRENZY, SPENT, effectiveList } from '../../../core/frenzy.ts';
import {
  afterDamage,
  coversOf,
  damageFrom,
  defensesOf,
  locate,
  proposeSeverity,
  toleranceFor,
  vitalIn,
  type ExchangeRecord,
  type RollRecord,
  type TargetOutcome,
} from '../../../core/exchange.ts';
import type { NarrationProposal } from '../../../core/registry.ts';
import { api, fightGeometry, type BoardFacts } from '../../lib/api.ts';
import { useLive } from '../../lib/use-session.ts';
import {
  combinePools,
  countFace,
  isPool,
  rollPool,
  tallyFaces,
  type DiceRecord,
} from '../../lib/dice.ts';
import { btn, btnPrimary } from '../../lib/ui.ts';
import { DiceFloor, type DicePoolProps } from '../DiceFloor.tsx';
import { presentationOf, useSystemFaces } from '../../lib/presentations.ts';
import { useProvided } from '../ProviderSlot.tsx';
import { StatusChip } from './TemplateSheet.tsx';
import { RangeToTarget } from './Range.tsx';

/**
 * The dice grid, SUMMONED rather than imported (§L phase 3.5).
 *
 * teller used to ship the pool face itself and this file reached for it
 * directly, which meant the WiW runner drew teller's dice even though
 * the system carried its own. `DicePool` is the system's — the `dice`
 * record is system data and the face that draws it is vocabulary — so
 * it arrives by name off the active system, and `DiceFloor` is what
 * happens when nobody supplies one: the same recording instrument with
 * no game in it. Every call site below is unchanged, which is the
 * point — the seam is one component wide.
 */
function DicePool(props: DicePoolProps) {
  useSystemFaces(); // re-render when the system module lands (url-loaded, async)
  const Face = presentationOf<ComponentType<DicePoolProps>>('DicePool');
  return Face ? <Face {...props} /> : <DiceFloor {...props} />;
}

/** One touched entry — everything a surface may say about a list. */
export type EntryWrite = {
  list: string;
  name: string;
  value?: number | string;
  remove?: boolean;
};

/** The system's own declared statuses — a host with none renders no row. */
export type StatusDecl = {
  name: string;
  relief?: string;
  effect?: string;
  /** Exempt from the declared ceiling, where the system says so. */
  uncapped?: boolean;
};

/**
 * The action somebody armed — an attack child, or a frenzy that got its
 * gate crossed. Assembled by the stage off the printed profile, so this
 * file never learns which list a cost lives in.
 */
export type Armed = {
  id: string;
  name: string;
  /** A frenzy pays in prose, and is treated differently below. */
  frenzy?: boolean;
  /**
   * A ONE-SHOT frenzy — the book's Event kind. Resolving it spends it,
   * which is the only write here that isn't damage, a status or a price:
   * a thing that happens once has to record that it happened, or the
   * next turn proposes it again.
   */
  event?: boolean;
  /** The reach it's printed under, when the printing gives one. */
  band?: string;
  /**
   * It catches everyone in the band, not one of them (`isAoe`). The
   * ONLY thing that opens the target step to more than one pick — the
   * gate is the printed profile, never a switch the Warden flips.
   */
  aoe?: boolean;
  /** The pool the damage rolls, when the printing gives one. */
  damage?: string;
  /** What the printed line costs, when it's a number and not a sentence. */
  cost?: number;
  inflicts: Entry[];
  /** The printed line in words — handed to whatever the table has plugged in. */
  note?: string;
};

export type Combatant = { id: string; label: string };

/**
 * One target's half of the exchange, kept per target.
 *
 * An AOE action rolls ONCE and then argues with each of them separately
 * — their own defense, their own tolerance dice, their own severities,
 * their own transition once it lands. The single-target flow is this
 * record with exactly one key in it, which is why there is no second
 * code path below.
 */
type TargetState = {
  defenses: string[];
  /**
   * What they took from the SITUATION rather than the sheet — whatever
   * the system's `defenses` record offers, chosen per target and per
   * exchange. Never stored on anybody: cover is a choice made under one
   * attack, and a creature that keeps it becomes a creature defending
   * twice as well against the next one.
   */
  covers: string[];
  defFaces?: (string | null)[];
  /** What the table rolled with its own hands, typed in. */
  typed: string;
  /** A severity somebody typed over — `null` means dropped. */
  sevSet?: Record<string, number | null>;
  /** The transition that landed, recorded at the press. */
  landed?: { name: string; from: number; to: number };
};

const BLANK: TargetState = { defenses: [], covers: [], typed: '' };

/**
 * The list a printed sheet keeps its resistances in. Named here because
 * the shared statblock already names it (`TemplateSheet.tsx` draws the
 * same list as chips) — one word, one meaning, in both places.
 */
const TOLERANCES = 'tolerances';

/** One list off a sheet, by the system's word for it, however it's cased. */
function listOf(entity: Entity | undefined, list: string): Entry[] {
  const key = Object.keys(entity?.lists ?? {}).find((k) => k.toLowerCase() === list.toLowerCase());
  return key ? entity!.lists[key] : [];
}

/**
 * The same, as a RUNNING frenzy leaves it.
 *
 * A creature mid-frenzy tolerates what the frenzy says it tolerates, and
 * the arithmetic here is the one place that would otherwise quietly use
 * the printed number instead — the stage would show one figure and the
 * proposal would use another, which is the exact split `core/exchange.ts`
 * exists to have ended.
 */
function readingOf(entity: Entity | undefined, list: string): Entry[] {
  const key = Object.keys(entity?.lists ?? {}).find((k) => k.toLowerCase() === list.toLowerCase());
  return effectiveList(entity, key ?? list);
}

/** Every list of a sheet, read the same way — what a defense is looked up in. */
function readingLists(entity: Entity | undefined): Record<string, Entry[]> {
  return Object.fromEntries(
    Object.keys(entity?.lists ?? {}).map((key) => [key, effectiveList(entity, key)]),
  );
}

/**
 * The INTENT LINE — what was armed, spelled out as a sentence of parts:
 * "Bark Slash — Melee, 3 Grit, 2G damage".
 *
 * It's the card's first row because it is the answer to "what am I
 * looking at": everything under it is the arithmetic of THIS line, and
 * a card whose steps start before it says what's being attempted is a
 * card you have to look back up at the chips to read. Composed off the
 * armed action's own profile — a frenzy composes off its own the same
 * way, because by the time it's armed it is just an action with numbers.
 */
function IntentLine({ armed, costCounter }: { armed: Armed; costCounter?: string }) {
  const parts: string[] = [];
  if (armed.band) parts.push(armed.band);
  if (armed.cost !== undefined) parts.push(`${armed.cost} ${costCounter ?? 'cost'}`);
  if (armed.damage) parts.push(`${armed.damage} damage`);
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="font-mono text-[12px] text-amber-200">{armed.name}</span>
      {parts.length > 0 && (
        <span className="font-mono text-[11px] text-stone-400">— {parts.join(', ')}</span>
      )}
      {armed.inflicts.map((s) => (
        <StatusChip key={s.name} entry={s} />
      ))}
      {/* One line of it. A frenzy's note is a whole paragraph, and it is
          already printed in full up on the stage — here it only has to
          say WHICH thing is armed. */}
      {armed.note && armed.note !== armed.band && (
        <span
          className="min-w-0 flex-1 truncate font-mono text-[10px] text-stone-600"
          title={armed.note}
        >
          {armed.note}
        </span>
      )}
    </div>
  );
}

const stepPip = (n: number, label: string) => (
  <div className="flex items-center gap-2">
    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-700 font-mono text-[9px] text-stone-950">
      {n}
    </span>
    <span className="text-[11px] text-stone-400">{label}</span>
  </div>
);

/**
 * ③ — anything teller couldn't know, then the words.
 *
 * The one row in the exchange that is NOT teller's own: pressing it
 * asks whatever provides `propose.narrate` for sentences to read out,
 * so with nothing plugged in there is no row — the same absence rule
 * the ask in the header follows. What it sends is the outcome teller
 * already worked out plus whatever the Warden adds; what comes back is
 * words on a screen and nothing else (rule 1).
 */
function ReadItOut({
  summary,
  action,
  spoken,
}: {
  summary: () => string;
  /** What was actually run — the armed thing's own name. */
  action: string;
  /** The words already read aloud, when a proposal offered any. */
  spoken?: string;
}) {
  const provided = useProvided('propose.narrate');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [words, setWords] = useState<string[] | undefined>(undefined);
  if (!provided) return null;

  const line = () => [summary(), said.trim()].filter(Boolean).join('. ');

  const tell = () => {
    setBusy(true);
    setError(undefined);
    api<{ proposals: { proposal?: unknown; error?: string }[] }>('/api/propose/narrate', {
      // The outcome is teller's arithmetic; the other two are the
      // front bookend and what was actually run. Everything else — who
      // is in armour, what ground they stand in, what happened three
      // rounds ago — the host assembles, because it holds it.
      body: {
        payload: {
          outcome: line(),
          action,
          ...(spoken ? { preface: spoken } : {}),
        },
      },
    })
      .then((out) =>
        setWords(
          out.proposals
            .map((p) => (p.proposal as NarrationProposal | undefined)?.narration)
            .filter((n): n is string => Boolean(n)),
        ),
      )
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="mt-3 border-t border-stone-800 pt-2.5">
      {stepPip(3, 'anything else, then read it out')}
      <div className="mt-2 flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-md border border-stone-800 bg-stone-950 px-2.5 py-1.5 text-[12px] text-stone-200 placeholder:text-stone-600 focus:border-amber-700 focus:outline-none"
          placeholder="knocked prone, dragged into the shallows…"
          value={said}
          disabled={busy}
          onChange={(e) => setSaid(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && tell()}
        />
        <button
          className={`${btnPrimary} shrink-0 text-xs ${busy ? 'animate-pulse' : ''}`}
          disabled={busy}
          onClick={tell}
        >
          tell it ⟶
        </button>
      </div>
      <p className="mt-1.5 font-mono text-[10px] leading-snug text-stone-600">{line()}</p>
      {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}
      {/* The back bookend, in the serif the front one got: the part
          meant to be SPOKEN looks like the part meant to be spoken. */}
      {words?.map((narration, i) => (
        <blockquote key={i} className="mt-3 border-l-2 border-amber-600 pl-3">
          <span className="font-mono text-[9px] uppercase tracking-widest text-stone-600">
            read aloud — what happened
          </span>
          <p className="font-serif text-[17px] leading-relaxed text-amber-50">{narration}</p>
        </blockquote>
      ))}
    </div>
  );
}

function Stepper({
  label,
  value,
  unit,
  onSet,
}: {
  label: string;
  value: number;
  unit?: string;
  onSet: (n: number) => void;
}) {
  return (
    <span className="flex items-center gap-1 font-mono text-[11px] text-stone-400">
      <span className="text-stone-600">{label}</span>
      <button
        className="rounded px-1 text-sm text-stone-500 hover:bg-stone-800 hover:text-stone-100"
        aria-label={`${label} less`}
        onClick={() => onSet(Math.max(0, value - 1))}
      >
        −
      </button>
      <span className={value > 0 ? 'text-amber-200' : 'text-stone-600'}>{value}</span>
      <button
        className="rounded px-1 text-sm text-stone-500 hover:bg-stone-800 hover:text-stone-100"
        aria-label={`${label} more`}
        onClick={() => onSet(value + 1)}
      >
        +
      </button>
      {unit && <span className="text-stone-600">{unit}</span>}
    </span>
  );
}

export function Exchange({
  actor,
  armed,
  order,
  sheetOf,
  dice,
  icons,
  pins,
  defenses,
  statuses,
  conditionsList,
  conditionCap,
  costCounter,
  round,
  spoken,
  onWrite,
}: {
  /** The acting entity, resolved. */
  actor: Entity;
  armed: Armed;
  /** Everyone else in the order, in order. */
  order: Combatant[];
  sheetOf: (id: string) => Entity | undefined;
  dice: DiceRecord | undefined;
  icons?: Record<string, string>;
  /** The system's `pins` record — which entries stand beside which counter. */
  pins?: Record<string, string[]>;
  /**
   * The system's `defenses` record — what anybody may bring to an attack
   * that isn't on their sheet, by the system's own names and pools. A
   * host whose system declares none renders no chips and loses nothing.
   */
  defenses?: Record<string, unknown>;
  statuses: StatusDecl[];
  /** Which list a hung condition is written to — the system's word. */
  conditionsList: string;
  /** The declared ceiling for that list. Presented, never enforced. */
  conditionCap?: number;
  /** The counter an action's cost comes out of — the `use` record's word. */
  costCounter?: string;
  round: number;
  /** The preface a proposal offered, if one did — the narration continues from it. */
  spoken?: string;
  onWrite: (entityId: string, edit: EntryWrite) => Promise<unknown>;
}) {
  /** Everyone picked, in the order they were picked. One deep, unless it's AOE. */
  const [targetIds, setTargetIds] = useState<string[]>([]);
  /** Each of them keeps their OWN defense, dice and severities. */
  const [states, setStates] = useState<Record<string, TargetState>>({});
  const [faces, setFaces] = useState<(string | null)[] | undefined>(undefined);
  const [tolFaces, setTolFaces] = useState<Record<string, (string | null)[]>>({});
  const [spend, setSpend] = useState<number | undefined>(undefined);
  const [moved, setMoved] = useState(0);
  /** A banked counter the Warden overruled, by name. Absent = as counted. */
  const [banks, setBanks] = useState<Record<string, number>>({});
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  /** Pools already filed as rolls, so applying doesn't file them twice. */
  const filed = useRef(new Set<string>());

  const foe = actor.type === 'foe';
  /** The printed profile decides this, never the Warden and never this file. */
  const aoe = armed.aoe === true;

  /**
   * THE GROUND, measured from whoever is acting.
   *
   * The old app worked the gap out in the browser at draw time, in
   * pixels, which is why nothing but the map ever knew a distance. The
   * server measures it now (`server/geometry.ts`) and this asks the
   * same door the proposer bridge reads — one arithmetic, so what the
   * Warden sees on the card and what a plugin was told are the same
   * number by construction.
   *
   * Refetched when the tokens move or the fight turns; a failure is
   * just an absent measurement, and an absent measurement says "not on
   * the board" rather than pretending everyone is adjacent.
   */
  const geometry = useLive<BoardFacts>(() => fightGeometry(actor.id), [actor.id], {
    on: ['board', 'boards', 'turn', 'entities'],
  });
  const gapTo = (
    id: string,
  ): { inches: number; band?: { name: string; world?: string } } | undefined => {
    const facts = geometry.data;
    if (!facts?.present) return undefined;
    const token = facts.tokens.find((t) => t.entityId === id);
    if (!token || token.awayInches === undefined) return undefined;
    return {
      inches: token.awayInches,
      ...(token.awayBand ? { band: token.awayBand } : {}),
    };
  };
  const targets = targetIds
    .map((id) => sheetOf(id))
    .filter((t): t is Entity => t !== undefined);

  const stateOf = (id: string): TargetState => states[id] ?? BLANK;
  const patch = (id: string, next: Partial<TargetState>) =>
    setStates((prior) => ({ ...prior, [id]: { ...(prior[id] ?? BLANK), ...next } }));

  /** Anything changed after a press means the press no longer describes it. */
  const touched = () => {
    setApplied(false);
    setStates((prior) =>
      Object.fromEntries(Object.entries(prior).map(([id, s]) => [id, { ...s, landed: undefined }])),
    );
  };

  /**
   * Pick somebody, or take them back off. An AOE action ADDS — everyone
   * in the band is caught by the same throw; anything else REPLACES,
   * which is the single-target flow exactly as it always was.
   */
  const toggleTarget = (id: string) => {
    const on = targetIds.includes(id);
    setTargetIds(on ? targetIds.filter((x) => x !== id) : aoe ? [...targetIds, id] : [id]);
    // A pick starts clean — its own dice, its own severities. A
    // single-target swap clears the one it replaced for the same reason.
    setStates((prior) => {
      const next = aoe ? { ...prior } : {};
      delete next[id];
      return next;
    });
    setApplied(false);
  };

  const file = async (record: RollRecord, key: string) => {
    filed.current.add(key);
    await api('/api/rolls', { body: record }).catch(() => undefined);
  };

  const throwPool = async (
    pool: string,
    key: string,
    forWhat: string,
    onFaces: (rolled: (string | null)[]) => void,
    on?: Entity,
  ) => {
    if (!dice) return;
    const rolled = rollPool(pool, dice);
    const { total } = tallyFaces(rolled, dice);
    const who = on ?? actor;
    onFaces(rolled);
    await file(
      {
        by: who.id,
        byName: who.name,
        pool,
        faces: rolled.filter((f): f is string => Boolean(f)),
        total,
        ...(dice.unit ? { unit: dice.unit } : {}),
        for: forWhat,
        round,
      },
      key,
    );
  };

  const putTolFaces = (key: string) => (rolled: (string | null)[]) =>
    setTolFaces((prior) => ({ ...prior, [key]: rolled }));

  /** ONE throw, however many it caught — the action was taken once. */
  const hits = tallyFaces(faces ?? [], dice).total;
  const rolled = (faces ?? []).some(Boolean) || !armed.damage;

  /**
   * WHAT THE ROLL BANKED (§J). A `banks` entry wires a face to a counter
   * — "this face showed, so that counter goes up" — and it names both
   * halves, which is what keeps this file ignorant: teller counts a face
   * it cannot identify into a counter it cannot name.
   *
   * Three things decide whether a line appears, and each is a rule:
   *
   *  * **Counted off the FACES, never off the total.** `hits` is a sum
   *    through `values` and a sum cannot be un-summed — a bank pays on
   *    how many times the face SHOWED, so it is counted where the faces
   *    still are (the chips the table just tapped). Retype a die and the
   *    proposal follows, because it is derived, not stored.
   *  * **Foes don't bank.** The runner already skips this for them and
   *    the reason is the table's, not the code's: a foe has nobody to
   *    hand the beat to. One condition, stated once, in the one place
   *    that offers the line.
   *  * **A destination has to exist.** §M-8 says an absent counter reads
   *    as zero, so a sheet that has never banked one still deserves the
   *    proposal — but a write needs a LIST, and inventing a list name
   *    here would be teller filing somebody's sheet for them (rule 2).
   *    So: the counter's own list where it is already kept, otherwise
   *    wherever this sheet keeps the counter actions are paid out of —
   *    read off the sheet either way, never a literal.
   */
  const bankLines = (foe ? [] : (dice?.banks ?? []))
    .map(({ face, counter }) => {
      const at = locate(actor.lists, counter);
      const list = at?.list ?? (costCounter ? locate(actor.lists, costCounter)?.list : undefined);
      return {
        counter,
        list,
        held: at ? (numberOf(at.entry) ?? 0) : 0,
        amount: banks[counter] ?? countFace(faces ?? [], face),
      };
    })
    .filter((b) => b.list !== undefined);

  const typedOn = (id: string): number | undefined => {
    const raw = stateOf(id).typed.trim();
    if (raw === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : undefined;
  };
  const blockedOn = (id: string): number =>
    typedOn(id) ?? tallyFaces(stateOf(id).defFaces ?? [], dice).total;
  const damageOn = (id: string): number => damageFrom(hits, blockedOn(id));

  /** A frenzied target defends with what the frenzy leaves it. */
  const offeredOn = (t: Entity) =>
    defensesOf(readingLists(t), pins, vitalIn(t.lists)?.entry);

  /**
   * What the system says anyone may take cover behind. Read once, off
   * the record — the words and the pools are the system's, and this file
   * carries neither.
   */
  const covers = coversOf(defenses).filter((c) => typeof c.value === 'string' && isPool(c.value));

  /** Every pool this target is rolling: what they have, plus what they took. */
  const defPoolOn = (t: Entity) => {
    const s = stateOf(t.id);
    return combinePools([
      ...offeredOn(t)
        .filter((o) => s.defenses.includes(o.name) && typeof o.value === 'string' && isPool(o.value))
        .map((o) => String(o.value)),
      ...covers.filter((c) => s.covers.includes(c.name)).map((c) => String(c.value)),
    ]);
  };

  /**
   * What one inflicted status proposes right now, ON ONE TARGET —
   * arithmetic and words. The severity pool the ACTION printed is rolled
   * once and shared; what each of them tolerates is their own, so the
   * tolerance dice are keyed by who threw them.
   */
  const severityOf = (t: Entity, inflict: Entry) => {
    const sevSet = stateOf(t.id).sevSet ?? {};
    if (inflict.name in sevSet) {
      const set = sevSet[inflict.name];
      return { value: set, note: undefined as string | undefined };
    }
    const printed =
      typeof inflict.value === 'number'
        ? inflict.value
        : typeof inflict.value === 'string' && isPool(inflict.value)
          ? tallyFaces(tolFaces[`printed:${inflict.name}`] ?? [], dice).total
          : 0;
    const tol = toleranceFor(readingOf(t, TOLERANCES), inflict.name);
    const relief =
      tol?.flat !== undefined
        ? tol.flat
        : tol?.pool
          ? tallyFaces(tolFaces[`tolerance:${t.id}:${inflict.name}`] ?? [], dice).total
          : 0;
    const held = numberOf(findEntry(listOf(t, conditionsList), inflict.name));
    const decl = statuses.find((s) => s.name.toLowerCase() === inflict.name.trim().toLowerCase());
    const out = proposeSeverity({
      printed,
      relief,
      ...(tol?.worsens ? { worsens: true } : {}),
      ...(held !== undefined ? { held } : {}),
      ...(conditionCap !== undefined ? { cap: conditionCap } : {}),
      ...(decl?.uncapped ? { uncapped: true } : {}),
    });
    return { value: out.value, note: out.note };
  };

  const setSeverity = (id: string, name: string, value: number | null) =>
    patch(id, { sevSet: { ...(stateOf(id).sevSet ?? {}), [name]: value } });

  /**
   * Land it. One press writes the damage, every status that still has a
   * severity, and what the turn spent — which is the only automation
   * here, and it happens after a human has read the arithmetic and
   * chosen to press.
   *
   * TARGET BY TARGET, in the order they were picked, through the same
   * entry door as everything else: each victim's writes append their own
   * events, so `/undo` steps back one victim at a time rather than
   * unpicking a blast in one lump (rule 3). Not atomic, and better for
   * saying so — a half-applied blast leaves ordinary values a stepper
   * can fix.
   */
  const apply = async () => {
    setBusy(true);
    setError(undefined);
    try {
      // Anything hand-tapped and never thrown by teller still belongs in
      // the log — a die the Warden read off the table is the same fact.
      if (armed.damage && (faces ?? []).some(Boolean) && !filed.current.has('attack')) {
        await file(
          {
            by: actor.id,
            byName: actor.name,
            pool: armed.damage,
            faces: (faces ?? []).filter((f): f is string => Boolean(f)),
            total: hits,
            ...(dice?.unit ? { unit: dice.unit } : {}),
            for: `${armed.name} damage`,
            round,
          },
          'attack',
        );
      }

      const outcomes: TargetOutcome[] = [];

      for (const target of targets) {
        const targetVital = vitalIn(target.lists);
        const damage = damageOn(target.id);
        const hung: { name: string; severity: number }[] = [];
        let vitalMove: TargetOutcome['vital'];

        if (targetVital && damage > 0) {
          const to = afterDamage(targetVital.entry, damage);
          vitalMove = {
            name: targetVital.entry.name,
            from: numberOf(targetVital.entry) ?? 0,
            to,
          };
          await onWrite(target.id, {
            list: targetVital.list,
            name: targetVital.entry.name,
            value: to,
          });
        }

        for (const inflict of armed.inflicts) {
          const { value } = severityOf(target, inflict);
          if (value === null || value <= 0) continue;
          await onWrite(target.id, {
            list: conditionsList,
            name: inflict.name,
            value,
          });
          hung.push({ name: inflict.name, severity: value });
        }

        outcomes.push({
          target: target.id,
          targetName: target.name,
          hits,
          blocked: blockedOn(target.id),
          damage,
          ...(vitalMove ? { vital: vitalMove } : {}),
          statuses: hung,
        });
        if (vitalMove) patch(target.id, { landed: vitalMove });
      }

      const lines: ExchangeRecord['spend'] = [];
      if (costCounter) {
        const paid = spend ?? armed.cost ?? 0;
        // A line worth zero is kept when it says what it bought — that a
        // frenzy or a feature cost nothing is a fact the log should hold.
        if (paid > 0 || !armed.frenzy) lines.push({ counter: costCounter, amount: paid, on: armed.name });
        if (moved > 0) lines.push({ counter: costCounter, amount: moved, on: 'moving' });
        // Two lines out of the same counter come off it once.
        const owed = lines.reduce((sum, l) => sum + l.amount, 0);
        const purse = locate(actor.lists, costCounter);
        if (owed > 0 && purse) {
          await onWrite(actor.id, {
            list: purse.list,
            name: purse.entry.name,
            value: Math.max(0, (numberOf(purse.entry) ?? 0) - owed),
          });
        }
      }

      // What the dice banked, paid the same way the cost is: one
      // ordinary entry write, through the same door, so it lands in the
      // log (rule 3) and comes straight back off with a stepper on the
      // sheet (rule 1). It does NOT ride in the record's `spend` lines —
      // those are read everywhere as "N off this counter for that", and
      // a gain filed as a spend is a mechanic hiding in a sign.
      for (const bank of bankLines) {
        if (bank.amount <= 0) continue;
        await onWrite(actor.id, {
          list: bank.list!,
          name: bank.counter,
          value: bank.held + bank.amount,
        });
      }

      // A one-shot has now happened, so it says so — through the same
      // entry door as everything else, which is what makes it an
      // ordinary value the Warden can take straight back off (rule 1)
      // and what puts it in the log (rule 3).
      if (armed.event) {
        await onWrite(actor.id, { list: FRENZY, name: armed.name, value: SPENT });
      }

      // One record, however many it caught: the head is the first of
      // them, kept flat for every reader that only ever knew one.
      const head = outcomes[0];
      await api('/api/exchange', {
        body: {
          by: actor.id,
          byName: actor.name,
          ...(head ? { target: head.target, ...(head.targetName ? { targetName: head.targetName } : {}) } : {}),
          action: armed.name,
          hits: head?.hits ?? 0,
          blocked: head?.blocked ?? 0,
          damage: head?.damage ?? 0,
          ...(head?.vital ? { vital: head.vital } : {}),
          statuses: head?.statuses ?? [],
          targets: outcomes,
          spend: lines,
          round,
        } satisfies ExchangeRecord,
      });
      // What actually happened, kept — so the row goes on saying it
      // rather than re-deriving off a counter that is now the AFTER
      // (the old app's `appliedFrom`, and its lesson).
      setApplied(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * One person's line of the ledger — the same arithmetic the single
   * target always showed, said once per victim. It names them only when
   * there is more than one to tell apart.
   */
  const ledgerLine = (target: Entity) => {
    const targetVital = vitalIn(target.lists);
    const { landed } = stateOf(target.id);
    const damage = damageOn(target.id);
    return (
      <span key={target.id} className="block font-mono text-[11px] text-stone-400">
        {targets.length > 1 && <span className="mr-1.5 text-stone-500">{target.name}</span>}
        {hits} − {blockedOn(target.id)} ={' '}
        <span className="text-base text-amber-200">{damage}</span>{' '}
        {targetVital ? targetVital.entry.name.toLowerCase() : 'damage'}
        {(landed ?? targetVital) && (
          <span className="ml-1.5 text-stone-600">
            {landed
              ? `${landed.from} → ${landed.to}`
              : `${numberOf(targetVital!.entry) ?? 0} → ${afterDamage(targetVital!.entry, damage)}`}
          </span>
        )}
      </span>
    );
  };

  /** What teller worked out, in one sentence somebody could read out. */
  const summary = (): string => {
    const parts: string[] = [];
    const shown = (faces ?? []).filter(Boolean).join(', ');
    if (armed.damage) {
      parts.push(
        `${armed.name} — ${actor.name} rolled ${armed.damage}: ${shown || 'not yet rolled'} = ${hits} ${dice?.unit ?? ''}`.trim(),
      );
    } else {
      parts.push(`${actor.name} — ${armed.name}`);
    }
    for (const target of targets) {
      const { defenses: brought, covers: behind, landed } = stateOf(target.id);
      const blocked = blockedOn(target.id);
      const how = [...brought, ...behind].join(' + ');
      parts.push(
        how
          ? `${target.name} defended with ${how}: ${blocked}`
          : blocked > 0
            ? `${target.name} stopped ${blocked}`
            : `${target.name} had no defense`,
      );
      parts.push(
        `${target.name} takes ${damageOn(target.id)}${
          landed ? ` (${landed.name} ${landed.from} → ${landed.to})` : ''
        }`,
      );
      const hung = armed.inflicts
        .map((inflict) => {
          const { value } = severityOf(target, inflict);
          return value === null || value <= 0 ? null : `${inflict.name} ${value}`;
        })
        .filter(Boolean);
      if (hung.length) parts.push(`and is left ${hung.join(', ')}`);
    }
    for (const bank of bankLines) {
      if (bank.amount > 0) parts.push(`${actor.name} banks ${bank.amount} ${bank.counter}`);
    }
    return parts.join('. ');
  };

  return (
    <div className="mt-3 border-t border-stone-800 pt-2.5">
      <IntentLine armed={armed} costCounter={costCounter} />

      {/* 1 — the dice the action calls for */}
      {armed.damage && dice && (
        <div className="mt-3 border-t border-stone-800 pt-2.5">
          {stepPip(1, `roll ${armed.damage} — ${armed.name}`)}
          <div className="mt-2">
            <DicePool
              pool={armed.damage}
              faces={faces}
              onFaces={setFaces}
              dice={dice}
              icons={icons}
              // teller throws for foes and nobody else. A player's attack
              // is theirs to throw; this records what the plastic said.
              onRoll={
                foe
                  ? () => throwPool(armed.damage!, 'attack', `${armed.name} damage`, setFaces)
                  : undefined
              }
            />
          </div>
        </div>
      )}

      {/* 2 — who it lands on, and what they had to stop it */}
      {rolled && (
        <div className="mt-3 border-t border-stone-800 pt-2.5">
          {/* An AOE action says so in the step's own words — the picker
              below behaves differently and a label that didn't change
              would be the only warning. */}
          {stepPip(2, aoe ? 'everyone it catches, and what stops each' : 'who it lands on, and what stops it')}
          <div className="mt-2 flex flex-wrap gap-1">
            {order
              .filter((e) => e.id !== actor.id)
              .map((e) => {
                const on = targetIds.includes(e.id);
                // How far off they are, before you pick them — the
                // measurement belongs to CHOOSING a target at least as
                // much as to having chosen one, and a tooltip is where
                // it fits without turning the row into a table.
                const gap = gapTo(e.id);
                const how = gap
                  ? `${gap.band ? `${gap.band.name} — ` : ''}${Math.round(gap.inches * 10) / 10} in away`
                  : 'not on the board';
                return (
                  <button
                    key={e.id}
                    className={`rounded-md px-2 py-0.5 text-[11px] transition-colors ${
                      on
                        ? 'bg-amber-800 text-amber-50'
                        : 'bg-stone-800 text-stone-400 hover:bg-stone-700'
                    }`}
                    title={on ? `${how} · tap to take them back out` : how}
                    onClick={() => {
                      toggleTarget(e.id);
                      touched();
                    }}
                  >
                    {e.label}
                    {aoe && on && <span className="ml-1 text-amber-200/70">✕</span>}
                  </button>
                );
              })}
          </div>

          {targets.map((target) => {
            const s = stateOf(target.id);
            const targetFoe = target.type === 'foe';
            const offered = offeredOn(target);
            const defPool = defPoolOn(target);
            const typedNumber = typedOn(target.id);
            return (
              <div
                key={target.id}
                className={`mt-2.5 space-y-2${aoe ? ' border-t border-stone-800/70 pt-2' : ''}`}
              >
                {/* Whose row this is, and the way back out of it. Only
                    when more than one CAN be caught — a single-target
                    exchange already names its target on the button. */}
                {aoe && (
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-amber-200">{target.name}</span>
                    <button
                      className="rounded px-1 font-mono text-[10px] text-stone-600 transition-colors hover:text-red-300"
                      title={`don't catch ${target.name}`}
                      onClick={() => {
                        toggleTarget(target.id);
                        touched();
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )}

                {/* How far off they actually are, beside what the armed
                    thing says it reaches — the ruling the Warden makes
                    at a glance, and never one teller makes for them. */}
                <RangeToTarget
                  name={target.name}
                  {...(gapTo(target.id) ? { measured: gapTo(target.id) } : {})}
                  {...(armed.band ? { declared: armed.band } : {})}
                />

                <div className="flex flex-wrap items-center gap-1">
                  {offered.map((o) => {
                    const on = s.defenses.includes(o.name);
                    const pool = typeof o.value === 'string' && isPool(o.value);
                    return (
                      <button
                        key={o.name}
                        className={`rounded-full px-2 py-0.5 font-mono text-[10px] transition-colors ${
                          on ? 'bg-sky-900 text-sky-100' : 'bg-stone-800 text-stone-500 hover:bg-stone-700'
                        } ${pool ? '' : 'opacity-50'}`}
                        title={pool ? 'roll this alongside anything else it brought' : 'nothing printed — type what the table rolled'}
                        disabled={!pool}
                        onClick={() => {
                          patch(target.id, {
                            defenses: on
                              ? s.defenses.filter((d) => d !== o.name)
                              : [...s.defenses, o.name],
                            defFaces: undefined,
                          });
                          touched();
                        }}
                      >
                        {o.name} {o.value !== undefined ? String(o.value) : '—'}
                      </button>
                    );
                  })}
                  {/* What they took from the SITUATION — the system's own
                      offer, per target, because being attacked is what
                      calls for it and each of them was somewhere else
                      when it landed. Nothing about it is stored: the
                      next attack asks again. */}
                  {covers.map((c) => {
                    const on = s.covers.includes(c.name);
                    return (
                      <button
                        key={c.name}
                        className={`rounded-full px-2 py-0.5 font-mono text-[10px] transition-colors ${
                          on
                            ? 'bg-emerald-900 text-emerald-100'
                            : 'bg-stone-800 text-stone-500 hover:bg-stone-700'
                        }`}
                        title={`roll this alongside anything else ${target.name} brought`}
                        onClick={() => {
                          patch(target.id, {
                            covers: on ? s.covers.filter((x) => x !== c.name) : [...s.covers, c.name],
                            defFaces: undefined,
                          });
                          touched();
                        }}
                      >
                        {c.name} {String(c.value)}
                      </button>
                    );
                  })}
                  {/* The table's own hands. A player rolls their own
                      defense at the table and reads the number out; every
                      surface here is a recording instrument first. */}
                  <span className="flex items-center gap-1 font-mono text-[10px] text-stone-500">
                    or they rolled
                    <input
                      className="w-12 rounded bg-stone-800 px-1 py-0.5 text-center font-mono text-[11px] text-stone-100 focus:outline-none"
                      inputMode="numeric"
                      placeholder="—"
                      aria-label={`what ${target.name} rolled`}
                      value={s.typed}
                      onChange={(e) => {
                        patch(target.id, { typed: e.target.value });
                        touched();
                      }}
                    />
                  </span>
                </div>

                {defPool && dice && typedNumber === undefined && (
                  <DicePool
                    pool={defPool}
                    faces={s.defFaces}
                    onFaces={(f) => patch(target.id, { defFaces: f })}
                    dice={dice}
                    icons={icons}
                    size="sm"
                    // Same line as everywhere: teller throws for foes only.
                    onRoll={
                      targetFoe
                        ? () =>
                            throwPool(
                              defPool,
                              `defense:${target.id}`,
                              `${target.name} defense`,
                              (f) => patch(target.id, { defFaces: f }),
                              target,
                            )
                        : undefined
                    }
                  />
                )}

                {/* 3 — what it hangs on them, against what they tolerate */}
                {armed.inflicts.length > 0 && (
                  <div className="space-y-1.5 border-t border-stone-800/70 pt-2">
                    {/* Part of step 2, not a step of its own: what a hit
                        hangs on somebody is decided against the same
                        defense, in the same breath. */}
                    <span className="text-[10px] uppercase tracking-widest text-stone-600">
                      what it hangs on them
                    </span>
                    {armed.inflicts.map((inflict) => {
                      const printedPool =
                        typeof inflict.value === 'string' && isPool(inflict.value)
                          ? inflict.value
                          : undefined;
                      const tol = toleranceFor(readingOf(target, TOLERANCES), inflict.name);
                      const { value, note } = severityOf(target, inflict);
                      // What the ACTION printed is thrown once and shared;
                      // what THEY tolerate is theirs, and keyed to them.
                      const tolKey = `tolerance:${target.id}:${inflict.name}`;
                      return (
                        <div key={inflict.name} className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] text-stone-400">
                            {inflict.name}
                            {inflict.value !== undefined && ` [${inflict.value}]`}
                          </span>
                          {printedPool && dice && (
                            <DicePool
                              pool={printedPool}
                              faces={tolFaces[`printed:${inflict.name}`]}
                              onFaces={putTolFaces(`printed:${inflict.name}`)}
                              dice={dice}
                              icons={icons}
                              size="sm"
                              onRoll={() =>
                                throwPool(
                                  printedPool,
                                  `printed:${inflict.name}`,
                                  `${inflict.name} severity`,
                                  putTolFaces(`printed:${inflict.name}`),
                                )
                              }
                            />
                          )}
                          {tol?.pool && dice && (
                            <>
                              <span
                                className="font-mono text-[10px] text-sky-300"
                                title={
                                  tol.worsens
                                    ? 'a negative tolerance — it makes this worse'
                                    : 'what they tolerate of this'
                                }
                              >
                                tolerates {tol.worsens ? '−' : ''}
                                {tol.pool}
                              </span>
                              <DicePool
                                pool={tol.pool}
                                faces={tolFaces[tolKey]}
                                onFaces={putTolFaces(tolKey)}
                                dice={dice}
                                icons={icons}
                                size="sm"
                                onRoll={() =>
                                  throwPool(
                                    tol.pool!,
                                    tolKey,
                                    `${target.name} tolerance — ${inflict.name}`,
                                    putTolFaces(tolKey),
                                    target,
                                  )
                                }
                              />
                            </>
                          )}
                          {tol?.flat !== undefined && (
                            <span className="font-mono text-[10px] text-sky-300">
                              tolerates {tol.worsens ? '+' : '−'}
                              {tol.flat}
                            </span>
                          )}
                          {/* Nudge it, or drop it entirely. A blocked hit
                              that still hangs a status is teller ruling on
                              the table's behalf. */}
                          <span className="flex items-center gap-0.5">
                            <button
                              className="rounded px-1 text-xs text-stone-500 hover:bg-stone-800 hover:text-stone-200"
                              aria-label={`${inflict.name} severity down`}
                              onClick={() =>
                                setSeverity(target.id, inflict.name, Math.max(0, (value ?? 0) - 1))
                              }
                            >
                              −
                            </button>
                            <button
                              className="rounded px-1 text-xs text-stone-500 hover:bg-stone-800 hover:text-stone-200"
                              aria-label={`${inflict.name} severity up`}
                              onClick={() => setSeverity(target.id, inflict.name, (value ?? 0) + 1)}
                            >
                              +
                            </button>
                            <button
                              className={`ml-1 rounded px-1.5 font-mono text-[10px] transition-colors ${
                                value === null
                                  ? 'bg-stone-800 text-stone-600'
                                  : 'text-stone-500 hover:text-red-300'
                              }`}
                              title={value === null ? 'put it back' : "don't hang this one"}
                              onClick={() =>
                                setSeverity(
                                  target.id,
                                  inflict.name,
                                  value === null
                                    ? typeof inflict.value === 'number'
                                      ? inflict.value
                                      : 1
                                    : null,
                                )
                              }
                            >
                              {value === null ? 'dropped' : '✕'}
                            </button>
                          </span>
                          {value !== null && (
                            <span className="font-mono text-[11px] text-sky-300">
                              → {inflict.name} {value}
                            </span>
                          )}
                          {note && value !== null && (
                            <span className="font-mono text-[10px] text-stone-600">{note}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* The ledger — outside the target block on purpose. A turn
              aimed at nobody still costs its actor and still belongs in
              the log; gating this row on a target is what once left
              hiding, repositioning and readying unrecorded. */}
          <div className="mt-2.5 rounded-lg bg-stone-950/60 px-3 py-2">
            {/* One LINE per person it landed on. They stack above the
                cost row rather than beside it, because a blast's ledger
                is a list of victims and the price is paid once. */}
            {targets.length > 1 && (
              <div className="mb-1.5 space-y-1">{targets.map(ledgerLine)}</div>
            )}
            <div className="flex flex-wrap items-center gap-3">
            {targets.length === 1 ? (
              ledgerLine(targets[0])
            ) : targets.length === 0 ? (
              <span className="font-mono text-[11px] text-stone-500">nobody is hit</span>
            ) : null}

            {costCounter && (
              <>
                <Stepper
                  label="action"
                  value={spend ?? armed.cost ?? 0}
                  unit={costCounter}
                  onSet={(n) => {
                    setSpend(n);
                    touched();
                  }}
                />
                <Stepper
                  label="moving"
                  value={moved}
                  unit={costCounter}
                  onSet={(n) => {
                    setMoved(n);
                    touched();
                  }}
                />
              </>
            )}

            {/* What the dice banked, beside what the action cost —
                proposed, and a stepper before it is a fact like every
                other number in this row. Nudged to zero it simply isn't
                paid, which is the delete. */}
            {bankLines.map((bank) => (
              <Stepper
                key={bank.counter}
                label="banked"
                value={bank.amount}
                unit={bank.counter}
                onSet={(n) => {
                  setBanks((prior) => ({ ...prior, [bank.counter]: n }));
                  touched();
                }}
              />
            ))}

            <button
              className={`ml-auto ${applied ? btn : btnPrimary} text-xs ${busy ? 'animate-pulse' : ''}`}
              disabled={busy}
              onClick={apply}
            >
              {applied
                ? 'recorded ✓'
                : targets.length > 1
                  ? `apply to all ${targets.length}`
                  : targets.length === 1
                    ? `apply to ${targets[0].name}`
                    : 'record this turn'}
            </button>
            </div>
          </div>

          {/* A frenzy prints its price in a sentence, and teller does not
              read sentences (§I). The stepper above starts at nothing and
              the counter is right there on the stage — say so once rather
              than guessing a number nobody printed. */}
          {armed.frenzy && armed.cost === undefined && costCounter && (
            <p className="mt-1.5 px-1 text-[10px] italic text-stone-600">
              what a frenzy costs is written in its own words — set {costCounter} above, or on the
              bars.
            </p>
          )}

          {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}

          {/* 3 — anything teller couldn't know, then the words. Absent
              unless something provides them. */}
          <ReadItOut summary={summary} action={armed.name} spoken={spoken} />
        </div>
      )}
    </div>
  );
}
