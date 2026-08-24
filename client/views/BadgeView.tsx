// THE BADGE — the outward-facing back panel of a rail unit, one
// person's card turned toward the rest of the table.
//
// Ported from the old app (src/views/BadgeView.tsx): the name big
// enough to read across the table, the bars under it, what's hanging on
// them, and a flare when it's their turn. Passive — nothing here writes
// and nothing here is touched.
//
// It reads the PUBLIC snapshot like every other passive surface, and
// finds itself in the roster by the entity this screen was pointed at
// (the same `params.entityId` a seat uses). A badge on a party member
// shows real numbers, which is right: the posse's sheets are on the
// table anyway. Pointed at a foe it shows what a foe ever shows — a
// word and its statuses — because the redaction happened on the server
// and there is nothing here to leak.

import {
  publicSnapshot,
  type PublicEntry,
  type PublicSnapshot,
} from '../lib/api.ts';
import { DECLARED, PUBLIC, useLive } from '../lib/use-session.ts';
import { useWakeLock } from '../lib/use-wake-lock.ts';
import { ConnectionHint } from '../components/ConnectionHint.tsx';
import { barsOf, chipLabel, chipsOf, kinds, type KindDef } from './passive.ts';

const VITALITY_WORDS: Record<string, string> = {
  healthy: 'up',
  bloodied: 'bloodied',
  critical: 'critical',
  down: 'down',
};

function Bar({ entry }: { entry: PublicEntry }) {
  const max = entry.max ?? 0;
  const current = typeof entry.value === 'number' ? entry.value : 0;
  const pct = Math.max(0, Math.min(1, current / max));
  const low = pct <= 0.25;
  return (
    <div className="min-w-40">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xl text-stone-400">{entry.name}</span>
        <span
          className={`font-mono text-4xl tabular-nums ${low ? 'text-red-400' : 'text-stone-100'}`}
        >
          {current}
          <span className="text-2xl text-stone-500">/{max}</span>
        </span>
      </div>
      <div className="mt-1 h-3 overflow-hidden rounded-full bg-stone-800">
        <div
          className={`h-full rounded-full transition-all ${low ? 'bg-red-500' : 'bg-amber-600'}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}

export function BadgeView({ entityId }: { entityId: string }) {
  useWakeLock();
  const snapshot = useLive<PublicSnapshot>(publicSnapshot, [], { on: PUBLIC });
  const defs = useLive<KindDef[]>(kinds, [], { on: DECLARED });

  if (!snapshot.data) {
    return (
      <main className="p-8 text-stone-600">
        <ConnectionHint />…
      </main>
    );
  }

  const { campaign, roster, turn, notice } = snapshot.data;
  const entity = roster.find((e) => e.id === entityId);
  // Pointed at somebody the campaign no longer has: say so rather than
  // sit blank, and never show the id — it identifies nothing to anyone
  // standing in front of this panel.
  if (!entity) {
    return (
      <main className="flex h-dvh flex-col items-center justify-center gap-2 overflow-hidden">
        <ConnectionHint />
        <p className="font-serif text-4xl text-stone-600">nobody here</p>
        <p className="text-lg text-stone-700">this screen is pointed at a stranger</p>
      </main>
    );
  }

  const kd = defs.data ?? [];
  const current = turn.turn !== null ? turn.order[turn.turn] : null;
  const next =
    turn.turn !== null && turn.order.length > 0
      ? turn.order[(turn.turn + 1) % turn.order.length]
      : null;
  const up = current?.entityId === entity.id;
  const onDeck = !up && next?.entityId === entity.id;
  const bars = barsOf(entity, kd);
  const chips = chipsOf(entity, kd);

  return (
    <main
      className={`flex h-dvh flex-col items-center justify-center gap-6 overflow-hidden p-8 transition-all ${
        up ? 'bg-amber-950/40 ring-8 ring-inset ring-amber-600' : ''
      }`}
    >
      <ConnectionHint />
      {/* The room's line, on the room-facing side of the rail. A NOTE
          never reaches a badge (server/notes.ts) precisely because this
          panel is aimed outward; a notice is aimed outward too, which
          is what makes it the one thing that belongs here. */}
      {notice && (
        <p className="animate-pulse rounded-2xl bg-amber-700 px-8 py-3 text-center font-serif text-4xl text-stone-950 shadow-lg shadow-amber-900/50">
          {notice.text}
        </p>
      )}
      <header className="text-center">
        <h1 className="font-serif text-6xl text-stone-100">{entity.name}</h1>
        {up && (
          <p className="mt-3 animate-pulse rounded-xl bg-amber-600 px-6 py-2 font-serif text-4xl text-stone-950">
            TAKING THEIR TURN
          </p>
        )}
        {onDeck && (
          <p className="mt-3 rounded-xl bg-stone-800 px-6 py-2 text-2xl text-amber-300">
            on deck
          </p>
        )}
      </header>

      {bars.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4">
          {bars.map((entry, i) => (
            <Bar key={`${entry.name}-${i}`} entry={entry} />
          ))}
        </div>
      )}
      {/* no bars means a foe, whose numbers never left the server — the
          word is what this panel gets, and it is enough to read */}
      {bars.length === 0 && entity.vitality && (
        <p className="font-serif text-4xl text-stone-400">
          {VITALITY_WORDS[entity.vitality] ?? entity.vitality}
        </p>
      )}

      {chips.length > 0 && (
        <div className="flex flex-wrap justify-center gap-3">
          {chips.map((entry, i) => (
            <span
              key={`${entry.name}-${i}`}
              className="rounded-full bg-amber-950/80 px-5 py-2 text-2xl text-amber-200"
            >
              {chipLabel(entry)}
            </span>
          ))}
        </div>
      )}

      <footer className="text-lg text-stone-600">{campaign.name}</footer>
    </main>
  );
}
