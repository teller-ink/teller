// The assistant — teller's first plugin, and deliberately NOT a
// builtin: teller ships with zero plugins, and this folder is an
// EXAMPLE you install by copying it to `<data>/plugins/assistant/` and
// enabling it yourself (`node server/index.ts --enable <id>`). No
// config, no button — never a nag.
//
// Config (set with `--configure <id> --config '<json>'`), two modes:
//
//   API — { "key": "sk-…", "model": "claude-sonnet-5", "url": "…", "style": "…" }
//     `key` required; `url` defaults to the Anthropic Messages API.
//     Pay-per-token.
//
//   CLI — { "use": "cli", "model": "sonnet", "command": "claude", "style": "…" }
//     Shells out to the Claude Code CLI in headless mode (`claude -p`),
//     which rides the machine owner's existing Claude subscription —
//     no metered key at all. Requires the CLI installed and logged in
//     (`npm i -g @anthropic-ai/claude-code`, then run `claude` once
//     and /login). Tools are disabled for the call; it's a pure
//     text-in, JSON-out question.
//
// Neither configured — every call quietly proposes nothing.
//
// WHAT IT ASKS FOR, and why it grew (v2): `read:entities` and
// `read:board`. The first version declared no needs at all, so
// `propose.turn` handed it the round, the order and one sheet — and it
// answered real questions with "the snapshot gives no map, no positions
// and no ranges" about a fight teller had coordinates and a calibrated
// board for. Everything below is FORMATTING those facts; the measuring
// is the host's (`server/geometry.ts`), because a reader asked to derive
// a distance will eventually derive it wrong. Changing what a plugin
// asks for means agreeing to it again — the enable gate is consent to a
// list, not to a folder.
//
// Nothing here knows any game's words: lists, children and painted
// ground render under whatever the records call them.
//
// Both provides are PROPOSERS (registry contract): a snapshot in,
// words out, and playing any of it is the DM's act. `premises` is the
// honesty mechanism — every assumption the suggestion leans on gets
// surfaced for the DM to check at a glance, because the snapshot is
// only as fresh as the last thing somebody typed.

import { execFile } from 'node:child_process';

const DEFAULT_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-5';

/** One entry, as a line: `Health: 5/10`, `Band: Melee`, or a bare held thing. */
function entryLine(e) {
  if (e.value === undefined && e.max === undefined) return e.name;
  if (e.max === undefined) return `${e.name}: ${e.value}`;
  return `${e.name}: ${e.value ?? 0}/${e.max}`;
}

/**
 * One entity's sheet, formatted — formatting is salience.
 *
 * CHILDREN ARE THE POINT of this version. Anything richer than a name,
 * a value and a ceiling is a child entity, which is where a statblock
 * keeps the things it can actually DO — each with its own little lists
 * of numbers. Flattening those away is how a proposer ends up saying
 * "the sheet lists no attack, no damage and no reach" about a sheet
 * that lists four. Rendered generically: whatever the records call
 * their lists is what the headings say.
 */
function sheet(entity, depth = 0) {
  if (!entity) return '(nobody is acting)';
  const h = '#'.repeat(depth + 1);
  const lines = [`${h} ${entity.name}${entity.type ? ` (${entity.type})` : ''}`];
  for (const [list, entries] of Object.entries(entity.lists ?? {})) {
    if (!entries?.length) continue;
    lines.push(`${h}# ${list}`);
    for (const e of entries) lines.push(`- ${entryLine(e)}`);
  }
  if (entity.notes) lines.push(`${h}# notes`, entity.notes);
  for (const child of entity.children ?? []) lines.push('', sheet(child, depth + 1));
  return lines.join('\n');
}

/** A combatant's line in the order — measured facts, every one labelled. */
function combatantLine(e) {
  const bits = [];
  if (typeof e.score === 'number') bits.push(`rolled ${e.score}`);
  for (const v of e.vitals ?? []) bits.push(`${v.name} ${v.value}/${v.max}`);
  if (e.held?.length) bits.push(`holding ${e.held.join(', ')}`);
  if (e.awayInches !== undefined) {
    bits.push(
      e.awaySquares === undefined
        ? `${e.awayInches}" away`
        : `${e.awayInches}" away (${e.awaySquares} squares)`,
    );
  } else if (e.onBoard === false) bits.push('no token on the board');
  return `${e.acting ? '>> ' : '   '}${e.name}${bits.length ? ` — ${bits.join(' · ')}` : ''}`;
}

/**
 * The ground, as a table — positions, measured ranges, painted zones.
 *
 * The host measured all of it (`server/geometry.ts`); this only lays it
 * out. An absent board is REPORTED in the host's own words rather than
 * skipped, because a proposer told nothing invents something.
 */
function ground(board) {
  if (!board) return ['(this assistant was not granted the board)'];
  if (!board.present) return [`No ground: ${board.why}.`];
  const lines = [
    `Board: ${board.board.name}` +
      (board.board.widthInches
        ? ` — ${board.board.widthInches}" × ${board.board.heightInches}" as printed`
        : ''),
    board.units + '.',
  ];
  if (board.grid) lines.push(`Grid: ${board.grid.cols} squares across, ${Math.round(board.grid.rows)} down.`);
  else if (board.gridless) lines.push(`Grid: none — ${board.gridless}.`);
  lines.push(
    board.measuredFrom
      ? `Distances are measured from ${board.measuredFrom}.`
      : `Nothing was measured: ${board.unmeasured}.`,
  );
  lines.push('', 'name | cell | away | standing in | seen by the table');
  for (const t of board.tokens) {
    lines.push(
      [
        t.name + (t.acting ? ' (acting)' : ''),
        t.cell ? `${t.cell[0]},${t.cell[1]}` : '—',
        t.awayInches === undefined
          ? t.acting
            ? '—'
            : 'not measured'
          : `${t.awayInches}"` + (t.awaySquares === undefined ? '' : ` / ${t.awaySquares} sq`),
        [...(t.inZones ?? []), ...(t.nearZones ?? []).map((z) => `near ${z}`)].join(', ') || '—',
        t.hidden ? 'hidden' : 'visible',
      ].join(' | '),
    );
  }
  lines.push('');
  lines.push(
    board.zones.length
      ? 'Painted ground:'
      : 'Painted ground: none — nothing is painted on this board.',
  );
  for (const z of board.zones) {
    lines.push(
      `- ${z.name}: ${z.cells} squares${z.hidden ? ' (hidden from the table)' : ''}` +
        (z.standingIn.length ? ` — standing in it: ${z.standingIn.join(', ')}` : ' — nobody in it'),
    );
  }
  return lines;
}

/** Bare JSON out of whatever the model wrapped it in. */
function parseProposal(text) {
  const raw = String(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  return JSON.parse(raw);
}

/** The subscription road: `claude -p`, no key, no meter. */
function askCli(config, system, user) {
  return new Promise((resolvePromise, reject) => {
    const args = [
      '-p',
      '--output-format', 'json',
      '--append-system-prompt', system,
      '--disallowedTools', '*',
    ];
    if (config.model) args.push('--model', String(config.model));
    const child = execFile(
      String(config.command || 'claude'),
      args,
      { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        // The CLI writes its JSON envelope even when it exits non-zero
        // ("Not logged in") — its own words beat the exec error's noise.
        let envelope;
        try {
          envelope = JSON.parse(stdout);
        } catch {
          envelope = undefined;
        }
        if (envelope?.is_error || (err && envelope)) {
          return reject(new Error(`claude cli: ${String(envelope.result ?? 'error').slice(0, 200)}`));
        }
        if (err) return reject(new Error(`claude cli: ${String(err.message).slice(0, 200)}`));
        try {
          resolvePromise(parseProposal(envelope?.result ?? ''));
        } catch (parseErr) {
          reject(new Error(`claude cli returned non-JSON: ${String(parseErr)}`));
        }
      },
    );
    child.stdin.end(user);
  });
}

async function ask(config, system, user) {
  if (config?.use === 'cli') return askCli(config, system, user);
  if (!config || typeof config.key !== 'string' || !config.key) return undefined;
  const res = await fetch(config.url || DEFAULT_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model || DEFAULT_MODEL,
      max_tokens: 1000,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`model endpoint said ${res.status}`);
  const data = await res.json();
  const text = Array.isArray(data.content)
    ? data.content.map((c) => c.text ?? '').join('')
    : '';
  return parseProposal(text);
}

export const provides = {
  /**
   * Snapshot: { round, order: [{name, score, acting, entityId, vitals, held,
   * awayInches?, awaySquares?, onBoard}], acting: entity|null (children and
   * all), board: BoardFacts, intent?, style? }
   */
  'propose.turn': async (snapshot, config) => {
    const style = config?.style || snapshot?.style || '';
    // The DM may have already decided WHAT happens and be asking for
    // everything else — the premises, the dice off the printed line, the
    // words to read out. Rule 1 reading forwards: instead of the human
    // overruling the machine afterwards, they go first.
    const intent = String(snapshot?.intent ?? '').trim();
    const system = [
      'You propose ONE turn for the creature currently acting in a tabletop fight.',
      'You decide nothing: the human at the table plays or ignores your words.',
      intent
        ? 'The DM has ALREADY DECIDED what this creature does. Do not second-guess it: work out the premises, the dice and the words for that decision.'
        : '',
      'State every assumption you rely on as a premise — the snapshot may be stale.',
      'Reply with bare JSON, no fences: {"premises": string[], "action": string, "rationale": string, "roll"?: {"dice": string, "for": string}}',
      'Use ONLY facts present in the snapshot; if a fact is missing, say so in premises rather than inventing it.',
      'Positions and distances below were MEASURED by the host, in the board\u2019s true inches; do not recompute them and do not doubt them.',
      'The acting creature\u2019s child entities are its available actions. Name the one you pick and quote its own numbers.',
      style ? `Voice: ${style}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const user = [
      `# The moment`,
      `Round ${snapshot?.round ?? 1}. Turn order (top acts first), one line each:`,
      ...(snapshot?.order ?? []).map(combatantLine),
      '',
      '# The ground',
      ...ground(snapshot?.board),
      '',
      '# The acting creature, as its sheet reads right now',
      'Its children are the things it can DO — each with its own numbers.',
      sheet(snapshot?.acting),
      ...(intent ? ['', `# The DM has decided`, intent] : []),
    ].join('\n');
    return ask(config, system, user);
  },

  /** Snapshot: whatever the DM says happened — { outcome: string, style? } */
  'propose.narrate': async (snapshot, config) => {
    const style = config?.style || snapshot?.style || '';
    const system = [
      'You offer two or three sentences of table narration for an outcome the DM reports.',
      'The DM may read, edit, or ignore them. Never add mechanical effects.',
      'Reply with bare JSON, no fences: {"narration": string}',
      style ? `Voice: ${style}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return ask(config, system, `What happened: ${String(snapshot?.outcome ?? '')}`);
  },
};
