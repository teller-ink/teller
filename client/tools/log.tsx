// The 'log' tool — everything that happened, newest first (rule 3:
// "what doesn't exist yet is a *readable* combat log or history for the
// DM (TEL-5) — the data is there, nothing renders it"). No old-app
// equivalent to port; built in the old app's own card/section grammar
// (`sectionLabel`, `card`, gap-4 rhythm, font-mono numbers) so it reads
// like it always belonged there — a table of rows, actor + kind + a
// terse line, timestamp trailing in mono. `GET /api/events` already
// returns everything a DM needs; this is a floor over it, not a story.

import { useState } from 'react';
import { api } from '../lib/api.ts';
import { useLive } from '../lib/use-session.ts';
import { btnGhost, card, input, sectionLabel } from '../lib/ui.ts';
import { Refusal } from '../panels/render.tsx';
import { registerTool } from './index.ts';

type EventRow = {
  id: number;
  entityId: string | null;
  actor: string;
  kind: string;
  payload: unknown;
  createdAt: string;
  /** Who did it, worded by the host — `server/undo.ts`'s `logWords`. */
  who?: string;
  /** What it was, in the undo button's own words; absent for the kinds worded below. */
  what?: string;
};

type RosterEntry = { id: string; name: string; type: string | null };

type EntitySnapshot = { name?: string; lists?: Record<string, { name: string; value?: unknown }[]> };

/** The first entry whose value actually moved, between two snapshots of
 * the same entity — `entity.updated`'s payload carries the whole
 * before/after, and most edits touch exactly one entry (rule 1: a
 * stored value changed, so say which one). */
function firstChange(before?: EntitySnapshot, after?: EntitySnapshot): string | undefined {
  if (!before?.lists || !after?.lists) return undefined;
  for (const [list, afterEntries] of Object.entries(after.lists)) {
    const beforeEntries = before.lists[list] ?? [];
    for (const entry of afterEntries) {
      const was = beforeEntries.find((b) => b.name === entry.name);
      if (!was) return `${entry.name} added`;
      if (was.value !== entry.value) return `${entry.name} ${String(was.value)} → ${String(entry.value)}`;
    }
    for (const was of beforeEntries) {
      if (!afterEntries.some((a) => a.name === was.name)) return `${was.name} removed`;
    }
  }
  return undefined;
}

/** One victim of an exchange, as `turn.resolved` files them (core/exchange.ts). */
type TargetLine = {
  target: string;
  targetName?: string;
  hits?: number;
  blocked?: number;
  damage?: number;
  vital?: { name?: string; from?: number; to?: number };
  statuses?: { name: string; severity: number }[];
};

/** What one blast did to one of them, named — 'Trapped 4 on Bark Watcher 1'. */
function onEach(t: TargetLine): string {
  const bits: string[] = [];
  if ((t.hits ?? 0) > 0 || (t.damage ?? 0) > 0) {
    bits.push(`${t.hits ?? 0} − ${t.blocked ?? 0} = ${t.damage ?? 0}`);
  }
  for (const s of t.statuses ?? []) bits.push(`${s.name} ${s.severity}`);
  const moved = t.vital?.name ? ` (${t.vital.name} ${t.vital.from} → ${t.vital.to})` : '';
  return `${bits.length ? bits.join(', ') : 'nothing'} on ${t.targetName ?? t.target}${moved}`;
}

/**
 * What one kind of row DID, in a word — for the rows whose payload
 * carries no entry to name (a delete, a move, a turn shuffle) and for
 * the row an undo files. The undo BUTTON's sentence is worded by the
 * server (`server/undo.ts`), so it can name things rather than kinds.
 */
const VERB: Record<string, string> = {
  'entity.created': 'created',
  'entity.updated': 'edited',
  'entity.deleted': 'deleted',
  'entity.moved': 'moved',
  'template.updated': 'a template edit',
  'template.deleted': 'a template removal',
  'turn.updated': 'the turn order',
};

/**
 * Kind → a human, mono-friendly summary of what happened (core/store.ts's
 * `append` calls). The host words most rows itself now, with the same
 * describers the undo button reads from, so a row and the button say the
 * same thing in the same words; what's below is for the kinds whose own
 * payload already reads as a sentence, and for an older host.
 */
function describe(e: EventRow, names: Map<string, string>): string {
  if (e.what) return e.what;
  const who = e.entityId ? (names.get(e.entityId) ?? e.entityId) : null;
  const p = (e.payload ?? {}) as Record<string, unknown>;
  switch (e.kind) {
    case 'entity.created':
      return `${(p.after as EntitySnapshot | undefined)?.name ?? who ?? 'something'} was created`;
    case 'entity.updated': {
      const diff = firstChange(p.before as EntitySnapshot, p.after as EntitySnapshot);
      return `${who ?? (p.after as EntitySnapshot | undefined)?.name ?? 'an entity'}${diff ? ` — ${diff}` : ' was edited'}`;
    }
    case 'entity.deleted':
      return `${(p.before as EntitySnapshot | undefined)?.name ?? who ?? 'an entity'} was deleted`;
    case 'entity.moved':
      return `${who ?? 'an entity'} moved to ${String(p.to ?? '?')}`;
    case 'template.updated':
      return `template — ${String(p.slot ?? '?')}`;
    case 'template.deleted':
      return `template removed`;
    case 'board.updated':
      return `board updated`;
    case 'board.cleared':
      return `board cleared`;
    // The reveal history: what the table has been shown, and what was
    // slid across it to whom. These rows exist so those two questions
    // read as lines here rather than as a diff of the manifest's refs.
    // The note's WORDS go in whole — this list is the DM's own, so a
    // secret is no more exposed here than on the screen they typed it
    // on — and its recipients are counted, never listed by id.
    case 'handout.shown':
      return `showed the table — ${String(p.name ?? p.id ?? 'a handout')}`;
    case 'handout.cleared':
      return `the frame was cleared`;
    case 'note.passed': {
      const to = (p.to as string[] | undefined) ?? [];
      const who = to.length === 0 ? 'the table' : `${to.length} at the table`;
      const said = [p.text, p.handoutName].filter((s) => typeof s === 'string' && s).join(' · ');
      return `passed a note to ${who}${said ? ` — ${said}` : ''}`;
    }
    // The two the runner files. A roll and an exchange are the only
    // events that describe themselves rather than a row's before/after,
    // which is what makes a fight replayable from this list.
    case 'dice.rolled':
      return `${String(p.byName ?? who ?? 'someone')} rolled ${String(p.pool ?? '')}${
        Array.isArray(p.faces) && p.faces.length ? ` — ${p.faces.join(', ')}` : ''
      } = ${String(p.total ?? 0)}${p.unit ? ` ${String(p.unit)}` : ''}${
        p.for ? ` (${String(p.for)})` : ''
      }`;
    case 'turn.resolved': {
      const vital = p.vital as { name?: string; from?: number; to?: number } | undefined;
      const hung = (p.statuses as { name: string; severity: number }[] | undefined) ?? [];
      const spent = (p.spend as { counter: string; amount: number; on?: string }[] | undefined) ?? [];
      // An AOE action lands several times off one throw, so a row can
      // carry a LIST of victims. A row from before that — and every
      // single-target row since — carries the one flat, and reads
      // exactly as it always did.
      const caught = (p.targets as TargetLine[] | undefined) ?? [];
      const parts = [
        `${String(p.byName ?? who ?? 'someone')} — ${String(p.action ?? 'a turn')}`,
        ...(caught.length > 1
          ? caught.map(onEach)
          : [
              ...(p.targetName
                ? [`${String(p.hits ?? 0)} − ${String(p.blocked ?? 0)} = ${String(p.damage ?? 0)} on ${String(p.targetName)}`]
                : []),
              ...(vital?.name ? [`${vital.name} ${String(vital.from)} → ${String(vital.to)}`] : []),
              ...(hung.length ? [hung.map((s) => `${s.name} ${s.severity}`).join(', ')] : []),
            ]),
        ...spent.filter((s) => s.amount > 0).map((s) => `${s.amount} ${s.counter} on ${s.on ?? 'it'}`),
      ];
      return parts.join(' · ');
    }
    case 'turn.updated':
      return p.op ? `turn: ${String(p.op)}` : 'turn order changed';
    // An undo is a mutation like any other (rule 1) and files its own
    // row — naming what it stepped back, so the list reads as a history
    // rather than as a thing that mysteriously happened twice.
    case 'revert':
      return `put back — ${VERB[String(p.kind ?? '')] ?? String(p.kind ?? 'an edit')}`;
    case 'panel.copied':
      return `panel ${String(p.name ?? '?')} copied from ${String(p.from ?? '?')} to this table`;
    case 'campaign.created':
      return `campaign created — ${String(p.name ?? '?')}`;
    default:
      return who ? `${who} — ${e.kind}` : e.kind;
  }
}

function when(createdAt: string): string {
  const ms = Date.parse(createdAt.replace(' ', 'T') + (createdAt.endsWith('Z') ? '' : 'Z'));
  if (!Number.isFinite(ms)) return createdAt;
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ms).toLocaleString();
}

/** What `/api/undo/peek` answers with — server/undo.ts's `Undoable`. */
type Undoable = {
  event: number;
  kind: string;
  /** Who did it, by name — the server words it, so no screen shows an id. */
  who: string;
  /** What it was, by name — 'Beau Tillman — Health 9 → 10'. */
  what: string;
  /** Roughly when — 'just now', '4 min ago'. */
  ago: string;
  /** Newer changes the press walks PAST, because nothing can step them back. */
  skipped?: { count: number; what: string[] };
  /** Anything else the press does that nobody would guess. */
  also?: string[];
};

/** The undo button when it's reaching past something — `btnGhost`'s
 * shape, with a border and a colour of its own. */
const undoWary =
  'rounded-md border border-amber-500/70 bg-amber-950/40 px-2 py-1 text-sm text-amber-300 transition-colors hover:bg-amber-900/50 hover:text-amber-200 disabled:opacity-40';

/**
 * Step the table back one mutation, from the screen that shows what
 * there is to step back. The peek says what WOULD go before anything
 * does — an undo you can't read before pressing is one you have to
 * press to find out about — and nothing to undo is a plain disabled
 * button, not an error: a fresh campaign has nothing behind it.
 *
 * When the latest change is one undo CAN'T take (a fog stroke, a token
 * move, a notice), the press reaches past it to something older, and
 * that is exactly where a Warden gets surprised. So then it takes TWO
 * presses: the first only arms it, and the button says what it reaches
 * past. Saying so loudly was the other choice and it loses mid-fight —
 * the hand that misclicked the fog is on its way to undo before the
 * eyes read any warning. A second press costs a second; a silent revert
 * of some older edit costs whatever that edit was. Nothing is refused
 * (rule 1): the second press always goes. And the press names the step
 * it showed, so a seat's write landing in between gets a re-read rather
 * than an undo nobody read.
 */
function UndoButton({ onUndone }: { onUndone: () => void }) {
  const { data, reload } = useLive(
    () => api<{ undoable: Undoable | null; nothing?: string }>('/api/undo/peek'),
    [],
  );
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  // Armed for ONE step, by its event: if the table moves under the
  // button, the arming doesn't carry over to a different thing.
  const [armed, setArmed] = useState<number | null>(null);
  const undoable = data?.undoable ?? null;
  const surprising = !!undoable && !!(undoable.skipped || undoable.also?.length);
  const ready = !surprising || armed === undoable?.event;

  const step = async () => {
    if (!undoable) return;
    if (!ready) {
      setArmed(undoable.event);
      window.setTimeout(() => setArmed(null), 6_000);
      return;
    }
    setBusy(true);
    setArmed(null);
    try {
      const res = await api<{ undone: Undoable | null; stale?: boolean; nothing?: string }>('/api/undo', {
        method: 'POST',
        body: { expect: undoable.event },
      });
      setSaid(
        res.stale
          ? 'the table changed — read it again'
          : res.undone
            ? `put back: ${res.undone.what}`
            : (res.nothing ?? 'nothing left to undo'),
      );
      window.setTimeout(() => setSaid(''), 6_000);
      reload();
      onUndone();
    } catch (e) {
      setSaid(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const past = undoable?.skipped;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {past && (
        <span className="text-[11px] text-amber-400">
          latest can&apos;t be undone — this reaches past {past.count} newer change
          {past.count === 1 ? '' : 's'}: {past.what.join(' · ')}
        </span>
      )}
      {undoable?.also?.map((line) => (
        <span key={line} className="text-[11px] text-amber-400">
          {line}
        </span>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button
          // Its own whole string when it's about to surprise, not amber
          // utilities stacked on `btnGhost`: that string already says a
          // colour and has no border, so the stack lost both arguments
          // and the button that needed to look different looked the same.
          className={surprising ? undoWary : btnGhost}
          disabled={busy || !undoable}
          title={undoable ? 'step the table back one mutation' : (data?.nothing ?? 'nothing behind this table yet')}
          onClick={step}
        >
          {/* Nothing to undo says WHY — a floor ("since this campaign
              was restored") or the window's edge is not an empty past. */}
          {!undoable
            ? (data?.nothing ?? 'nothing to undo')
            : surprising && ready
              ? `press again — undo: ${undoable.what}`
              : `undo: ${undoable.what}`}
        </button>
        {undoable && (
          <span className="text-[11px] text-stone-500">
            {undoable.who} · {undoable.ago}
          </span>
        )}
        {said && <span className="text-[11px] text-stone-500">{said}</span>}
      </div>
    </div>
  );
}

function LogTool() {
  const [entityId, setEntityId] = useState('');
  const events = useLive(
    () =>
      api<EventRow[]>(
        `/api/events?limit=200${entityId ? `&entity=${encodeURIComponent(entityId)}` : ''}`,
      ),
    // No interest declared, on purpose: EVERY mutation writes an event
    // (rule 3), so there is no shorter honest list than "anything".
    [entityId],
  );
  const roster = useLive(() => api<RosterEntry[]>('/api/entities'), [], { on: ['entities'] });
  const names = new Map((roster.data ?? []).map((e) => [e.id, e.name]));

  const rows = events.data ?? [];

  return (
    <div className="space-y-3">
      <div className={`${card} flex flex-wrap items-center gap-2`}>
        <span className={sectionLabel}>Log</span>
        <UndoButton onUndone={events.reload} />
        <select
          className={`${input} ml-auto`}
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
          aria-label="filter by entity"
        >
          <option value="">everyone</option>
          {(roster.data ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>

      {events.error && (
        <p className="text-sm text-red-400">{events.error.message}</p>
      )}

      {rows.length === 0 && !events.error && (
        <Refusal>nothing has happened yet</Refusal>
      )}

      {rows.length > 0 && (
        <ol className={`${card} divide-y divide-stone-800/70 p-0`}>
          {rows.map((e) => (
            <li key={e.id} className="flex items-baseline gap-3 px-3 py-2 text-sm">
              {/* A revert reads as a glyph rather than a word: it is the
                  one kind that is ABOUT another row, and the arrow says
                  that faster than 'revert' does. */}
              <span className="w-16 shrink-0 truncate font-mono text-[10px] uppercase tracking-wider text-stone-600">
                {e.kind === 'revert' ? '↩ undo' : e.kind.split('.')[0]}
              </span>
              <span className="min-w-0 flex-1 truncate text-stone-300">
                {describe(e, names)}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-stone-600">
                {e.who ?? e.actor}
              </span>
              <span className="w-20 shrink-0 text-right font-mono text-[11px] text-stone-600">
                {when(e.createdAt)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

registerTool('log', () => <LogTool />);
