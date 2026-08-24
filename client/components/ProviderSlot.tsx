// A slot for whatever the table's plugins can be asked (§15).
//
// The contract, and the whole point of the file: a surface names a
// POINT — 'propose.turn' — and never learns who provides it. The server
// says how many providers a point has (`GET /api/points`); no provider
// means the ask renders NOTHING, not a disabled box and not a nag — and
// with nothing of teller's own to hold either, neither does the card.
// An unconfigured host has never heard of any of this.
//
// The box is TELLER's, not the plugin's — and that is now literal: the
// card takes `children`, and what it holds is teller's own furniture
// (the exchange: the intent line, the numbered steps, the resolve row).
// Those render whether or not anybody provides the point; the ASK is
// the only thing that comes and goes with a plugin. Unplug the
// assistant and the button and its freeform line disappear, the header
// says something honest instead, and the fight is untouched.
//
// A plugin returns the point's
// declared shape (`core/registry.ts`) and gets no say in how it's drawn,
// which is what makes two providers of the same point interchangeable
// and what keeps the runner from importing an assistant it must not know
// exists. Everything below fans out to every provider and shows what
// each said, side by side, attributed.
//
// And it PROPOSES, always. Nothing here writes anything anywhere: the
// words land on the Warden's screen, and playing them, editing them or
// ignoring them is the Warden's act (rule 1). The proposal is local
// state on purpose — dismissing one leaves no trace in the session, the
// same call the old app made about its suggestions.

import { useState } from 'react';
import type { NarrationProposal, TurnProposal } from '../../core/registry.ts';
import { api } from '../lib/api.ts';
import { useLive } from '../lib/use-session.ts';

type PointInfo = { point: string; blurb: string; providers: number };

type Answer = { plugin: string; proposal?: unknown; error?: string };

/** Is this point provided by anything running? The only question a tool asks. */
export function useProvided(point: string): boolean {
  const points = useLive(() => api<PointInfo[]>('/api/points'), [], {
    on: ['plugins'],
  });
  return (points.data ?? []).some((p) => p.point === point && p.providers > 0);
}

/**
 * One proposal, drawn to the REGISTRY's declared shapes — never to a
 * plugin's. Which shape is read off the answer, not off the point, so a
 * point that later returns narration alongside a turn renders both.
 */
function ProposalWords({ proposal }: { proposal: unknown }) {
  if (!proposal || typeof proposal !== 'object') {
    return <p className="text-[11px] italic text-stone-600">nothing came back</p>;
  }
  const p = proposal as TurnProposal & NarrationProposal & Record<string, unknown>;
  const premises = Array.isArray(p.premises) ? p.premises : [];
  const known = p.action || p.rationale || p.roll || p.narration || premises.length;
  // A provider that answered in a shape this build doesn't know still
  // gets SHOWN — the words are the product, and refusing to render them
  // because a field is missing would be teller deciding for the table.
  if (!known) {
    return (
      <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-snug text-stone-400">
        {JSON.stringify(proposal, null, 2)}
      </pre>
    );
  }
  return (
    <div className="space-y-1.5">
      {premises.length > 0 && (
        <ul className="space-y-0.5">
          {premises.map((premise, i) => (
            <li key={i} className="text-[11px] italic leading-snug text-stone-500">
              assuming {String(premise)}
            </li>
          ))}
        </ul>
      )}
      {p.action && <p className="text-[15px] leading-snug text-amber-100">{p.action}</p>}
      {p.rationale && (
        <p className="text-[11px] leading-snug text-stone-500">{p.rationale}</p>
      )}
      {p.target && (
        <p className="font-mono text-[11px] text-stone-500">
          aimed at <span className="text-stone-300">{p.target}</span>
        </p>
      )}
      {p.roll && (p.roll.dice || p.roll.for) && (
        <p className="font-mono text-[11px] text-stone-400">
          {p.roll.dice && <span className="text-amber-300">{p.roll.dice}</span>}
          {p.roll.for && <span className="ml-1.5 text-stone-500">{p.roll.for}</span>}
        </p>
      )}
      {/* The FRONT bookend: the attempt, stopping at the instant of
          contact. It is drawn like the narration because it is the same
          kind of thing — words for the table rather than a brief for
          the Warden — and the narration afterwards continues from where
          this one stops. */}
      {p.preface && (
        <blockquote className="mt-2 border-l-2 border-amber-700/60 pl-3">
          <span className="font-mono text-[9px] uppercase tracking-widest text-stone-600">
            read aloud — the attempt
          </span>
          <p className="font-serif text-[17px] leading-relaxed text-amber-50">{p.preface}</p>
        </blockquote>
      )}
      {/* The one part meant to be SPOKEN gets the serif and the rule —
          the old app's bookend, kept, because everything above it is a
          brief for the Warden and this is for the table. */}
      {p.narration && (
        <blockquote className="mt-2 border-l-2 border-amber-600 pl-3">
          <span className="font-mono text-[9px] uppercase tracking-widest text-stone-600">
            read aloud
          </span>
          <p className="font-serif text-[17px] leading-relaxed text-amber-50">{p.narration}</p>
        </blockquote>
      )}
    </div>
  );
}

export function ProviderSlot({
  point,
  label = '✦ teller',
  plain,
  offer = true,
  ask,
  again,
  placeholder,
  payload,
  onProposed,
  onDismiss,
  children,
}: {
  /** A name in `core/registry.ts`. Nothing else is a point. */
  point: string;
  /** What the box calls itself. teller's own word — never a plugin's name. */
  label?: string;
  /**
   * What it calls itself with NOBODY to ask — the honest header for a
   * card that is still teller's furniture and still has a job. Absent
   * and unprovided, the card is only drawn if it was given `children`.
   */
  plain?: string;
  /** Is the point askable HERE at all? A player's turn is nobody's to propose. */
  offer?: boolean;
  /** The affordance: "what would they do?" */
  ask: string;
  /** The same affordance once something has come back. */
  again?: string;
  /** The freeform line — the Warden's own call, handed in as the thing to work around. */
  placeholder?: string;
  /** Whatever this surface knows that the host's snapshot won't carry. */
  payload?: () => Record<string, unknown>;
  /**
   * What came back, handed on so teller's own half of the card can use
   * it — the words already read aloud are the one fact the SERVER
   * cannot assemble, because they only ever existed on this screen.
   * Nothing is written anywhere; it is state on a card either way.
   */
  onProposed?: (proposals: Answer[]) => void;
  /** The ✕. Clearing a proposal is this box's; putting the action back is the caller's. */
  onDismiss?: () => void;
  /**
   * teller's OWN half of the card — the mechanical flow that has
   * nothing to do with any plugin. It renders whether or not the point
   * has a provider, which is the line the whole file turns on: the
   * BOX is teller's, the ASK is the plugin's, and unplugging the
   * assistant takes the button away and leaves the fight alone.
   */
  children?: React.ReactNode;
}) {
  const provided = useProvided(point) && offer;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [answers, setAnswers] = useState<Answer[] | undefined>(undefined);
  const [intent, setIntent] = useState('');

  // No provider and nothing of teller's own to hold: no box. Not
  // disabled, not explained — absent.
  if (!provided && !children) return null;

  const invoke = (said?: string) => {
    setBusy(true);
    setError(undefined);
    api<{ proposals: Answer[] }>(`/api/propose/${point.replace(/^propose\./, '')}`, {
      body: { payload: { ...(payload?.() ?? {}), ...(said ? { intent: said } : {}) } },
    })
      .then((out) => {
        setAnswers(out.proposals);
        onProposed?.(out.proposals);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="rounded-xl border border-amber-800/60 bg-stone-900/70 p-3.5">
      <div className="flex items-center gap-2">
        <span
          className={`font-mono text-[10px] uppercase tracking-widest ${
            provided ? 'text-amber-400' : 'text-stone-500'
          }`}
        >
          {provided ? label : plain}
        </span>
        {provided && (
          <button
            className={`ml-auto rounded-md px-2 py-1 text-[11px] transition-colors ${
              busy
                ? 'animate-pulse text-amber-300'
                : 'text-stone-400 hover:bg-stone-800 hover:text-stone-100'
            }`}
            disabled={busy}
            onClick={() => invoke(intent.trim() || undefined)}
          >
            {busy ? 'thinking…' : answers ? (again ?? `${ask} ↻`) : ask}
          </button>
        )}
        {(answers || onDismiss) && (
          <button
            className="ml-auto rounded-md px-1.5 py-1 text-[11px] text-stone-500 transition-colors hover:text-red-300"
            title="put it back"
            onClick={() => {
              setAnswers(undefined);
              setError(undefined);
              onProposed?.([]);
              onDismiss?.();
            }}
          >
            ✕
          </button>
        )}
      </div>

      {provided && placeholder && (
        <input
          className="mt-2 w-full rounded-md border border-stone-800 bg-stone-950 px-2.5 py-1.5 text-[12px] text-stone-200 placeholder:text-stone-600 focus:border-amber-700 focus:outline-none"
          placeholder={placeholder}
          value={intent}
          disabled={busy}
          onChange={(e) => setIntent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !intent.trim()) return;
            invoke(intent.trim());
          }}
        />
      )}

      {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}

      {answers?.length === 0 && (
        <p className="mt-2 text-[11px] italic text-stone-600">nobody answered</p>
      )}

      {answers?.map((answer) => (
        <div key={answer.plugin} className="mt-2">
          {answers.length > 1 && (
            <span className="font-mono text-[9px] uppercase tracking-widest text-stone-700">
              {answer.plugin}
            </span>
          )}
          {answer.error ? (
            <p className="text-[11px] text-red-300">{answer.error}</p>
          ) : (
            <ProposalWords proposal={answer.proposal} />
          )}
        </div>
      ))}

      {children}
    </div>
  );
}
