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
// WHAT IT ASKS FOR, and why it keeps growing (v3): `read:entities`,
// `read:board`, `read:records`, `read:log`. Each one was added the day
// an answer went wrong for want of it, and every one of those failures
// is the SAME failure — a fact teller held and did not pass on is a
// fact the reader invents:
//
//   * v1 declared nothing, and answered "the snapshot gives no map, no
//     positions and no ranges" about a fight teller had coordinates and
//     a calibrated board for. → `read:entities`, `read:board`.
//   * v2 was handed measured inches and the system's band NAMES were
//     nowhere, so it said "the snapshot gives no inch value for the
//     bands — I am assuming" in the middle of a fight, and never once
//     considered moving, because nothing told it a step could be
//     bought. → `read:records` (the bands, the space rules, the menu of
//     actions), and every distance now arrives converted.
//   * A creature was handed a held target and no cause for it, made one
//     up, and played the turn off the invention. → `read:log`.
//
// Changing what a plugin asks for means agreeing to it again — the
// enable gate is consent to a list, not to a folder.
//
// FORMATTING IS SALIENCE, and it is not a style note. This file's
// ancestor joined every field into one run with ` · `, and a creature's
// signature move ended up buried at the tail of an 881-character line.
// It cost a real play: the fight's turning point was in the prompt the
// whole time and got proposed past for three rounds. Presence is not
// salience — headings and line breaks are how a fact is FINDABLE, and
// nothing below may be collapsed into a run to save space.
//
// Nothing here knows any game's words: lists, children, bands, painted
// ground and the action menu all render under whatever the records call
// them.
//
// Both provides are PROPOSERS (registry contract): a snapshot in, words
// out, and playing any of it is the DM's act. `premises` is the honesty
// mechanism — every assumption the suggestion leans on gets surfaced
// for the DM to check at a glance, because the snapshot is only as
// fresh as the last thing somebody typed.

import { execFile } from 'node:child_process';

const DEFAULT_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-5';

/** One entry, as a line: `Health: 5/10`, `Speed: Normal`, or a bare held thing. */
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

/**
 * How this creature ACTS, wherever whoever wrote it happened to put it.
 *
 * A heuristic over entry names and nothing more — no schema, no
 * declared slot, no game's word. A sheet that says nothing about
 * temperament says so, and the proposer is told to admit the inference
 * rather than quietly make one.
 */
function profileOf(entity) {
  for (const entries of Object.values(entity?.lists ?? {})) {
    for (const e of entries ?? []) {
      if (/profile|behavio|tactic|demeanor|temperament/i.test(String(e.name))) {
        if (e.value !== undefined) return String(e.value);
      }
    }
  }
  return undefined;
}

/** `3.2" — Short (up to 30 yards)`: the evidence and the vocabulary, together. */
function away(t) {
  if (t?.awayInches === undefined) return undefined;
  const measured =
    `${t.awayInches}"` + (t.awaySquares === undefined ? '' : ` / ${t.awaySquares} sq`);
  if (!t.awayBand) return measured;
  return `${measured} — ${t.awayBand.name}${t.awayBand.world ? ` (${t.awayBand.world})` : ''}`;
}

/**
 * Is this entry a NUMBER-ish fact or a PARAGRAPH?
 *
 * The distinction has to exist somewhere, and this is the cheapest
 * honest place: a speed, a size, a pool and a coin count all fit in a
 * breath; a description, a behaviour note and a creature's signature
 * feature are prose, and prose in a roster line is how an 881-character
 * run gets built one field at a time. Prose is not dropped — it is
 * already printed above, in blocks, under its own heading, which is the
 * whole reason the sheet is rendered that way.
 */
function terse(value) {
  const said = String(value);
  return !said.includes('\n') && said.length <= 24;
}

/**
 * A combatant's line in the order — measured facts, every one labelled.
 *
 * A ROSTER LINE, deliberately: who, how hurt, what is on them, how fast
 * they go, how far off they are. Not a sheet. The one time this file's
 * ancestor let a line grow into everything it knew, a creature's
 * signature move ended up buried at the tail of it and got proposed
 * past for three rounds — so anything that reads as prose stays in the
 * blocks above, where a reader can find it by its heading.
 */
function combatantLine(e) {
  const bits = [];
  if (typeof e.score === 'number') bits.push(`rolled ${e.score}`);
  for (const v of e.vitals ?? []) bits.push(`${v.name} ${v.value}/${v.max}`);
  // Everything with a value and no ceiling — a speed, a printed band, a
  // pool. This is what a move is priced against, and it used to be
  // dropped on the floor between the vitals and the held things.
  for (const s of e.stats ?? []) if (terse(s.value)) bits.push(`${s.name} ${s.value}`);
  if (e.held?.length) bits.push(`holding ${e.held.join(', ')}`);
  const gap = away(e);
  if (gap) bits.push(`${gap} away`);
  else if (e.onBoard === false) bits.push('no token on the board');
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
        away(t) ?? (t.acting ? '—' : 'not measured'),
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

/**
 * Everyone in the fight who has no token.
 *
 * The board above IS the whole world to a reader, so anyone in the
 * order without a placement does not exist to it — not as a threat, not
 * as a target, not as a body in the way. In play that meant three
 * creatures spent a round reasoning about a clearing holding two people
 * while five stood in it, and every answer was correctly derived from
 * half a battlefield. The failure is invisible in the output; nothing
 * about a confident answer says the board was short. So say the absence
 * out loud.
 */
function unplaced(order) {
  const missing = (order ?? []).filter((e) => e.onBoard === false).map((e) => e.name);
  if (!missing.length) return [];
  return [
    '',
    '# In this fight but not on the map',
    'Position unknown — not absent.',
    ...missing.map((m) => `- ${m}`),
    'Do not assume these are far off, or that they cannot reach you. If where they stand would change the turn, say so in premises.',
  ];
}

/**
 * WHAT A DISTANCE MEANS, and what a turn costs — the system's own law,
 * in the system's own words.
 *
 * Nothing here is teller's opinion about any game. `bands` is a ladder
 * of rungs somebody declared, `space` is a paragraph somebody wrote,
 * and the action menu is the same record the console prices a turn
 * from. A system that declares none of it gets none of it, and the
 * proposer is told plainly that the ladder is missing rather than left
 * to invent one.
 */
function law(records) {
  if (!records) return ['(this assistant was not granted the system’s records)'];
  const lines = [];
  const bands = Array.isArray(records.bands) ? records.bands : [];
  if (bands.length) {
    lines.push('This system measures reach in BANDS. Every distance above carries both spellings:');
    for (const b of bands) {
      const from = b.from ?? 0;
      const span =
        b.to === undefined ? `${from}" and out` : from === 0 ? `under ${b.to}"` : `${from}" to ${b.to}"`;
      lines.push(`- ${b.name}: ${span}${b.world ? ` — ${b.world}` : ''}`);
    }
  } else {
    lines.push('This system declares no range bands, so a distance is only ever a measurement.');
  }
  if (records.space) lines.push('', String(records.space));

  const use = records.use ?? {};
  const actions = Array.isArray(use.actions) ? use.actions : [];
  if (actions.length) {
    lines.push(
      '',
      `What a turn can be spent on — the whole menu, each with what it costs${
        use.costCounter ? ` in ${use.costCounter}` : ''
      }:`,
    );
    for (const a of actions) {
      lines.push(`- ${a.name}${a.cost === undefined ? '' : ` (${a.cost})`}: ${a.text ?? ''}`.trimEnd());
    }
  }

  const defenses = records.defenses ?? {};
  const named = Object.entries(defenses);
  if (named.length) {
    lines.push('', 'What being protected is worth here:');
    for (const [name, worth] of named) lines.push(`- ${name}: ${worth}`);
  }
  return lines;
}

/**
 * What happens when a condition lands on somebody who already has it.
 *
 * teller has known this as long as the records have existed and was
 * keeping it to itself, so the reader guessed — and stated the guess as
 * a premise about a condition it had itself stacked the round before.
 * Said as rules rather than arithmetic: the number is teller's to work
 * out, but whether a second helping is worth anything changes what a
 * creature chooses to do.
 */
function conditions(records) {
  const declared = Array.isArray(records?.statuses) ? records.statuses : [];
  if (!declared.length) return [];
  const lines = [
    '',
    '# Conditions this system declares',
    'A condition landing on someone who already has it takes the HIGHER severity, unless the condition says otherwise.',
  ];
  for (const s of declared) {
    const notes = [];
    if (s.relief) notes.push(`shaken off with ${s.relief}`);
    if (s.uncapped) notes.push('has no ceiling — it keeps climbing');
    if (typeof s.cap === 'number') notes.push(`caps at ${s.cap}`);
    lines.push(`- ${s.name}${notes.length ? ` — ${notes.join('; ')}` : ''}`);
  }
  return lines;
}

/**
 * What already happened, oldest first — and where the conditions above
 * came from.
 *
 * Conditions are not free-floating facts. Something PUT them there,
 * usually recently, sometimes this very creature, and a creature
 * holding someone should know it is holding them rather than deduce
 * that somebody must be. What each line PAID is here for the same
 * reason: what a turn could afford last round is how a creature judges
 * what it can afford this one.
 */
function happened(history) {
  if (!Array.isArray(history)) return [];
  if (!history.length) return ['', '# What has already happened', 'Nothing recorded yet this fight.'];
  const paid = (spend) => {
    const lines = Array.isArray(spend) ? spend : [];
    if (!lines.length) return '';
    // A zero is a POSITIVE fact — this cost nothing — and saying it as
    // "0" invites it to be read as a missing number.
    return ` (spent ${lines
      .map((s) =>
        s.amount === 0
          ? `${s.on ?? 'it'} cost no ${s.counter}`
          : `${s.amount} ${s.counter}${s.on ? ` on ${s.on}` : ''}`,
      )
      .join(', ')})`;
  };
  const one = (r) => {
    const round = r.round ? `round ${r.round}: ` : '';
    if (r.kind === 'dice.rolled') {
      return `${round}${r.byName ?? 'somebody'} rolled ${r.pool}${
        r.faces?.length ? ` — ${r.faces.join(', ')}` : ''
      } for ${r.total}${r.unit ? ` ${r.unit}` : ''}${r.for ? ` (${r.for})` : ''}`;
    }
    const by = r.byName ?? 'somebody';
    const caught = Array.isArray(r.targets) ? r.targets : [];
    if (!caught.length) return `${round}${by} — ${r.action}${paid(r.spend)}`;
    // A crowd reads as ONE thing that happened, because it was one
    // thing: an area action rolls once and lands on everybody.
    const said = caught.map((t) => {
      const hit = t.damage > 0 ? `${t.damage} damage` : 'no damage';
      const blocked = t.blocked > 0 ? `, ${t.blocked} blocked` : '';
      const vital = t.vital ? ` (${t.vital.name} ${t.vital.from} → ${t.vital.to})` : '';
      const left = t.statuses?.length
        ? `, leaving ${t.statuses.map((s) => `${s.name} ${s.severity}`).join(' and ')}`
        : '';
      return `${t.targetName ?? t.target} — ${hit}${blocked}${vital}${left}`;
    });
    return `${round}${by} used ${r.action} on ${said.join('; ')}${paid(r.spend)}`;
  };
  return [
    '',
    '# What has already happened (oldest first — this is where the conditions above came from)',
    ...history.map((r) => `- ${one(r)}`),
  ];
}

/**
 * The whole table, in the order the old implementation settled on and
 * for the reasons it settled on it: what the creature IS, how it acts,
 * where everybody stands, who isn't on the map, what a distance and a
 * step MEAN here, how conditions behave, whose turn it is, and what has
 * already happened.
 */
function table(snapshot) {
  const acting = snapshot?.acting;
  const board = snapshot?.board;
  const self = board?.present ? board.tokens?.find((t) => t.acting) : undefined;
  const profile = profileOf(acting);
  return [
    '# The acting creature, as its sheet reads right now',
    'Its children are the things it can DO — each with its own numbers.',
    sheet(acting),
    ...(self?.hidden
      ? [
          '',
          'It is currently HIDDEN — the table does not know it is there. Staying hidden, repositioning unseen, or striking from ambush are all on the table; revealing itself is a choice.',
        ]
      : []),
    '',
    '# How it acts',
    profile
      ? `Follow this: ${profile}`
      : 'Nothing was written down. Infer temperament from its name and its numbers, and say in premises that you did.',
    '',
    '# The ground',
    ...ground(board),
    ...unplaced(snapshot?.order),
    '',
    '# What a distance means here, and what a turn costs',
    ...law(snapshot?.records),
    ...conditions(snapshot?.records),
    '',
    `# The fight — round ${snapshot?.round ?? 1}, top acts first`,
    ...(snapshot?.order ?? []).map(combatantLine),
    ...happened(snapshot?.history),
  ].join('\n');
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

/**
 * THE DECISION DISCIPLINE — ported essentially verbatim from the
 * implementation that ran real fights, because every clause in it was
 * bought with a bad answer at a table.
 *
 * The lines worth naming: the printed band is STRICT (told to avoid a
 * hazard, a reader once decided a close-quarters attack could be thrown
 * across the gap rather than use the ranged one printed beneath it);
 * moving is a TURN (a creature stood still for three rounds because
 * nothing said a step could be bought); and it speaks in the WORLD, not
 * on the table, because a number in the context becomes a number in the
 * prose and nothing at a table is measured in inches.
 */
const TURN_SYSTEM = `You are teller, the bookkeeping assistant at an in-person tabletop RPG session. The DM is running a fight and asks: what would this creature do on its turn?

You PROPOSE; the DM decides. Suggest one turn's worth of action for the acting creature, played true to its profile and current condition — not optimally. A cowardly creature flees at the wrong moment; a beast attacks the nearest threat, not the weakest.

Hard rules:
- Suggest the ACTION only. Never roll dice, never state damage dealt or outcomes — the table's dice decide outcomes.
- Never decide for a player's character.
- Base position reasoning only on the board given. Every distance below was MEASURED by teller in the board's true inches and converted to this system's own band: do not recompute either and do not doubt them. When you assume something the board doesn't state, say so in premises.
- SPEAK IN THE WORLD, NOT ON THE TABLE. Table inches are how teller measures; they do not exist in the fiction and must never appear in "action", "rationale" or "preface". Say the band by name or the world distance it stands for. Premises may cite a measurement when the whole point is that a number is being checked.
- An attack's printed BAND is strict. Something listed under one band cannot be used from another — if the distance puts everything out of reach, the honest turn is to close, reposition, wait, or use something that does reach. Never widen a band to make a plan work, and never do it to avoid a hazard: picking a different action or a different route is the answer, not reinterpreting the book.
- A TURN IS BOUGHT, AND MOVING IS SOMETHING IT BUYS. The menu of actions and what each costs is given below, and the creature's own sheet says what it can afford and how fast it goes. Closing, backing off and repositioning are ordinary turns and often the honest one. Never leave a creature standing where it stands merely because nothing it holds happens to reach from there.
- The GROUND is part of the decision, not scenery. What a creature stands in, what it would have to cross, and what lies between it and a target are all stated. A hazard in the way is a real reason to go around, wait, pick a different target, or accept the cost on purpose — and when the ground changes the choice, say which ground and why in the rationale.

Respond with ONLY a JSON object, no other text:
{"premises": ["assumption the DM should check", ...], "action": "what it does this turn, 1-3 sentences, concrete", "rationale": "why, in one sentence, grounded in profile and condition", "preface": "read-aloud words for the attempt", "roll": {"dice": "the pool exactly as printed", "for": "what it is for"}, "target": "who it is aimed at"}

"roll" names the dice the action calls for: use the EXACT pool printed on the creature's own line, and say what it's for. Omit "roll" entirely if the action needs no dice (moving, hiding, waiting).

"target" is who the action is aimed at, spelled EXACTLY as that combatant is named in the fight above. Omit it when the action targets nobody (moving, hiding, waiting) or catches an area rather than one named combatant.

"preface" is 1–2 vivid present-tense sentences the DM READS ALOUD to the table before any dice are rolled. It is the attempt, not the result. Rules for it:
- Stop at the instant of contact. No hit, no miss, no damage, no target's reaction, no consequence of any kind — the dice haven't decided yet and you must not imply what they will.
- End mid-motion, leaning forward. It should make the table want to see the roll.
- Prose only: no dice, no costs, no bracketed conditions, no stat names.
- Never describe what a player's character thinks or feels.
- If this creature was hidden and the action breaks cover, the preface IS the reveal — describe what the table suddenly sees.

At most 4 premises, each under 15 words. Terse beats thorough — this is read mid-fight.`;

/**
 * THE NARRATION DISCIPLINE — the same port, the other half of a turn.
 *
 * The dice have already spoken, so the whole job is dressing decided
 * facts. Two clauses carry it: it CONTINUES from the words already read
 * aloud instead of retelling them (hearing the approach twice makes the
 * dice feel undone and rolled again), and it may show a defense only
 * with what the target visibly wears, carries or did — which is what
 * lets a blocked hit read as the shot ringing off the plate instead of
 * the flat "they defend".
 */
const NARRATE_SYSTEM = `You are teller, the bookkeeping assistant at an in-person tabletop RPG session. A turn was just RESOLVED at the table: the DM picked an action and the players rolled REAL dice. Your job is to dress the already-decided facts as a moment of story.

Write 2–4 vivid sentences the DM can read aloud to the table, present tense, concrete and sensory — the kind of beat that makes a table lean in.

YOU ARE CONTINUING, NOT STARTING. When words already read aloud are given below, treat them as spoken and behind you: they stopped at the instant of contact, mid-motion. Open where they broke off and carry straight on into what the dice decided. Do not re-approach, do not re-describe the lunge or the grab, do not restate the setup in fresh words — the table has heard it, and hearing it twice makes the dice feel undone and rolled again.

Hard rules:
- The dice already decided everything. Narrate ONLY what the given action and results state — never add damage, conditions, movement or events they don't contain, and never soften or improve an outcome.
- This will be read TO THE TABLE: never mention anything marked hidden or unseen by the table unless the resolved action itself reveals it.
- Never describe what a player's character thinks or feels; their bodies may react, their minds are their players'.
- No rules language in the prose — no dice, no costs, no bracketed conditions; say what a condition LOOKS like, not what it's called.
- When the results say a target defended, show HOW using only what they visibly wear, carry or did — armour, a shield, cover, bracing. Describing a defense the results already state is not adding an event; inventing protection they don't have is.
- Table inches do not exist in the fiction and must never appear.

Respond with ONLY a JSON object, no other text:
{"narration": "the read-aloud text"}`;

export const provides = {
  /**
   * Snapshot: { round, order: [{name, score, acting, entityId, vitals, stats,
   * held, awayInches?, awaySquares?, awayBand?, onBoard}], acting: entity
   * (children and all), board: BoardFacts, records: { bands, space, use,
   * statuses, defenses }, history: [], intent?, style? }
   */
  'propose.turn': async (snapshot, config) => {
    const style = config?.style || snapshot?.style || '';
    // The DM may have already decided WHAT happens and be asking for
    // everything else — the premises, the dice off the printed line, the
    // words to read out. Rule 1 reading forwards: instead of the human
    // overruling the machine afterwards, they go first.
    const intent = String(snapshot?.intent ?? '').trim();
    const system = [
      TURN_SYSTEM,
      intent
        ? [
            '',
            'THE DM HAS ALREADY DECIDED THIS TURN. Do NOT choose a different action, a different target, or a better one — that decision is made and it is not yours. Your job is the rest of it: the premises it rests on, the dice it calls for from this creature’s own printed lines, who it is aimed at, and the preface to read aloud.',
            'If the decision looks like it breaks a rule — a band it cannot reach, a cost it cannot pay — say so plainly in premises and then write the turn anyway. The table’s ruling beats the book, and your job is to flag, not to refuse.',
          ].join('\n')
        : '',
      style ? `\nVoice: ${style}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const user = [
      table(snapshot),
      ...(intent ? ['', '# The DM has decided', intent] : []),
      '',
      `What does ${snapshot?.acting?.name ?? 'it'} do this turn?`,
    ].join('\n');
    return ask(config, system, user);
  },

  /**
   * Snapshot: the same table as `propose.turn`, plus what the dice said
   * — { outcome, preface?, action?, style? }.
   *
   * It gets the whole table on purpose. A narrator handed only the
   * outcome sentence has no idea who is in armour, what ground anybody
   * is standing in, or what was read aloud a minute ago, and invents all
   * three. The facts that make a resolved number read as a moment are
   * exactly the facts the proposal needed.
   */
  'propose.narrate': async (snapshot, config) => {
    const style = config?.style || snapshot?.style || '';
    const system = [NARRATE_SYSTEM, style ? `\nVoice: ${style}` : ''].filter(Boolean).join('\n');
    const preface = String(snapshot?.preface ?? '').trim();
    const action = String(snapshot?.action ?? '').trim();
    const user = [
      table(snapshot),
      ...(preface
        ? [
            '',
            '# What the DM already read aloud',
            'Spoken. Continue from where it stops; never retell it.',
            preface,
          ]
        : []),
      ...(action ? ['', '# The action the DM ran', action] : []),
      '',
      '# What the dice said — the table’s results, already final',
      String(snapshot?.outcome ?? ''),
      '',
      'Narrate what just happened.',
    ].join('\n');
    return ask(config, system, user);
  },
};
