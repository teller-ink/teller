# ARCHITECTURE — the layers, and what may change what

Decided 2026-08-16 (Brian), across one long conversation that started as
"rework the Warden console" and turned out to be about the thing
underneath every console screen. **Rewritten 2026-08-24, after the
fold**, against a constitution that didn't exist when it was first
written.

**Why this file exists.** Every stuck question that day was a LAYER
confusion wearing a different costume — where do statuses live, what IS
a condition, should Talents be a character property, why is reputation
hiding in a field key. Each got resolved locally, by carving a namespace
into whichever list was nearest, three times in one codebase. They were
one question: *what is allowed to define what?* This file answers it
once so it stops being answered ad hoc.

It is a map for DECIDING — where does this new concept live, who may
change it, what happens when it's absent. It is not a changelog and not
a build plan. Where something isn't built, it says so.

**`docs/CORE-NEXT.md` §M is the constitution; this file is subordinate
to it.** §M ratified the platform shape on 2026-08-19 and the old world
was folded on 2026-08-24. Where the two disagree, §M wins, and the
disagreement is a bug in this file. Where §M covers something in detail,
this file POINTS at it rather than restating it — a second copy of a
decision is a second copy to go stale, which is the lesson the rules
file learned the hard way.

**How this file relates to the RULES** (Brian, 2026-08-16): the rules in
`CLAUDE.md` were written before there was an architecture — seven of the
original nine in a single sitting, as that file admits. They are not
gospel and shouldn't be treated as such until the architecture they're
supposed to protect actually exists. This file is that architecture
being written down; the rules harden as it stabilises, not before.

Two caveats that keep this from being a licence. The rules file already
separates *assumed* from *learned*, and a **learned** rule is a scar —
something broke, and the sentence is the stitches. Bending one means
re-deriving the failure, not shrugging. And a rule that a new design
merely *appears* to collide with usually doesn't: the panel section
below looked like it needed rule 6 relaxed, and the resolution turned
out to satisfy rule 6 exactly. Check whether the latitude is needed
before spending it.

---

## The stack

```
Session      what's live tonight — never a file
Table        the host's own files — wins over everyone
Campaign     this table's arrangement
Pack         the world and the words
System       how the game works
Core         the kernel — and the floor layer it ships
─────────────────────────────────────────────  ← the trust boundary
Plugin       function at named points — never in the merge
```

Two things about that picture changed under §M, and both matter more
than they look.

**Core is in the merge now, at the bottom.** teller ships real `.panel`
folders in `defaults/` and loads them from the INSTALL as the floor
layer (§M-6). Nothing is ever seeded into the data dir, so nothing goes
stale and nothing resurrects over an edit. The kernel is still the
software; what's new is that some of what it ships is DATA in the same
format everyone else authors in — open the install and read them.

**The table is a layer, at the top.** The data dir's `panels/` is the
TABLE's own furniture and it beats everything, including a default's
name and a system's (§M-6). The old picture stopped at Campaign and had
nowhere to put "the host's own files," which is precisely the place
rule 1 lives.

**Plugin moved out of the column entirely.** It used to be drawn beneath
System as though it were a lower layer of the same stack. It isn't a
layer: it never merges, and it has its own cardinality. See below.

The merge, in one line (§M-4):

> **teller (install) < system < packs (declared order) < campaign <
> table.** Later wins.

And rule 1 sits on top of all of it:

> Core holds it · Plugin extends what can be said · System proposes ·
> Pack enriches · Campaign decides · the table's own files win ·
> **a human overrules.**

The trust boundary is still a line in three senses at once — code vs
data, security, and "did a human choose to install this" — but it moved.
It no longer sits between System and Plugin, because a system and a pack
both ship CODE now (presentations, panels, exports). The line is: *did
this arrive from outside, and did a human toggle it?* Every arriving
container — system, pack, panel, plugin — takes exactly one trust row,
keyed by its own id, gating its code and never its data.

---

## 1 · Core — the kernel

**Is:** the software. Three responsibilities, not two — the first
draft of this file said "primitives and surfaces" and left out the
whole third of it that keeps the lights on:

1. **The primitives** — what can be stored. The closed set (door 1).
2. **The surfaces** — the roles, and what each may see and do.
3. **The plumbing** — persistence, the merge, transport, auth, routing,
   sync, asset serving, the event log, undo, the small evaluators
   (dice, effects), sweep/compile/trust, the frozen import contract.

**May:** store, log, undo, render, pair screens, serve, sync, sweep,
compile, roll declared dice, and ship a floor layer of `.panel` files
and one starter system.

**May not:** know a single game concept. No `hp`, no Skill, no Trapped
(rule 2). "Ships empty" is a product description now, not just an IP
rule (§M-2).

**Authored by:** us. **Delivered as:** a release. **Identity:** none.

Core is still the only layer with no id and no author — you cannot hand
someone "the kernel" as content. What it now also does is ship a small
amount of ordinary content of its own, from the install, at the bottom
of the merge: **the five host tools' panels** (boards, log, plugins,
screens, shelf) and **the starter system**. That is not an exception to
"ships empty" — those five say nothing about any game, and the starter
is zero-IP vocabulary anyone may redistribute. Where it stops is stated
in §M-6b and worth carrying here because it's a real constraint:
**the install floor is DATA-ONLY.** An installation may be read-only (a
brew cellar), and both art install and code compile write, so nothing
shipped with teller gets presentations or art. A shipped thing wanting
code wants to be a folder on somebody's shelf.

*Naming note:* "Engine" was considered and rejected. The thesis sentence
is "the humans at the table are the rules engine"; naming the code layer
Engine puts the project in contradiction with its own central line. And
"core type" is already a phrase carrying weight — see the contract
below.

## 2 · Plugin — function at named points

**Is:** code that extends what a system is allowed to say, and what a
table is able to do. Art-agnostic, usable with any system: the
assistant, a soundboard, a dice camera.

**May:** register implementations against named extension points —
propose an answer, declare a pane, answer a door.

**May not:** **add a way to store.** See the constraint below. And it is
**not part of any merge** — plugins *load*; content *merges*.

**Authored by:** anyone. **Delivered as:** a folder in
`~/.teller/plugins/`. **Identity:** minted `plg_`. **Cardinality:** any
number per table.

**Built, and no longer a named empty slot.** The contract is §15 and
that section is the thing to read before adding a point; the point list
itself lives in ONE registry file (`core/registry.ts` — the `panes.ts`
precedent: a point not in the registry isn't a point). Plugin №1 is the
assistant, ported OUT of teller rather than into it; plugin №2 is the
store, extracted whole once the pane and door tiers existed. **teller
ships zero plugins and always will** (Brian, 2026-08-18) —
`examples/plugins/` is source a person copies onto their own shelf.

**The sweep DISCOVERS; only a human ENABLES.** This file used to call
that a deliberate break from the pack precedent, and it still is: "drop
it in the folder and it runs" is a fine rule for data and a bad one for
executables. It is now built rather than asserted.

## 3 · System — pure function, zero IP

**Is:** how the game works — kinds, dice, effects, vocabulary,
statuses, skills, progression, creation, mechanics code, and the
functional unbranded PANELS the game needs to be playable.

**May:** declare what kinds of thing exist and what they're called;
rename Core's vocabulary (Warden, not DM); declare dice; propose
defaults and starting kits; ship code (presentations, panels, and an
`exports/` surface packs may import — §M-4a); declare the play screens
themselves (§M-6 — roster, runner, encounters, bestiary, rules and the
entity arrangements are the system's, not the kernel's).

**May not:** carry the book's prose, its art, or its branding. Know
about a specific monster, town or NPC.

**Authored by:** anyone. **Delivered as:** a folder on the shelf,
`~/.teller/systems/<name>/` — `system.json` plus sibling json slots,
`presentations/`, `exports/`, `panels/`, `art/`. **Identity:** a
`sys_`-prefixed name (door 2 — still hand-chosen, see below).
**Cardinality: exactly one per campaign.**

**The consequence that makes this the load-bearing container** (§M-2):
mechanics aren't protectable expression, so a system with no prose and
no book art is **freely distributable by anyone**. That is the
community-distribution deferral finally growing teeth, and it is why
the function/flavor sort is worth doing carefully.

**Which container a thing goes in — two questions, in order** (§M-3):
*whose is this, really?* bounds where it MAY go (rights, not theme — a
system may have all the personality its author owns). Then *does the
unbranded layer want to wear it?* decides where it DOES. The second
question is the one people skip, and skipping it is how one branded
component ends up in an otherwise generic default.

## 4 · Pack — the world and the words

**Is:** the book's stuff — bestiary, prose, catalogue, trades,
statuses' descriptions, art, and BRANDED panels.

**May:** add content freely; add a new status (a supplement making a
mechanical claim is its author's affair); restate one the system already
has, to fix a spelling or supply a visual; ship its own panels and
presentations, which beat the system's on a name collision — branded
over unbranded, which is the point.

**May not:** redefine the system's base list, change dice, or change
what a Skill is. The system carries the mechanic; the pack carries the
book's words about it (rule 4, 2026-08-16; applied again to trades in
§M-6a).

**Authored by:** whoever holds the rights. **Delivered as:** `.pack`, or
a folder on the shelf. **Identity:** minted `pak_`. **Cardinality:** any
number, in the campaign's declared precedence order.

*Naming note:* "Book" is disqualified — teller already has books (PDFs,
`bok_` content hashes). "Compendium" is Foundry's word.

**A pack carrying a PLUGIN is deferred, with the shape noted** (§M-2).
Rule 4 governs contents, so a pack may carry one as cargo; the plugin
would still BEHAVE as a plugin. What stops it being built casually is
trust: pack-carried panels ride the pack's one toggle because panel code
runs in browsers, but a plugin runs on the HOST and declares `needs`, so
a carried plugin wants its own app-permissions moment.

## 5 · Campaign — one table's arrangement

**Is:** which system, which packs in what order, the entities,
encounters, boards, handouts, and its own additions.

**May:** override anything below it.

**May not:** outrank the table's own files. That's the one thing that
changed here, and it changed on purpose (§M-6).

**Authored by:** the DM, usually. **Delivered as:** `.story`.
**Identity:** `cmp_`. **The campaign IS the file** — one SQLite file per
campaign under `campaigns/` (§11), which is what makes "the table picks
its campaign at the door" (§M-7) a runtime choice rather than a boot
flag.

*Naming note, and the one vocabulary change the original conversation
made:* "Story" and "Campaign" both named this layer — the file and the
row — and two words for one layer is exactly the smell that produced the
namespace hacks. **The layer is Campaign; `.story` is the file a
Campaign travels in.** Same relationship a pack has to `.pack`. This
also reframes TEL-87: the question stops being "is a distributed
`.story` a different thing from a backup" and becomes "does a Campaign
have one portable form or two," which is a question about `rights` and
manifest identity.

## 6 · Table — the host's own files

**Is:** the data dir's `panels/` folder, and the shelf's settings.

**May:** restate ANY name and win — a default's, a system's, a pack's, a
campaign's. Customising a shipped panel is copy-up-and-restate.

**May not:** nothing. It wins. This is rule 1 with a folder.

**Authored by:** whoever runs the host. **Delivered as:** nothing — it
never travels. **Identity:** none; it's this machine's.

The concession owed and not yet built (§M-6): a **copy-to-table
affordance** in the console, so discovering and duplicating a default
never requires finding the install directory.

## 7 · Session — what's live tonight

**Is:** turn order and index, fog, deployed foes, the active board,
paired displays, campaign notices.

**May:** change fast and be discarded.

**May not:** hold anything authored. Everything it touches is stored as
Campaign data; the session is a cache with opinions about latency.

**Authored by:** nobody. **Delivered as:** a `Session` class plus SSE
(`server/session.ts`). Never a file. Every mutation is a store-write
plus a room-nudge, so forgetting to broadcast is unrepresentable.

---

## Inside Core — seams, not modules

The question that prompted this (Brian, 2026-08-17): storage,
server↔panel communication, routing, AI, connection protocols — all
Core, and should they be isolated modules?

All Core, yes. There is no layer beneath it and nothing above it can
supply any of it. But **isolation is not the useful unit here.** The
single package is deliberate, and package boundaries cost more ceremony
than they catch at this size. A module is only *one* way to enforce a
seam; a chokepoint function, a type that refuses to expose the wrong
thing, or a lint rule is usually cheaper and catches the actual failure
instead of a proxy for it.

The seams that earn enforcement, after the fold:

**1 · The public-snapshot boundary** (`server/public.ts`). What a
passive surface may see: notes stripped, NPC numbers never shown,
hidden placements and zones REMOVED rather than dimmed, fog flattened to
plain revealed cells. A security boundary, so it is one function nothing
routes around.

**2 · The authorization boundary** (rule 7, `server/auth.ts`).
Role-derived, never re-derived from a secret the client holds. Tickets
sign subject + expiry with the one key; the signature covers the
*presented* expiry so a client can't extend its own.

**3 · The plugin call boundary** (`server/plugin-bridge.ts`). Async and
message-shaped from day one — serializable snapshots in, proposals out,
no live objects, even though v1 runs in-process. Moving to a subprocess
later is then a transport change, not an API break. Stated honestly:
in-process code is NOT sandboxed, and the enable gate is the security
model until that swap.

**4 · The merge** (`core/merge.ts`). One merge, one file, and it should
stay the only one in the codebase. Every layering question in this
document bottoms out there.

**The runtime seam is gone.** "Keep route handlers runtime-agnostic or
this dies" was this file's most-cited line and it is retired (§16): one
runtime, Node, `node:sqlite` direct. Cloudflare carries the landing page
and never runs the game.

---

## The degradation contract

Brian, 2026-08-16, and the best idea of that day:

> **Nothing above Core is required.** When teller meets something it
> can't handle, it degrades to something the humans can still operate.

This is not error handling. It's the membership test for Core, and it
gives the definition everything else hangs off:

> **A core type is the most a human can still operate with no help.**

An `{ name, value? }` with no declaration attached is a label you can
add, edit and remove. That's the floor, and §7's **bare-panel rule**
makes it concrete: the control follows the value's SHAPE, not a
declaration. A number gets − / +; a number with a max gets a bar; a
string gets a text field; a bare name gets a chip; a ref gets a link
chip, marked when dangling. A complete, ugly, fully-operable sheet with
zero declaration.

**§M-1 restates the contract at full scale, and repeals the ban that
used to ride alongside it.** *Simulation capacity is unlimited;
simulation requirement is zero.* Base teller works fully manual forever
— that floor is a contract, not a starting point — and a system may
automate as much as it likes above it, with the automation level as a
table setting. Rule 1 does not bend for any of it.

**Where the floor ATTACHES moved one layer up** (§M-6), and this is the
correction most likely to be missed: it is **per-block degradation
within a resolved system, not a systemless play path.** A host with no
system is a host mid-setup — five host tools, a shelf that says so,
nowhere to put a fight — and that is correct, because "sit down and play
with nothing" was never a real table. Every table has a system, even if
that system is one json file of pure vocabulary. Which is why the
starter system ships with the install (§M-6b), **as the bottom of a
per-id fallback rather than as a layer**: systems don't merge, a
campaign names exactly one by id, so there is no "under" for a shipped
system to sit in. A shelf system restating the id wins outright.

The test was run for real (a campaign with no system at all, 2026-08-16)
and found a genuine crash: an unrecognised `effect` name indexed a
record, returned `undefined`, and the next property access white-screened
the console. The rule it produced survived the rewrite — *losing the
colour is a fine degradation; losing the console is not.*

**Reading forgiving, writing strict** is the same contract at the file
edge, and it is permanent policy rather than a migration window: a file
authored against an older shape can arrive at any time, and a database
migration cannot reach a file that doesn't exist yet. The coercers live
in `core/entity.ts`, and everything written back comes out structured.

**Refusing out loud is degradation too.** A dangling include, a cycle, a
missing `system/<name>` export, a pack that names a book this host
doesn't have — each is a labeled refusal in the load report and at the
render site, naming all the parties involved. Never a crash, never a
blank, and never a silent drop: "you don't have this" beats forgetting
it existed.

---

## Plugin and System, and why they are two things

The first framing tried was that a system delivered as code and a system
delivered as a file are the same layer, differently delivered —
*substitution*. That's wrong, and Brian's correction is the reason this
section exists: code should extend **what a system can say** —
*composition*.

The difference is whether a plugin serves systems its author never met.
Someone wants a hex-crawl travel clock; Core has no clock. Under
substitution they must write their whole system in code, and it serves
one game. Under composition they ship a `clock` plugin, and any system —
including ones nobody has written yet — can declare a clock. One is a
fork; the other is an ecosystem.

**§M-2 sharpened the distinction to two crisp properties**, and both are
worth being able to recite, because the machinery is IDENTICAL (folders,
sweep, esbuild, trust rows) and identical machinery invites collapsing
the concepts:

- **Cardinality.** One system — it IS the game's identity. N plugins.
- **Position.** The system rides the merge and owns vocabulary. A plugin
  never touches the merge and provides only at points.

The mapping Brian reached for still holds: **TypeScript is the System
layer** — declarative, adds no runtime capability, erased before
execution, describes and constrains what's underneath. **React and
Angular are the Plugin layer** — they add capability, and content is
then written against them.

### The constraint that keeps the contract alive

> **A plugin may extend what can be declared. It may never add a way to
> store.**

Everything a plugin introduces bottoms out in Core's primitives, and the
plugin declares what its thing **degrades to** in those terms. Missing
the clock plugin, the clock is a counter with a label: you lose the
behaviour and keep the game.

The consequence is the reason door 1 matters: **Core's primitive list is
the plugin API surface.** It's what every plugin author codes against
and what every system declares in terms of, and it cannot be quietly
changed later.

Who may add what, in one table — and note that only the bottom row can
add storage:

| | may add | may not add |
|---|---|---|
| **System** | vocabulary, meaning, presentation, mechanics code | storage |
| **Pack** | content, prose, art, branded presentation | storage, mechanics the system didn't declare |
| **Plugin** | behaviour, relationships, organisation, rendering, doors | **storage** |
| **Core** | storage | — |

The useful consequence: **"just write a plugin" does not dodge the Core
gate for storage requests.** A plugin can't store either, so the escape
hatch only relieves pressure for BEHAVIOUR requests — which are the ones
that should be relieved. The gate holds by construction rather than by
policing.

### Uninstall it and look — the compliance test

The storage rule is not enforceable by the type system. A plugin can
always fake new storage by encoding structure into an existing
primitive: a graph as JSON in `notes`, a relationship as
`{ name: 'a→b', value: 1 }`. That is the
mechanic-hiding-in-a-text-field bug, committed deliberately, by someone
whose code we don't control.

It is, however, self-auditing — because of the contract that's already
here:

> **Uninstall the plugin and look at what's left.** If the data reads as
> something a human can operate, the plugin played fair. If it reads as
> a blob nobody can act on, it cheated.

So the degradation contract isn't only a resilience property; it's the
compliance test for the storage rule, it takes ten seconds, and anyone
can run it on a plugin they didn't write.

### What "modifying Core" has to mean

Taken literally it kills the floor — if plugins can rewrite Core, Core
isn't a floor and degradation is meaningless. The three readings that
survive are all one mechanism:

- **on top of** — compute a proposal, render a widget
- **alongside** — a new pane, a new surface, an integration
- **modifying** — *replace a named default*, not rewrite

All three are **a plugin registering implementations against named
extension points**. That is a far smaller API than "code that runs
alongside Core," and it is the version that can be versioned.

### The tiers, as built

The old table ranked three tiers by "how cheap to allow" across two
runtimes. One runtime survived, and the tiers that got BUILT are the
ones a real plugin asked for:

| Point | Shape | Runs where | What it may do |
|---|---|---|---|
| **`propose.*`** | `(snapshot, question) → proposal` | host | nothing but answer — it cannot act |
| **`pane.*`** | declares a panel: a console tab, a seat screen, an assignable pane | browser | draw, and write through the ordinary doors |
| **`door.*`** | `request → effects` | host | act, once the SERVER has resolved authority |

Three properties hold the shape together. **Snapshots are PUSHED; a
plugin never queries** — it keeps proposers pure, portable and
cacheable, and the first plugin that genuinely can't live with it makes
the argument. **Authority is resolved by the server first**, and the
plugin is handed what it's allowed to see; a door never re-derives
permission. And a `pane`'s second half is the plugin's OWN word
(`pane.store`, `door.cart`) — a family point, not a fixed one, which is
how the registry stays small.

`control.*` — generalising `dials` — was sketched and is still not a
point, because no plugin has needed one. That's the rule working:
**points grow only when a real plugin needs a real point.**

### The one confirmed instance, and what it corrected

`docs/SYSTEMS.md` surveys 23 subsystems, including the ones that aren't
built, and records a verdict on each. **It found six gaps and every one
is declarative.** So a whole game does not need a plugin.

The exception was a minigame: guess a hidden six-digit number with
green/yellow/red feedback per digit. It is literally Mastermind. There
is no JSON vocabulary that expresses it without inventing a
Mastermind-shaped key.

That corrected the tier ranking. Proposers looked like the interesting
middle, on the assumption that code would be needed for game *math*. The
survey says math is declarable; what isn't declarable is **interaction**.
So:

> A plugin isn't the escape hatch for systems that don't fit. It's the
> escape hatch for **experiences** — minigames, widgets, integrations.

The store bore that out and then pushed past it: it needed session state
(carts), doors seats hit, and SURFACES — which is exactly what the pane
and door tiers were reserved for, and exactly why it shipped as ordinary
furniture first and was extracted once they existed.

### The "is it a plugin?" test

Three questions:

1. **Does it hold state a human needs recorded?** If yes, it's a storage
   question, not a plugin.
2. **Is it universal across systems?** If yes, it's probably the
   system's or the kernel's.
3. **If you lose it, does someone just say a sentence out loud?** If
   yes, the degradation is free.

Three for three the plugin way → plugin. Run statuses through it and you
get three for three the other way → Core.

**Caveat, stated deliberately.** The survey's verdicts on unbuilt
sections are PREDICTIONS, and predictions about what fits have been
wrong three times in one week — severity, Talents and the relief skill
all type-checked as "fits" right up until something had to read them
back. Treat "the survey says it's declarative" as strong evidence, not
proof.

---

## Panels — how declared data gets presented

*Settled, and built. §E is the format, §M-5a the composite and the
chrome seams, §M-5a′ the include. This section is the layer question
only; go there for the grammar.*

**The gap this fills.** Declaring a kind gets you a generic list of
name/value pairs. That is the correct FLOOR — it's the degradation
target, and it has to stay ugly-but-operable. It is a terrible CEILING.
Without a way to express layout, every new kind is a generic list
forever, and "declare a kind" stops being a real answer to anyone who
cares how their game looks.

**A panel is a FILE**, on the same shelf as everything else: an archive
and equally a folder, `panel.json` beside optional `style.css` and
`blocks/*.tsx`, same sweep, no build step for the author. Which SHELF it
sits on is the layer question, and it's answered by the sort test in §3
above: the system's `panels/`, a pack's `panels/`, the campaign, or the
table's own folder. Same merge, later wins — a pack's panel beats the
system's, branded over unbranded, and the table's beats them all.

### The one rule: a panel proposes, the ROLE decides

"Assign any panel to any screen" collides with three separate
commitments, and all three resolve the same way — which is rule 1's
shape, applied to surfaces:

- **Passive surfaces never grow buttons** (rule 6). The table is the
  GROUND; `board`, `art` and `badge` are passive. → Whether a panel's
  controls are LIVE is a property of the screen's role, not of the
  panel. The same panel renders interactive on a seat and inert on a
  badge.
- **Player-safe means player-safe.** Passive surfaces consume `/public`
  — notes stripped, NPC numbers never shown. → The DATA a panel receives
  is whatever the role's snapshot contains. A panel asks; the role
  serves; what's missing degrades, which is already the contract.
- **The console's pane list is authoritative** (`client/lib/panes.ts`) —
  a pane nobody can be assigned to is a pane that doesn't exist. →
  Panels don't get to invent roles. They fill one.

> **A panel declares layout and intent. The screen's role decides what
> it may show and whether its controls are live.**

A panel cannot make a table TV interactive or a badge leak NPC health by
being assigned there, which is what makes "any panel on any screen"
safe to actually mean.

**Panels are offered in exactly ONE dropdown** — the console role's pane
picker — and nowhere else (§M-5a). A seat takes the role and which
character, and resolves its own shape; it is never asked to pick a
layout. The pane law leaking into a role it wasn't written for is a
recognisable failure mode, and it happened once already.

### Composition all the way down

Three nouns, and each is a mergeable named file:

- **A composite** declares a multi-screen surface: subject entity, an
  ordered `tabs` list of panel names, an optional `chrome` map naming
  seam presentations. Sub-panels merge independently by name, so a pack
  restates one screen without owning the set. An entity-subject panel
  not listed in `tabs` APPENDS rather than vanishing — the `rest` law,
  applied to navigation.
- **An include** — `{ block: 'panel', name: '…' }` — nests one panel
  inside another's arrangement, inheriting the subject and write
  context. Later-wins therefore reaches INSIDE arrangements: restate a
  fragment and every arrangement including it updates, without those
  arrangements being restated.
- **A fragment** is a panel with `surface: false` — merged and
  overridable as ever, never offered as a tab, a console pane, or an
  assignment. The panes law inverted on purpose: a fragment is
  deliberately not a place anyone can be pointed.

Two guards travel with them, and both are this file's own laws applied
one level down: **cycles and dangling includes refuse out loud**, and
**trust never launders through an include** — each panel's code gates on
its own row.

### Two arrangements, not one responsive layout

Rule 6 is unusually specific here because it cost a day: **content
renders at designed size, always.** A layout that overflows mounted
glass is **clipped, and the clip is the diagnostic** — the fix is design
(fewer blocks, a shelf, a split), never a transform shrinking type until
nobody can read it. So "the panel figures out how to render on whatever
screen it's on" is precisely the thing that rule forbids.

It doesn't need to. The client asks exactly ONE device question: is this
glass **mounted** or **held**? (Plus one derived fact inside mounted:
the STRIP, ratio ≥ 2.5 — collapsing that into "mounted" once gave an
iPad the rail's sideways pan.) So a panel carries **authored
arrangements**, plural, not adaptive. One decision point instead of a
device matrix. **This satisfies rule 6 rather than bending it** —
checked before assuming otherwise.

### A panel is layout + components. Code is the top rung, not the price of entry

The revolver that rotates when you click to reload is *behaviour*, not
layout. This is where declarative layout formats die: they grow
conditionals, then expressions, then they're a bad programming language.

teller's answer is a LADDER rather than a wall: rearrange json → restate
records → style → custom blocks → takeover. Blocks are the atoms (`list`,
`header`, `statuses` — the alphabet something must eventually draw
with); a rung-5 takeover that draws its own header, tabs and everything
inside is fully legal, one panel that chose to be opaque. **The grammar
is an offer, not a discipline.**

Which is why the panel format never needs to be complete, and must never
grow control flow — and why a panel teller can't render falls back to
the generic kind rendering. **Panels are enhancement over a default,
never the only way to see the data.**

### The punchline: customization is a GRID

Two independent axes (§M-6):

- **The LAYER** answers *who wins* — teller < system < pack < campaign <
  table, ownership all the way up.
- **The RUNG** answers *how deep* — exposure chosen by the author.

Any cell is legal. A pack may take a screen over entirely; a table may
nudge one line of json over that takeover and still win, because
**precedence comes from the merge, never from how much code you wrote —
later beats fancier.** And the floor holds it all up: the app never
requires what the fanciest rung needs, so the author who never learns
React and the author who rebuilds every pixel are both first-class, on
the same host, at the same table.

---

## The resolution law

The structure is package-management-shaped, and two of npm's properties
would be fatal here.

**npm resolves or dies; teller degrades.** A missing dependency in npm
means the app doesn't boot. Here, missing means reduced. The platform
teller actually resembles is **the web** — an unknown CSS property is
dropped and the page still renders, an unrecognised element becomes an
inert box, `<video>` falls back to its children. Progressive enhancement
is the degradation contract, invented forty years earlier. Structure
from npm; semantics from the browser.

**npm's registry is what rule 4a forbids for content.** The alternative
was already chosen: content addressing. A book's id is the sha-256 of
its own bytes, so two people who own the same rulebook derive the same
id without coordinating. That's Git and Nix, not npm. The other reason
to stay away: a DM at a table cannot debug a version conflict, and the
moment installing a campaign means resolving a graph, local-first is
dead.

So, the law:

> Everything above Core is referenced **by id**, never carried.
> Resolution is *do I have it* — there is no range, no transitive graph,
> no lockfile. What's present is merged in declared precedence order.
> What's absent is **reported as missing and degraded**, never fatal.

### What merges, how, and the one exception

**Order** (§M-4): `teller (install) < system < packs (declared order) <
campaign < table`. Later wins.

**Field by field, not whole** (§M-6a, `layerBy` in `core/merge.ts`).
This is the change to the law worth naming, because it inverts a cost:
a declaration used to be REPLACED whole by a later layer, which quietly
charged every layer for everything it didn't mention. Now the system can
state a trade's mechanical spread and the pack can state what that
trade's life is like, and neither restates the other's half to say its
own. Records refine the same way, one key deep and then further.

**`panels` is the one exception, and it is about CODE.** A panel
declaration carries compiled urls and a trust row belonging to whoever
shipped it, so a later layer replaces one whole. Trust never launders
through a merge any more than it does through an include.

**Systems don't merge at all.** A campaign names exactly one by id, so
resolution is a per-id FALLBACK, not a layering:
`systems/<name>/` > a pack-embedded `system.json` > a `shelf.db` row >
the install's shipped copy (§M-6b). A shelf system restating an id wins
outright, and nothing teller ships can outrank or resurrect over an
edit.

### Compatibility — still the one real gap

A pack authored against one version of a system installs happily on
another and nothing notices. Harmless with one author; the first genuine
support burden the moment there are two, because the failure is silent.
The smallest fix that stays on the right side of rule 1: a pack or
system may state **which system version it was authored against**, as a
claim, shown to a human when it doesn't match, never enforced and never
blocking.

**Resist version ranges for as long as possible.** The moment a pack
says `wiw@^2` you have signed up for a resolver, and resolvers are how
"it works at my table" becomes a support channel. §M-4a took the same
line for the system export surface, deliberately: a missing export
refuses out loud and tells you to update the system. Dependency
resolution is not being built, and if that ever hurts we add it then.

The fork property falls out of the same choice: house-fork a system
under a new id, keep exporting the same names, update one field, and
every pack import keeps working. **The requirement is on the surface,
not on the bytes that shipped it.**

---

## What teller may host

Rule 4a once read "teller hosts no content. Not packs, not books."
Brian, 2026-08-16: that was aimed at IP, and plugins didn't exist when
it was written. **This is the third time rule 4 has been found too
broad, in exactly the pattern the rule's own history documents** — a
real constraint stated as a wider one that was easier to remember.

The narrowing generalises rather than carving an exception, because the
distinguishing property was never code-versus-prose:

> **teller may host anything whose author can authorize its
> redistribution.**

A plugin qualifies trivially — functional, author-owned. **So does a
system**, and that's the version of this rule §M-2 made load-bearing:
mechanics aren't protectable expression, so a no-IP system is anyone's
to hand on. So does a `homebrew` pack. A `licensed` or `personal` pack
does not, and never will, because its author usually cannot grant what
they'd be granting.

This finally gives **`rights` a job**. At the table it correctly gates
nothing; hosting is the one place the answer has to be machine-readable.

**Two costs, both standing obligations rather than one-time builds:**

- **Code is a fine smuggling container.** "A plugin carries no IP" is a
  claim about intent, not a property of the format — nothing prevents a
  plugin whose source is a const array of stat blocks. And
  `rights: homebrew` is a self-declaration teller **cannot verify** and
  must never present as verified (rule 4). Hosting therefore means
  acquiring a reporting-and-takedown posture.
- **Hosting executables is a security posture.** A registry of code that
  runs on DMs' machines is a supply chain — and there is more code
  arriving now than when this was written, since systems and packs both
  ship compiled components. In-process plugins are not sandboxed; the
  enable gate is the security model until the transport swap, and that
  swap should land before any registry of third-party code exists.

**Nothing is hosted, and nothing should be built.** The precedent is one
line down from the rule in question: *"v0 of that is a GitHub repo of
JSON, not a platform."* Same answer — installing means putting a folder
on your shelf and deliberately enabling it. Revocable by deleting a line
from a markdown file rather than by operating a takedown process.

What would change the answer: **a second person writing one.** Until
then a registry is infrastructure for an ecosystem of one.

---

## The one-way doors

Almost everything here is a two-way door and can wait. Three were not.
Door 1 has been walked through and is recorded as decided; doors 2 and 3
are still open.

### Door 1 — Core's primitive list is CLOSED *(decided 2026-08-16; built)*

Not "what is the complete list" — that's the big version of the
question and it isn't the one that has to be answered. The one that does
is whether the list is **closed**: must a System express everything it
declares in terms of primitives Core already has?

Answer **yes** and future kinds are additive and non-breaking, because
they're declarations over an existing primitive. Answer **no** — or
answer nothing — and every new kind adds a stored field, a migration, a
serializer coercion and a PATCH allowlist entry, which is rule 2 being
violated once per kind forever.

**Closed means the list of places to put bytes is fixed, and nothing
above Core may add to it.** Systems get unlimited expressiveness in what
they DECLARE; they don't get to invent storage. The nearest analogy is
`data-*` attributes and CSS custom properties — one closed mechanism,
unlimited author vocabulary, and the browser never grows a new attribute
type per author.

It does not mean the primitives are frozen forever. It means an addition
is a deliberate Core-version change rather than a side effect of
somebody authoring a system. **The question is who can cause one.**

**What the primitives ARE, after the rebuild** (§2, §10 —
`core/entity.ts` is the type): an entity is `{ id, name, type?, lists,
notes?, children?, refs? }`, where a list is named entries and an entry
is `{ name, value?, max? }`. That is the whole set. Four named lists
became one open `lists` map, and the three kinds that had carved
namespaces inside them — severity on the end of a tag string, a Talent's
category behind a prefix, reputation behind a field-key prefix — became
ordinary declared lists.

**The line worth keeping, once drawn:** a field is *filled in*; a kind
is a *subset held*. Skills and counters — the entity has every one,
always. Statuses, Talents, standings — the system declares a population
and the entity holds some of it.

**And the resolvable reference arrived.** This file predicted it as "the
one credible Core addition currently visible," reasoning that a thing
which must **resolve AND degrade** has to carry both a stable id for
machines and a human-readable name allowed to go stale. That is `Ref`
(`{ id, name }`), and it earned a row in the bare-panel rule: a link
chip, cached name, marked when dangling, clear / retarget. The
prediction was right, which is mild evidence the triage below works.

### The escalation ladder

Three outcomes, in the order to try them (Brian, 2026-08-16):

1. **Declare a kind.** Free, ungated, no approval — the overwhelming
   majority. The system decides what goes in the store and how it's
   presented and used.
2. **A Core addition.** Strict, rare, gated on Brian doing it or
   approving it.
3. **A plugin.** For anything bespoke that doesn't belong in Core.

The triage between them reuses tests already in this file:

- **Does it hold state a human needs recorded?** No — it acts or renders
  → **plugin** (the three-question test above).
- Yes → **can it honestly be a list of `{ name, value? }`?** Yes →
  **declare a kind**.
- No — it genuinely has structure (ordering that matters, a
  relationship, a shape) → **Core addition**.

**The tell for that last case is this codebase's own recurring bug: if
you find yourself putting a second fact into the name or the value,
it isn't a kind.** Four instances so far, every one of which appeared to
fit. The pattern that caused the bugs is the test for when a Core
addition is actually warranted.

### Why Core specifically is the gated layer

Not maintainer's privilege — **Core is the only layer with no version
negotiation.** Every other layer is referenced by id and degrades when
absent: a missing pack, system or plugin costs something and the table
plays on. Core is referenced by nothing; it is simply whatever build is
running. So a Core addition is the only change in this architecture that
cannot be degraded around, opted into per-table, or rolled back for one
campaign.

That also predicts the pressure the gate exists to resist. Nobody will
ask for a Core addition because something is impossible; they'll ask
because a real property would be *nicer* than a kind. That's
ergonomics — and ergonomics is what the System declaration layer is for.

### There is no un-kinded bucket

**Superseded 2026-08-19, and worth recording because this file argued
the other way for two days.** It used to say `tags` was "kind zero" — the
un-kinded bucket a Warden could type a fresh condition into, with
`kinds` holding everything beyond the default. The reasoning was sound
against the model of the day: split declared statuses out and a newly
typed condition has to pick a list, so "Trapped" and "Bleeding" — the
same fact from a human's side — get stored in different places.

§2 dissolves the problem rather than choosing a side: **every list is a
list**, there is no default bucket to be zero of, and what a list MEANS
is a declaration (`core/kind.ts`). Conditions and descriptors become two
declared lists, which is what actually fixed the bug where they
collided. A list nobody declared still works — that's the bare-panel
rule — it just isn't privileged.

### Door 2 — System identity *(open, narrower than it was)*

The original problem: `'wiw'` as a primary key is fine while systems are
rows seeded from our own source, and breaks the moment systems travel as
files, because two people will both write `'wiw'` and there is no way to
tell the copies apart.

**Half-walked.** Systems are files now, and the id carries a `sys_`
prefix (`sys_starter`, and one per shelf system). What did NOT happen is
the minting: the id is required in `system.json` and hand-written, where
a pack's `pak_` is minted on first sweep and written back if absent. So
it's a prefixed hand-chosen name, not an identity — two authors can
still collide, and the prefix makes that look settled when it isn't.

The old second half of this door is already answered by §M-6b: **a
shipped system is not re-seeded and can be overruled outright** by a
shelf folder restating its id. Re-seeding by name is gone as a
mechanism.

### Door 3 — writing `.system` too early *(open; ordering, not work)*

Nothing exports a `.system` archive, deliberately, and the export route
says so where someone would look for it. A `systems/<name>/` folder is
the only serialization there is. The reasoning stands with one word
changed: don't freeze a public format before the kind declaration is
settled, or two prefixes get frozen into it.

**Close the kind declaration, then serialise.** The order is the whole
decision.

### Explicitly two-way — safe to defer indefinitely

Any registry or hosting; sandboxing and the transport swap; whether a
pack may carry a plugin (§M-2 — shape noted, deferred by contact rule);
whether a horse is an entity or an item; the copy-to-table affordance.
**None of those are behind any of the three doors.**

---

## Open questions

- **Doors 2 and 3**, above — system identity, and the ordering that
  keeps `.system` from freezing a hack.
- **Can a kind declare its value domain?** Partly answered — `domain`
  exists (`core/kind.ts`, `{ kind: 'count', zero: 'clears' }`). What's
  still open is how much vocabulary the declaration owns before it
  becomes a language.
- **TEL-87** — whether a Campaign has one portable form or two, plus
  `rights` and identity on the manifest. §9's known crack, deliberately
  unpatched.
- **Horses and mechs** (`docs/SYSTEMS.md`) — entity or item. The doc
  refuses to decide; decide when a table wants one.
- **Derived readings.** Bloodied/Down/Out of Grit were deleted as stored
  conditions (2026-08-16), and derivation-at-the-point-of-use was the
  answer. What's open is WHOSE point of use: the one surviving threshold
  is hardcoded in the kernel where the old world declared it per system,
  which is recorded doctrine drift (the fold-gate audit), not a
  decision.
