// THE BOARD — the vertical, player-facing display standing in FRONT of
// the DM: the digital front of the DM screen, companion to the table TV.
//
// Ported from the old app (src/views/BoardView.tsx), whose arrangement
// is the spec: the order at the top with the acting row picked out and
// scaled up, the posse under it, the foes as a row of names carrying
// only what's hanging on them. Passive, no touch, and NO SECRETS — it
// renders the public snapshot and nothing else, so an NPC's numbers
// aren't withheld here, they never arrived.
//
// Held-ish glass, and the old view's behaviour is kept: this one grows
// down the page. It is a tall screen a person stands at, not a
// screwed-down bar, and the party can be four or seven.

import {
  publicSnapshot,
  type PublicEntity,
  type PublicEntry,
  type PublicSnapshot,
} from '../lib/api.ts';
import { DECLARED, PUBLIC, useLive } from '../lib/use-session.ts';
import { useArtMap } from '../lib/art.ts';
import { useWakeLock } from '../lib/use-wake-lock.ts';
import { sectionLabel } from '../lib/ui.ts';
import { ConnectionHint } from '../components/ConnectionHint.tsx';
import { barsOf, chipLabel, chipsOf, kinds, type KindDef } from './passive.ts';

/** A foe's state in a word — where its number stands, never the number. */
const VITALITY_WORDS: Record<string, { word: string; className: string }> = {
  healthy: { word: 'up', className: 'text-stone-500' },
  bloodied: { word: 'bloodied', className: 'text-red-300' },
  critical: { word: 'critical', className: 'text-red-400' },
  down: { word: 'down', className: 'text-stone-600' },
};

function Bar({ entry }: { entry: PublicEntry }) {
  const max = entry.max ?? 0;
  const current = typeof entry.value === 'number' ? entry.value : 0;
  const pct = Math.max(0, Math.min(1, current / max));
  const low = pct <= 0.25;
  return (
    <div className="min-w-28">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-lg text-stone-400">{entry.name}</span>
        <span
          className={`font-mono text-3xl tabular-nums ${low ? 'text-red-400' : 'text-stone-100'}`}
        >
          {current}
          <span className="text-xl text-stone-500">/{max}</span>
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-stone-800">
        <div
          className={`h-full rounded-full transition-all ${low ? 'bg-red-500' : 'bg-amber-600'}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}

function Chips({ entries, tone }: { entries: PublicEntry[]; tone: 'party' | 'foe' }) {
  if (!entries.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map((entry, i) => (
        <span
          key={`${entry.name}-${i}`}
          className={
            tone === 'party'
              ? 'rounded-full bg-amber-950/60 px-3 py-1 text-sm text-amber-200'
              : 'rounded-full bg-red-950/60 px-2.5 py-0.5 text-sm text-red-200'
          }
        >
          {chipLabel(entry)}
        </span>
      ))}
    </div>
  );
}

export function BoardView() {
  useWakeLock();
  const snapshot = useLive<PublicSnapshot>(publicSnapshot, [], { on: PUBLIC });
  const defs = useLive<KindDef[]>(kinds, [], { on: DECLARED });
  // The handout the console is showing, ticketed. The board draws it
  // too, exactly as the old app did (src/views/BoardView.tsx): a table
  // without a dedicated art frame is the ordinary table, and losing the
  // WANTED poster because nobody owns a spare tablet is not a policy.
  const handout = snapshot.data?.handout ?? null;
  const art = useArtMap(handout ? { it: handout.key } : undefined).it;

  if (!snapshot.data) {
    return (
      <main className="p-8 text-stone-500">
        <ConnectionHint />
        opening the books…
      </main>
    );
  }

  const { campaign, roster, turn, notice } = snapshot.data;
  const kd = defs.data ?? [];
  const names = new Map(roster.map((e) => [e.id, e.name]));
  const party = roster.filter((e) => e.side === 'party');
  // Only the foes with something hanging on them: the board's job is
  // what CHANGED, and a clean row of untouched names is noise between
  // the party and the fight.
  const foes = roster.filter(
    (e: PublicEntity) => e.side === 'foe' && chipsOf(e, kd).length > 0,
  );

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-8 p-8">
      <ConnectionHint />
      <header className="text-center">
        <h1 className="font-serif text-4xl text-stone-300">{campaign.name}</h1>
      </header>

      {/* THE ROOM'S OWN LINE. Rendered, never dismissed — this glass
          has no controls and the console takes it down (rule 6). */}
      {notice && (
        <div className="animate-pulse rounded-2xl bg-amber-700 p-6 text-center font-serif text-5xl text-stone-950 shadow-lg shadow-amber-900/50">
          {notice.text}
        </div>
      )}

      {handout && art && (
        <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-5 bg-stone-950/95 p-8 backdrop-blur-sm">
          {/* The notice comes WITH it, the old app's own arrangement:
              an overlay that covered the board used to cover the one
              line the room was told to read. */}
          {notice && (
            <p className="animate-pulse rounded-2xl bg-amber-700 px-8 py-3 text-center font-serif text-4xl text-stone-950">
              {notice.text}
            </p>
          )}
          <img
            src={art}
            alt={handout.name}
            className="max-h-[75vh] max-w-full rounded-xl object-contain shadow-2xl"
          />
          <p className="font-serif text-3xl text-stone-200">{handout.name}</p>
        </div>
      )}

      {turn.order.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className={sectionLabel}>Order</span>
            {turn.turn !== null && (
              <span className="font-mono text-xl text-amber-300">round {turn.round}</span>
            )}
          </div>
          <ol className="space-y-2">
            {turn.order.map((entry, index) => (
              <li
                key={entry.id}
                className={`rounded-xl px-5 py-3 font-serif transition-all ${
                  index === turn.turn
                    ? 'scale-[1.02] bg-amber-700 text-4xl text-stone-950 shadow-lg shadow-amber-900/50'
                    : 'bg-stone-900 text-2xl text-stone-400'
                }`}
              >
                <span className="mr-3 font-mono text-base opacity-60">{index + 1}</span>
                {/* the name is derived through the link at render (§5);
                    a bare label is the ad-hoc row's own */}
                {entry.entityId
                  ? (names.get(entry.entityId) ?? (entry.label || 'missing'))
                  : (entry.label ?? '—')}
              </li>
            ))}
          </ol>
        </section>
      )}

      {party.length > 0 && (
        <section className="space-y-3">
          <span className={sectionLabel}>The posse</span>
          <div className="grid gap-3 sm:grid-cols-2">
            {party.map((entity) => (
              <article
                key={entity.id}
                className="space-y-3 rounded-xl border border-stone-800 bg-stone-900/60 p-4"
              >
                <h2 className="font-serif text-2xl text-stone-100">{entity.name}</h2>
                <div className="space-y-2">
                  {barsOf(entity, kd).map((entry, i) => (
                    <Bar key={`${entry.name}-${i}`} entry={entry} />
                  ))}
                </div>
                <Chips entries={chipsOf(entity, kd)} tone="party" />
              </article>
            ))}
          </div>
        </section>
      )}

      {foes.length > 0 && (
        <section className="space-y-2">
          <span className={sectionLabel}>Foes</span>
          <div className="flex flex-wrap gap-2">
            {foes.map((entity) => {
              const state = entity.vitality
                ? VITALITY_WORDS[entity.vitality]
                : undefined;
              return (
                <span
                  key={entity.id}
                  className="flex items-center gap-2 rounded-lg bg-stone-900 px-3 py-1.5 text-lg text-stone-300"
                >
                  {entity.name}
                  {/* a WORD, never a number — where the count stands is
                      all a passive screen ever learns about a foe */}
                  {state && <span className={`text-sm ${state.className}`}>{state.word}</span>}
                  <Chips entries={chipsOf(entity, kd)} tone="foe" />
                </span>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
