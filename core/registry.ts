// The extension-point registry — ONE file, and only this file.
//
// The `panes.ts` precedent, applied to plugins (`docs/CORE-NEXT.md`
// §15): a point not in this registry isn't a point. A plugin's manifest
// may CLAIM anything; what it provides only becomes callable if the
// name is declared here, and an unrecognised provide is refused out
// loud at load — never silently accepted, never silently dropped.
//
// It started tiny on purpose and it grew the way the design said it
// would: `propose.*` is what the assistant needs to exist as plugin №1,
// and `pane.*` + `door.*` arrived on 2026-08-20 with plugin №2 — the
// store, extracted whole (§15's "the argument arrived"). The
// empirical-ceiling rule held: neither family was built until a real
// plugin needed a real point. `control.*` still isn't one, because
// nothing has asked.
//
// TWO KINDS OF NAME live here, and the difference is the whole reason
// this file has a second half:
//
//   * A FIXED point (`propose.turn`) is one question with one shape.
//     The registry owns the name AND the payload contract, and every
//     provider answers the same way — which is what lets the runner
//     render a proposal without knowing what produced it.
//   * A FAMILY (`pane.`, `door.`) is a KIND of provision whose second
//     half is the plugin's own word. `pane.store` and `door.cart` are
//     names teller never heard of and never has to: what the registry
//     fixes is the SHAPE of a pane and the SHAPE of a door call, not
//     the vocabulary. A family with no suffix, or a suffix with a
//     slash or a capital in it, is not a point — the same refusal an
//     unknown fixed name gets, and out loud.
//
// The `panes.ts` law is unchanged by that: a provision whose family
// isn't declared here isn't callable, and a plugin claiming one is
// refused at load with its own name in the report.
//
// Every point is a PROPOSER by construction: a serializable snapshot
// goes in, a serializable answer comes out, and whatever comes out
// lands somewhere a human can overrule (rule 1). A plugin never holds
// a live object and never queries — snapshots are pushed to it. `door.*`
// is where that line was tested hardest and it HELD: a door receives the
// slice of the table its manifest asked for, and answers with words plus
// PROPOSED EFFECTS the host executes through its own session doors. The
// plugin never holds the session; the bridge never invents an effect.

export const POINTS = {
  /** Given the table's state, whose turn should come next — a proposal for the tracker, never a decision. */
  'propose.turn': 'suggest the next turn from a session snapshot',
  /** Given what just happened, words for it — narration the DM may read, edit, or ignore. */
  'propose.narrate': 'offer narration for a resolved outcome',
} as const;

/**
 * The families, and what a member of each is.
 *
 * The trailing dot is part of the key so the check is a prefix test
 * with nothing to get wrong, and so a family reads at a glance as the
 * open-ended thing it is.
 */
export const POINT_FAMILIES = {
  /** A surface this plugin declares — a panel, rendered by teller's own renderer, with its own compiled code. */
  'pane.': 'declare a panel: a console tab, a seat screen, an assignable pane',
  /** A request-shaped handler the host bridges at `/api/plugin/<plg_id>/<door>`. */
  'door.': 'answer a request from a screen, and propose effects for the host to execute',
} as const;

export type Family = keyof typeof POINT_FAMILIES;

export type Point = keyof typeof POINTS | `${Family}${string}`;

/** The half a plugin chose, for a family point — 'store' out of 'pane.store'. */
export function suffixOf(point: string): string | undefined {
  for (const family of Object.keys(POINT_FAMILIES)) {
    if (point.startsWith(family)) return point.slice(family.length);
  }
  return undefined;
}

/** Which family a point belongs to, or undefined for a fixed one. */
export function familyOf(point: string): Family | undefined {
  for (const family of Object.keys(POINT_FAMILIES) as Family[]) {
    if (point.startsWith(family)) return family;
  }
  return undefined;
}

/**
 * A plugin's own word for its pane or door. Lower-case, and no slash —
 * a door name becomes a PATH SEGMENT (`/api/plugin/<id>/<door>`) and a
 * pane name becomes a merge word, so this is the one place either has
 * to be told no.
 */
export const USABLE_SUFFIX = /^[a-z0-9][a-z0-9-]*$/;

export function isPoint(name: string): name is Point {
  if (name in POINTS) return true;
  const suffix = suffixOf(name);
  return suffix !== undefined && USABLE_SUFFIX.test(suffix);
}

/**
 * What a `propose.turn` provider hands back.
 *
 * The point owns this shape, not any plugin: it's the contract a
 * provider implements and the thing teller's own proposal UI draws.
 * That separation is what lets a surface render a proposal without
 * knowing what produced it — the runner asks for a POINT and gets
 * words, and a second provider tomorrow renders identically.
 *
 * Every field is optional and none of it is load-bearing: a provider
 * that answers with less renders less, and a surface must degrade to
 * showing whatever came back rather than refusing it. `premises` is the
 * honesty mechanism — the assumptions the proposal leans on, surfaced
 * so the DM can check them at a glance before believing any of it.
 */
export type TurnProposal = {
  premises?: string[];
  action?: string;
  rationale?: string;
  /** The pool the action calls for, and what it's for. Rolled by a human. */
  roll?: { dice?: string; for?: string };
  /**
   * The words for the table, stopping at the instant of contact — the
   * attempt, never the result, because the dice have not decided yet.
   *
   * It is a separate field from `action` because they have different
   * audiences: `action` is a brief for the DM and this is spoken. It
   * also becomes the front bookend of a narration, which continues from
   * where it stops rather than retelling it.
   */
  preface?: string;
  /** Who it is aimed at, spelled as the fight names them. A guess, matched by a surface. */
  target?: string;
};

/** What a `propose.narrate` provider hands back — words, and only words. */
export type NarrationProposal = { narration?: string };

// ---------------------------------------------------------------------
// `pane.*` — a plugin declares a surface.
//
// §M-2's line, kept crisp: **a plugin never touches the merge.** A
// pane is not a `panels` declaration arriving from a fifth layer; it is
// a PROVISION, read out of the registry beside the merged collection
// and offered in the same list, sorted by the same comparator. Two
// sources, one bar. The consequence is the one that matters: nothing a
// plugin provides can override a system's, a pack's or the table's
// panel by restating its name, because provisions were never in that
// argument. A pane that collides is a second entry with the same word,
// and the merge is untouched.
//
// What a provision carries is what a tool declaration carries — the
// word, the label, the blurb, the order, the subject — plus the one
// thing a declaration never needs: WHERE ITS CODE IS. A pane is always
// a takeover (§E rung 5); there is no arrangement to declare because
// the plugin brought a component, not a layout.

export type PaneProvision = {
  /** `pane.<name>` — the point, as claimed in the manifest. */
  point: string;
  /** The word this pane is known by. Defaults to the point's suffix. */
  name: string;
  label?: string;
  blurb?: string;
  /** Where it sits in a bar of panes — `core/panels.ts`'s own comparator reads it. */
  order?: number;
  /** What it arranges: one entity (a seat screen) or nothing (a console tab). */
  subject?: 'entity' | 'none';
  /** A glyph name for the seat's tab bar, when it has one. */
  icon?: string;
  /**
   * The door that decides whether this pane is SHOWING right now.
   *
   * A seat's shop tab exists while the Warden has a shop open and not
   * otherwise — a fact about the moment, never about the system — and
   * that was the store's own hook into the seat before it was a plugin.
   * Generalised to one declared word: the surface calls this door, and
   * a null answer means the pane isn't offered. Absent means always.
   */
  when?: string;
  /** The source file, relative to the plugin folder — compiled at load. */
  entry: string;
  /** Optional CSS beside it, served and linked like a panel's own. */
  style?: string;
};

// ---------------------------------------------------------------------
// `door.*` — a plugin answers a request, and proposes what to write.
//
// The shape is a REQUEST and a RESULT, both plain data, because the
// boundary is `structuredClone` in both directions (`core/plugins.ts`)
// and always was. What's new is not the boundary — it's that a door may
// ask for something to CHANGE, and cannot make it change itself.

/**
 * WHO MAY KNOCK — declared per door in the manifest, enforced by the
 * SERVER before the plugin sees the call.
 *
 * teller's own three gates, by their own names: `dm` is the key-holder,
 * `prep` is the DM or a seat (what `canPrep` already means — a seat
 * browses the catalogue legitimately), `table` is any adopted screen.
 * **Absent means `dm`**, which is the only safe default: a door that
 * anyone at the table may knock on has to say so out loud, and a plugin
 * that forgets is closed rather than open.
 *
 * This is not the plugin authorising anything (rule 7 — authorisation
 * is role-derived and the server derives it). It is the plugin
 * declaring which of teller's existing gates its door sits behind, the
 * same way `needs` declares what it touches. Anything finer — whose
 * cart is whose — is the plugin's own law, decided against the `who`
 * facts it is handed and never against a secret it holds.
 */
export type DoorAccess = 'dm' | 'prep' | 'table';

export function toAccess(raw: unknown): DoorAccess {
  return raw === 'prep' || raw === 'table' ? raw : 'dm';
}

/** What the bridge pushes into a door. Everything is data; nothing is live. */
export type DoorRequest = {
  /** The door's own word — 'shop' out of `door.shop`. */
  door: string;
  method: string;
  /** Path segments after the door — `/api/plugin/<id>/cart/ent_x` is `['ent_x']`. */
  path: string[];
  /** The JSON body, for a write; `{}` for a read. */
  body: Record<string, unknown>;
  /**
   * WHO IS ASKING, resolved by the host before the plugin sees a byte.
   * A door never gets a header and never re-derives authority (rule 7):
   * the server decided, and these are the facts of that decision.
   */
  who: {
    /** The event-log actor this call writes as — 'dm', a screen's name. */
    actor: string;
    /** 'dm' for the key-holder, else the screen's assigned role. */
    role: string;
    /** The asking seat's own entity, when it is a seat. Never anyone else's. */
    entityId?: string;
  };
  /** The slice of the table this plugin's `needs` asked for. */
  table: TableSnapshot;
  /** This plugin's own memory for this table, as it left it. */
  state: unknown;
};

/** What a door hands back. Every field optional; an empty result is a 200 with nothing. */
export type DoorResult = {
  status?: number;
  /** The JSON answer. Minted ids are substituted in before it ships (see `Effect.as`). */
  body?: unknown;
  /** Replace this plugin's memory for this table. Absent leaves it alone. */
  state?: unknown;
  /** What the host should do, in order, before answering. */
  effects?: Effect[];
  /** What to nudge the room about — 'entities', 'templates', or the plugin's own word. */
  changed?: string[];
};

/**
 * THE EFFECTS VOCABULARY — the whole of what a plugin may ask for.
 *
 * Small on purpose, and every member maps onto a door teller already
 * had: `Session.create`, `Session.save`, `Session.remove`,
 * `Session.writeEntry`, `Campaign.putTemplate`, `Campaign.removeTemplate`,
 * `Campaign.append`. There is no effect that reaches past those, which
 * is what makes rule 1 and rule 3 structural here rather than a promise:
 * a plugin's write is an ordinary write, logged, undoable, and typed over
 * by a human afterwards exactly like one the DM made by hand.
 *
 * `as` is the one piece of plumbing: an effect that MINTS something may
 * label it, and every later effect — plus the result's own `body` — has
 * `{{label}}` substituted with the id that came back. It exists because
 * the first sale instantiates the vendor and then writes its shelf down,
 * and a plugin that cannot name what it just created would need a second
 * round trip to finish one transaction.
 */
export type Effect =
  | { effect: 'entity.create'; draft: unknown; parentId?: string; as?: string }
  | { effect: 'entity.save'; entity: unknown }
  | { effect: 'entity.remove'; id: string }
  | {
      effect: 'entry.write';
      entityId: string;
      list: string;
      name: string;
      value?: number | string;
      max?: number | null;
      remove?: boolean;
    }
  | { effect: 'template.save'; slot: string; template: unknown; as?: string }
  | { effect: 'template.remove'; slot: string; id: string }
  | { effect: 'log'; entityId?: string; kind: string; payload?: unknown };

/**
 * The slice of the table a door is handed — assembled by the host per
 * call, from what the manifest's `needs` named and nothing else.
 *
 * Two things are worth saying about the shape. Declarations arrive as
 * `{ merged, own }` because anything that EDITS a declaration needs to
 * know which rows are the campaign's to edit and which came from a pack
 * (the store's console says "a pack wrote this one" off exactly that).
 * And entities arrive as `{ stored, reading }` pairs because both are
 * true and they are true about different questions: what a purse HOLDS
 * is the reading, and what a save must not thicken is the stored.
 */
// ---------------------------------------------------------------------
// `read:board` — the fight's GROUND, measured.
//
// The registry owns this shape for the same reason it owns
// `TurnProposal`: a consumer must be able to read a position or a range
// without knowing which host measured it. `server/geometry.ts` is the
// implementation; the law it implements is docs/BATTLEMAP.md.
//
// Two things about it are contract, not convenience. Every distance
// arrives ALREADY MEASURED, in the board's own true inches — nobody
// downstream does trigonometry on normalized coordinates, because a
// reader asked to derive a fact will eventually derive it wrong. And
// there is no empty answer: absence is `{ present: false, why }`, a
// sentence, because "no board this fight" is something a proposer must
// be told rather than left to infer from a missing key.
//
// It is a DM-facing slice — hidden tokens are reported as hidden rather
// than stripped — so it may only reach a door the server already gated
// at `dm`, and only the console's own proposal path otherwise.

/** One token, as the geometry sees it. Every number here was measured. */
export type TokenFacts = {
  placementId?: string;
  entityId?: string;
  name: string;
  /** Behind the screen. Kept, not stripped — this rides a DM-gated need. */
  hidden: boolean;
  /** Map space, 0..1 — the stored truth, passed on so nothing is hidden by summarising. */
  u: number;
  v: number;
  /** Grid cell [col, row], when the board's grid is calibrated. */
  cell?: [number, number];
  sizeInches?: number;
  /** Painted zones whose cells this token stands in, by the zone's own word. */
  inZones?: string[];
  /** Painted zones one cell away — adjacency, not entry. */
  nearZones?: string[];
  /**
   * AUTHORED GROUND this token is standing on, by the patch's own word
   * — the ford, the scree, "waist-high grass". Names only, exactly as
   * `inZones` is: what each one MEANS is in `terrain` below, once, in
   * the author's own sentence. Facts compound; prose repeated per token
   * would just be the same paragraph three times.
   */
  inTerrain?: string[];
  /** True for the token the distances were measured from. */
  acting?: boolean;
  /** Straight-line distance from the acting token, in the board's true inches. */
  awayInches?: number;
  /** The same distance in 1-inch grid squares, when the grid is calibrated. */
  awaySquares?: number;
  /**
   * The same distance in the SYSTEM'S OWN WORD for it, plus what that
   * word means in the world — 'Short', 'up to 30 yards'.
   *
   * teller converts; nobody downstream reinterprets. A reader handed a
   * band name with no inches behind it says so out loud mid-fight ("I
   * am assuming"), and a reader handed inches with no band walks an
   * attack out of its printed range to make a plan work. Both were
   * observed. Absent when the system declares no bands, which is most
   * of them.
   */
  awayBand?: { name: string; world?: string };
  /**
   * The painted ground the straight line from the acting token CROSSES
   * to reach this one — what you'd have to get through, as opposed to
   * what anyone is standing in.
   *
   * A zone either end already stands in is left out; that end is
   * reported as standing in it, and saying it twice would read as a
   * second patch in the way. Absent when nothing is painted between
   * them, which is the ordinary case and says nothing rather than
   * saying 'none'.
   *
   * AUTHORED GROUND rides the same list, marked `terrain: true` and
   * carrying `blocksSight` where the author set it — because "what is
   * in the way" is one question and answering it in two lists would
   * have a reader compare them. Whether the line is BLOCKED is
   * deliberately not stated: teller reports the opaque ground it
   * crossed, and the table rules on what that means (rule 1).
   */
  between?: {
    name: string;
    cells: number;
    hidden?: boolean;
    /** Inherent ground rather than something painted this fight. */
    terrain?: boolean;
    /** The author's structural flag, passed on rather than acted on. */
    blocksSight?: boolean;
  }[];
};

/**
 * ONE PATCH OF AUTHORED GROUND, told as facts (`core/terrain.ts`).
 *
 * The `description` is the whole point of the record: it is the
 * AUTHOR'S OWN WORDS about how this ground plays, and it is passed
 * through untouched because teller has no opinion about what
 * "waist-deep, footing treacherous" costs. The model interprets, the
 * Warden rules.
 */
export type TerrainFacts = {
  /** The patch's word — its kind, or the area it claims, made unique across the board. */
  name: string;
  /** As authored. Absent when the patch was drawn and not yet named. */
  kind?: string;
  /** The author's sentence about how it plays. Never parsed by teller. */
  description?: string;
  /** In the plane's calibrated unit, when the author set one. */
  elevation?: number;
  blocksSight?: boolean;
  /** The stored area this patch claims, by name. */
  area?: string;
  cells: number;
  /** Tokens standing on it, by name. */
  standingIn: string[];
  /** This patch names an area the board hasn't got, so it covers nothing. Stated, not swallowed. */
  missingArea?: string;
};

/**
 * WHERE A NAMED PLACE STANDS IN THE DARK — the fog question asked of
 * the board's own geography (`core/fog.ts`).
 *
 * Derived, never stored, and it is ambush geometry: what the posse has
 * NOT seen is a fact about the fight that exists nowhere in the
 * placements. DM-side, like everything else in here.
 */
export type AreaFacts = {
  name: string;
  cells: number;
  /** `partial` is a real answer — a room half-explored is a thing that happens. */
  status: 'lifted' | 'fogged' | 'partial';
};

/**
 * ONE STEP SOMEBODY TOOK, measured — the round before, told as facts.
 *
 * A board state is a photograph and cannot say that anybody moved, so
 * teller keeps the step in the log and measures it here. Every number
 * is teller's: how far it went, how far off it was, how far off it is
 * now, and — the one that changes a decision — whether that CLOSED the
 * gap on whoever is acting. A reader handed two coordinate pairs and
 * asked to work out 'toward' will do trigonometry, and eventually do it
 * generously.
 */
export type MoveFacts = {
  /** Whose step it was, by name. */
  name: string;
  round?: number;
  /** The acting creature's own step. It gets a distance, never a direction. */
  mine?: boolean;
  /** Behind the screen when it moved. Kept — this rides a DM-gated need. */
  hidden?: boolean;
  /** How far it went, in the board's true inches. */
  wentInches?: number;
  wentSquares?: number;
  wentBand?: { name: string; world?: string };
  /** The gap on the acting creature, before and after the step. */
  wasAwayInches?: number;
  nowAwayInches?: number;
  wasBand?: { name: string; world?: string };
  nowBand?: { name: string; world?: string };
  /** Measured here, never derived downstream. Absent for the acting creature's own step. */
  sense?: 'toward' | 'away' | 'neither';
};

export type ZoneFacts = {
  /** The painted layer's own word — 'fire', 'water', whatever was painted. */
  name: string;
  cells: number;
  hidden: boolean;
  /** Tokens standing in it, by name. */
  standingIn: string[];
};

/**
 * The fight's ground, or the reason there isn't any.
 *
 * `present: false` is a first-class answer with a sentence attached,
 * because "no board this fight" is a thing a proposer must be TOLD
 * rather than left to notice.
 */
export type BoardFacts =
  | { present: false; why: string }
  | {
      present: true;
      board: {
        id: string;
        name: string;
        /** The map's true width in the room, in inches. Absent means uncalibrated. */
        widthInches?: number;
        heightInches?: number;
      };
      /** How distances are expressed, said out loud so nothing is guessed. */
      units: string;
      /** 1-inch squares across and down, when the grid could be calibrated. */
      grid?: { cols: number; rows: number };
      /** Why there is no grid, when there isn't one. */
      gridless?: string;
      /** The token every `awayInches` was measured FROM, by name. */
      measuredFrom?: string;
      /** Why nothing was measured, when the acting creature has no token. */
      unmeasured?: string;
      tokens: TokenFacts[];
      zones: ZoneFacts[];
      /**
       * The authored ground, when the board carries any. Absent rather
       * than empty — a board with no terrain says nothing, the way a
       * board with nothing painted on it does.
       */
      terrain?: TerrainFacts[];
      /** The board's named places and where each stands in the dark. */
      areas?: AreaFacts[];
    };

export type TableSnapshot = {
  campaign: { slug: string; name: string; rootId: string };
  declarations: Record<string, { merged: unknown[]; own: unknown[] }>;
  templates: Record<string, unknown[]>;
  records: Record<string, Record<string, unknown>>;
  /** The campaign root's children — everyone and everything at the top level. */
  entities?: { stored: unknown; reading: unknown }[];
  /** Where everyone is standing, measured — or why there is nowhere. `read:board`. */
  board?: BoardFacts;
};

/**
 * ONE NEED — what a plugin says it touches, in the enable dialog's own
 * terms and in the bridge's.
 *
 * `read:templates/catalog` reads as English and gates as code: the
 * snapshot carries exactly the slots named, and an effect whose verb
 * and subject nobody granted is REFUSED — reported back in the result,
 * never silently dropped. A trailing ` — note` is the author's
 * explanation and is shown to whoever is deciding.
 */
export type Need = {
  verb: 'read' | 'write';
  /** 'declarations' | 'templates' | 'records' | 'entities' | 'board' | 'entries' | 'log', plus whatever a later point adds. */
  subject: string;
  /** The one slot, when the need names one. Absent means the subject whole. */
  slot?: string;
  note?: string;
};

const NEED = /^(read|write):([a-z]+)(?:\/([a-z0-9_-]+))?\s*(?:[—-]\s*(.*))?$/i;

/** `"write:templates/vendors — the shops a Warden writes"` → a Need. */
export function toNeed(raw: unknown): Need | undefined {
  if (typeof raw !== 'string') return undefined;
  const m = NEED.exec(raw.trim());
  if (!m) return undefined;
  const out: Need = { verb: m[1].toLowerCase() as Need['verb'], subject: m[2].toLowerCase() };
  if (m[3]) out.slot = m[3];
  if (m[4]?.trim()) out.note = m[4].trim();
  return out;
}

/** Does this list of needs grant `verb` on `subject` (and `slot`, when one is named)? */
export function grants(needs: Need[], verb: Need['verb'], subject: string, slot?: string): boolean {
  return needs.some(
    (n) =>
      n.verb === verb &&
      n.subject === subject &&
      // A need with no slot is the subject WHOLE; one with a slot is
      // that slot alone. Nothing widens by accident.
      (n.slot === undefined || n.slot === slot),
  );
}
