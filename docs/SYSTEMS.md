# SYSTEMS — the WiW survey

A domain map of every subsystem in the Wild Imaginary West Guidebook,
read end-to-end on 2026-08-11 so that features stop being shaped from
fragments. Three wrong guesses in one week — the ✶ box (twice), the
"upgrades are homebrew" episode, Knockback nearly growing a phantom
die — all came from inferring a rule off one filled-in sheet instead of
reading the table that defines it. This file is the antidote: **what
each system IS, the data shape it wants, where it lives, and what it
touches.** It is deliberately not a design doc — no screens are
sketched here. Screens get designed one at a time, at the table's
pace, which is the half of the process that has actually worked.

Rule 4 note: mechanics are not protected expression and belong to the
SYSTEM; the book's PROSE stays in the pack. Everything below is
paraphrase + page references (printed page; PDF page = printed + 14).

**Read the marks as of the fold** (2026-08-24). This survey was taken
against the old app; the world it cites was folded, and the citations
below have been re-pointed at their new homes. A system is no longer a
database row — it is a folder on the shelf (`systems/<name>/`), and
where this file says "the template" read `system.json`'s record slots.
Where something did not come across, it says so rather than staying
green.

Status marks: ✅ built · 🔶 partly built · ⬜ not built · 🎲 stays
physical / the table's business (teller may reference, never run).

---

## 1. Dice & rolls (p. 2, 16) ✅ / 🎲

Two dice: Black (B) and Gold (G), faces Hit / Ace / Spur / Blank in
different mixes (declared in the template's `dice`). Aces = 2 Hits.
Spurs reroll **only** with the matching Talent (§14). Rolling is
physical — teller renders pools and may roll only where a human asked
it to (initiative).

- **Shape:** the system's `dice` record — shipped.
- **Touches:** Talents (spur rerolls), Ace-in-the-Hole (ace tally, §4),
  Misfire house rule (official dice landing on end — pure table).

## 2. Skills, difficulty, helping (p. 12–13) ✅ / 🎲

Four skills (Charm, Finesse, Intuition, Nerve), same for everyone.
Task difficulty = target Hits 1–5. Challenge rolls are opposed same-
skill rolls. Helping: half your dice rounded up, best helper counts.

- **Shape:** fields + `groups.skills` — shipped. Difficulty/helping are
  rulings, nothing to store.
- **Touches:** Prestige (practice 1B→1G, master +1B — §13), statuses
  (relief rolls, Poisoned's −2 dice), Talents (✶ box per skill row).

## 3. Trades (p. 14–31) ✅

Seven trades, each a character sheet + six Abilities + two
Ace-in-the-Hole Abilities. New characters start with one regular
Ability + AitH 1. Trade accent colours shipped in `accents`.

## 4. Abilities & Ace-in-the-Hole (p. 14, 18–31) ⬜

Each Ability: name, prose, ≥1 Grit to use (Warden prices the
unpriced), some limited **2/day**. **Ace-in-the-Hole:** tally every
Ace rolled in combat on the sheet; at **6** you may fire AitH 1 or 2,
which **resets the tally to 0**. Campfire/town rest also resets it.

- **Shape:** catalogue entries (`kind: 'ability'`, `group` = trade) —
  prose field, optional grit field (the fire button already prices
  that), a `2/day` uses counter where applicable. The Ace tally is one
  character counter (max 6) — a dial candidate someday, and rest
  resets it.
- **Surface:** the seat's next screen. StatusPanel's shape with a
  different filter, plus the tally.
- **Touches:** Prestige (unlocking), rest (§8), the fire button
  (Use Item and Ability are the same arithmetic).

## 5. Grit & Actions (p. 40–42) 🔶

6 Grit per round, reloaded at the start of **your** turn; untracked
outside combat. Actions: **Move** (1 Grit/Short, speeds Fast→Very
Slow, rough terrain doubles), **Attack** (weapon's cost), **Aim**
(1 Grit, reroll 1 die, once/turn — global, NOT per weapon), **Dodge**
(1B per Grit, banked damage reduction until your next turn),
**Use Item** (item's cost + its dice), **Prepare** (once/turn, delayed
action, Grit spent now, lost if untriggered), **Improvise** (≥1 Grit,
Warden's call). **Fool's Grit:** once per turn, +1 Grit for 1 Health.

- **Built:** cylinder ✅, Attack/Use Item via the fire button ✅, Aim
  as the armed reticle ✅ (deduct-at-fire, lock released by refill).
- **Not built:** Fool's Grit (a one-tap trade: +1 Grit, −1 Health —
  same one-write spend shape as fire); Dodge's banked pool is a
  scribble the table keeps 🎲; Move/Prepare/Improvise are table 🎲.
- **Watch:** "reloads at the start of each turn" is the seat's turn
  signal — the refill-releases-locks pattern hangs off it and can
  carry anything else per-turn.

## 6. Defense & cover (p. 43) 🎲

Defense = Dodge + Cover (Light 1B / Heavy 2B) + items; monsters have
innate pools (bestiary field ✅); humans none. Rolled per incoming
attack, subtracts Hits.

- **Shape:** already a field wherever an entity has it. Rolling is
  physical.

## 7. Statuses (p. 48–51) ✅ / 🔶

Seven statuses, each tied to a relief Skill. Severity = Hits after
Defense; stacks to a cap of 6 (except Trapped → **Captured** at a
size-dependent threshold: Tiny 6 … Huge 14, Titan immune). Relief:
1 Grit per die of the associated skill, −1 Severity per Hit, one
attempt per status per turn. `[2B]` = roll for severity; `[2]` = flat.
**Lasting effects** (Burned: −2 Max Health; Poisoned: −1 die) persist
after relief until proper care; they don't stack with themselves.

- **Built:** StatusPanel with severity boxes ✅. **The seven live in the
  SYSTEM** (2026-08-16), each with its relief skill — the system's
  `statuses` declaration, merged with anything a pack or the campaign
  adds (`core/boot.ts`, field by field via `layerBy` in
  `core/merge.ts`). They were in the Guidebook pack, which meant a host
  without it had no conditions at all; the pack still carries what each
  one MEANS. A condition on an entity is an `Entry` — `{name, value?,
  max?}` in a declared list, never a string with the number on the end
  (`core/entity.ts`, ported whole from the old `worker/tags.ts`), and
  what the list MEANS is a kind declaration (`core/kind.ts`).
- **Gone:** the "state suggestions" (Bloodied, Down, Out of Grit). They
  were never statuses — each was a threshold over a counter, stored as a
  fact, so a healed character stayed Bloodied until somebody noticed.
  Deriving them instead is open and unbuilt, and the fold made that
  gap sharper rather than smaller: the assistant's old `thresholdOf`
  did not come across (the assistant is a plugin now,
  `examples/plugins/assistant/`), and the one place a threshold still
  lives is `vitalityOf` in `server/public.ts`, which hardcodes 0.5 and
  0.25 in the KERNEL where the old world declared them per system.
  That is recorded doctrine drift — see the fold-gate audit in
  `docs/CORE-NEXT.md` — and it gets fixed when state-suggestion
  derivation is actually built.
- **Not built:** lasting effects are pack prose; Captured thresholds
  belong in bestiary/pack data if ever needed. The `effect` palette is
  SHORT — six visuals for seven statuses, so Afraid and Dazed currently
  share one.
- **Watch:** severity values can be POOLS (`Trapped [1B1G]` from a
  trap). Anything that stores "what this inflicts" needs to accept
  dice notation, not just integers.

## 8. Health, healing, rest, death (p. 52–55) 🔶

Max Health starts 10, +1 per 2 Prestige (5× max), well-fed +1 temp.
**Campfire rest:** roll any skill, heal the Hits. **Town rest:**
full Health, all statuses relieved, Supplies reset, Forstall batteries
recharged, Ace tally reset. **Bleeding Out** at 0 HP: each ally-turn
end, roll a different Skill, ≥1 Hit to survive; four skills exhausted
or one miss = dead; any First Aid rescues → Unconscious [5]; relieved
→ 1 HP. Enemies just die 🎲.

- **Built:** Health panel ✅.
- **Candidate:** **Town rest as a console macro** — one action
  PROPOSING the whole bundle (heal, clear statuses, reset supplies,
  recharge batteries, zero the tally) as ordinary counter writes,
  reviewable and undoable (rule 1). Campfire rest is a roll → the
  table types the result.
- **Bleeding Out** is a tag + table drama 🎲; teller need only not get
  in the way.

## 9. High-Noon Duels (p. 58) 🎲

A structured mini-game: strip gear, town Dueling Pistols (2G), roll
all four Skills head-to-head (winner +1B to the Draw pool each),
then DRAW; Hits against you map to injury tiers (0 none → 5+ dead).
No Defense, Talent rerolls only with matching Talents. Pure theatre —
at most a someday reference card in the pack.

## 10. Money, wages, shopping (p. 63) ✅ / 🎲

Money is COINS (2026-08-14): each denomination an ordinary counter,
composed by the system's `currency` declaration; the pocket shows one
purse chip that opens into the counts ✅. Wage tables are reference
(pack). Prices are filing data on catalogue entries ✅ — the whole
priced catalogue is entered (weapons, traps, tools, explosives, first
aid, shields, batteries, Goods & Services p. 201–203).

Shopping is conversation 🎲 **with a bookkeeper** ✅: vendors are
campaign entities (derived or curated stock), the DM opens one on every
seat, carts go on the counter, and the haggle happens out loud — the
DM types the final figure over the book's total and teller books the
transfer (coins paid, change back, goods landed, services consumed,
one event). "Prices are often negotiable" is the book's own economy.

**The bookkeeper is a PLUGIN now** (§15, plugin №2, extracted
2026-08-20 — `examples/plugins/store/`). Built still means built, but
it means "on a host where somebody copied it onto their shelf and
enabled it", not "on every host": teller ships zero plugins and a fresh
install has no store until a human turns one on.

## 11. Weapons (p. 64–67) ✅ / 🔶

Five types + mounted. Grit cost + pool per range; some have
**Distant** (Precision Rifle, several mounted — the `distant` field
key already flows through). One weapon wielded; **dual pistols**
combine to 4 slots; holstered swap = 1 Grit; melee throws to Short.
Tiers Used/Basic/Premium/Elite = availability + quality (filing).

- **Built:** catalogue, resolver, fire button, chambering ✅.
- **Not built:** **mounted weapons** — two Grit costs (solo | crewed,
  e.g. "4 | 6"); crewed splits the cost and **operator 2 pays from
  their NEXT turn** (a Grit debt — no current shape models a deferred
  spend); 0 upgrade slots; special ammo allowed. Also dual-wield slot
  pooling is unmodelled (probably fine as-is — two items).

## 12. Special ammo & arrows (p. 76) ✅

Character-level pools, typed (rounds vs arrowheads), fired from any
compatible weapon. Effects post-dice (Bang!, Status, Piercing,
Knockback) except Explosive Arrowheads (+1G Arm's Reach). All shipped:
`kind: 'ammo'`, chambering, `CatalogItem.effects`.

## 13. Upgrades, Scrap, kitbashing (p. 93–99) 🔶

One slot per TYPE per item (Utility exempt — `stacks` ✅). Levels are
potency data. Kitbash from Scrap or buy; **upgrades can move between
items** (an hour each, free — so an upgrade is an asset, not a
consumable). Scrap is a counter ✅; salvaging rolls 🎲.

- **Built:** ranged + melee upgrade catalogue, fitting, arithmetic ✅.
- **Not built:**
  - **Trap upgrades** (p. 97): Damage [n] or extra Status [n] — these
    add to what the trap INFLICTS, not to a dice pool. `PoolEffect`
    can't say "add Burned [1] to the result"; needs a new effect op
    or plain text.
  - **Forstall upgrades** (p. 98): Sweep duration, Calibration
    (1B→1G on the sweep pool — `convert` works), Battery charges
    (+n to a counter MAX — new op), Crystal Burst Fuse (capability
    flag).
  - **Mech upgrades** (p. 99): Health +4/8/12 (counter max), Armor /
    Cover +nB (pools — works), Speed (−1 Grit to move), Storage
    (+slots), Mounted attachment, Utility.
- **Watch:** the recurring gap is effects that touch **counters and
  non-pool fields**, not just range pools. If a second effect op is
  ever added, it should be one generic "bump a counter/max" — not
  seven bespoke ones.

## 14. Talents (p. 32) ⬜

4 Prestige each. Categories: the four Skills; Rifles, Shotguns,
Revolvers, Bows, Melee weapons, Mounted weapons, Explosives, Traps,
First Aid; Defense; Mechs; Forstalls. Effect: reroll Spurs on that
category's rolls. **The ✶-and-box printed on each weapon block and
each skill row is this** — the Talent tick, not Aim (settled
2026-08-11 after two wrong guesses).

- **Shape:** tags (`Talent: Rifles`). Zero schema. The seat can fill
  the ✶ marker on a weapon whose catalogue `group` matches a talent
  tag, and on a skill row likewise — display only; the reroll itself
  is physical dice 🎲.
- **Surface:** markers on existing panels; the buy lives with
  Prestige (§16).

## 15. Reputation & factions (p. 119+) ✅

Per-faction standing on one five-step ladder: Hostile (−2B),
Suspicious (−1B), Neutral (0), Helpful (+1B), Revered (+2B) — the
modifier applies to CHARM rolls with that faction (p. 119's table).
Everyone starts Neutral. Abilities reference thresholds ("Helpful or
better"). **Horse bonds use the same ladder** (§18).

- **Built (TEL-67):** template key `ladders` (prefix / steps with
  display-only mods / defaultStep / a pack SECTION whose entry names
  are the roster — factions are world content and live in the pack,
  v14's "Factions"). A standing is an ordinary field
  (`rep_<slug>: Helpful`), stored only off-default — tap Neutral and
  the field is removed. `LadderPanel` rides on More; names open the
  pack entry; strays render. Mods shown, never applied 🎲.
- **Later:** horse bonds as a second `ladders` entry (own prefix),
  when mounts arrive (§18).

## 16. Prestige, tiers, achievements (p. 32–34) ✅

Earn to 100 max. **Spend menu:** Practice Skill (2, exchange 1B→1G),
Improve Health (2, +1 max, 5×), Develop Talent (4), Unlock Ability
(4), Master Skill (6, +1B, 3×), Ace-in-the-Hole 2 (6). Tiers at
0/10/25/50/75/100 (Tenderfoot → Legend) gate starting loadouts and
monster-size guidance. Achievements = named feats granting Titles;
Jackpot = posse votes +1 Prestige at rest.

- **Built (TEL-66):** the two counters ✅, and the menu as six
  proposing macros — template key `spends` (counter / total /
  tiers / menu with four generic effect ops: pool add/convert from
  a group, counter max, mark grant, item add). `PrestigePanel`
  rides on More; one combined PATCH per buy; tier derived from
  Total, never stored; limits are reminder text, not checks.
- **Not modelled:** Achievements/Titles (prose — pack territory);
  Jackpot (a rest-time ritual, TEL-13's family).
- **Surface:** the seat's More screen; console via ordinary counters.

## 17. Trapping & bait (p. 70–73) ⬜

Traps are gear: Grit cost, a pool that INFLICTS `Trapped [pool]`
(sometimes + damage/status), 1 upgrade slot, reusable. Improvised
traps: one-use, pre-combat setup time, Intuition to build (fail =
half pool), reference pools 1B–3B. Bait: Warden rolls monster
Intuition vs enticement 1–5.

- **Shape:** catalogue entries (`kind: 'trap'`, group Traps) — the
  book's table is ready data. **Watch:** their "pools" are effect
  strings (`Trapped [2B1G] + Damage [1]`), which must stay TEXT — a
  trap's value is what it inflicts, not dice the holder rolls for
  damage, so `isPool` classification correctly leaves them prose.
- **Surface:** picker + weapons screen (they're carried and priced —
  the fire button already works for "spring the trap" Grit).

## 18. Horses & mounts (p. 104–108) ⬜

A horse is an entity: Health 12, speed Fast (2×Short per Grit), its
own skills, a **Power Kick** it uses only in self-defense — plus a
**Breaking Point** (6–15 by breed) and a **bond** on the Reputation
ladder; Revered unlocks a breed ability. Riding: can't Aim or Dodge
(breed exceptions); +1 Supplies slot (Clydesdale +2). Breaking: mount
it, roll all four Skills once each, total Hits ≥ Breaking Point.
Legendary steeds exist. Purchased/gifted horses skip breaking.

- **Shape question (open, with mechs):** a horse is closer to a
  CHARACTER (own counters, targetable in combat, persists) than an
  item — likely `kind: 'horse'` characters stamped from pack
  blueprints, bond as a field on the ladder. Deliberately NOT decided
  here.
- **Surface:** bestiary/blueprints for stats; bond on the owner's
  sheet.

## 19. Mechs (p. 89–92, 99) ⬜

Four classes (Dowitcher/Piper/Mule/Dromedary): Health 10–30, Mech
Defense pool, passenger Cover, Speed, Capacity, Supply slots, 2–4
upgrade slots. Built from a base + Scrap. **Compromised** at ≤50%
Health (move cost doubles, cap 6) — a state-suggestion candidate,
exactly like Bloodied; **Totaled** at 0 (salvage or repair — 1 Scrap
or $2 per Health, out of combat). One driver per round; mounted
weapons ride on them (§11's debt problem).

- **Shape:** same open question as horses — an entity with counters,
  probably a character kind, owned by the party rather than a person.
  Its upgrades reuse §13's machinery once effects can touch counters.
- **Surface:** console first (it's shared); a seat screen only if a
  table wants a "driver's seat".

## 20. Forstalls (p. 81–88) ⬜

Monster-deterrence device. Models (Backpack/Saddlebag/Mech/Town):
Grit cost, Sweep pool, Range, Battery charges (2), Duration
(2h/charge), upgrade slots. **Sweep:** roll; monsters in range lose
Grit = Hits (+1 if Scanned), can't sneak in-range. **Scan:** 3 Grit +
Intuition — then guess the monster's six-digit **Kurtz Frequency**
with green/yellow/red feedback per digit. It is literally Mastermind,
run between Warden and player. **Burst** (with crystal + fuse
upgrade): drives off a fully-known frequency, shatters the crystal.
Edison's rules: no overlapping Forstalls (Electrocuted [6]!), useless
in caves/water, never the Forbidden Frequency.

- **Shape:** catalogue entries with counters (charges, crystals) —
  the fire button already handles "spend 4 Grit to Sweep". A
  monster's Kurtz Frequency is a bestiary/blueprint field, hidden
  from players (the public-snapshot strip already exists for
  exactly this).
- **Candidate (fun):** a console-side Scan widget — the Warden enters
  the frequency once; teller renders the green/yellow/red feedback so
  the puzzle runs itself. Pure presentation, zero authority.
- **Surface:** weapons/gear screen (it's carried and priced);
  the scan game is console + table.

## 21. Supplies, batteries, tools, First Aid (p. 74–76) 🔶

Supplies: slot count (1 + horse/mech bonuses), reset by town rest;
contents improvised 🎲. Batteries: charge counters on the things that
need them; Electrocuted +1 severity if carrying one; town rest
recharges. First Aid: purchasable items with dice pools (roll, heal
the Hits) or flat effects (Antidote removes Poisoned + lasting) —
catalogue entries with `kind` and the fire button's Use Item pricing.
Mech Repair Kits likewise.

## 22. Trophies & loot (p. 79) 🎲 / 🔶

Condition (Pristine→Poor, degraded by shotguns/explosives/Burned) ×
monster size → price range. Loot is narration. A trophy someone keeps
is an ordinary item; the price table is pack reference.

## 23. Turn order (p. 40) ✅

Finesse roll, high first, Warden rolls once for all enemies (the
table's own per-monster variant is already honoured — rule 5).
Surprise = narrative. Shipped: initiative declaration + roll-and-sort.

---

## The template vocabulary, audited

What existed after this survey, and whether it generalizes. **Taken
2026-08-11 against the old `SystemTemplate` row; the shapes generalized
and the HOME changed** — these are now record slots in a system folder's
`system.json` (`core/boot.ts` reads them; §M-6a's sibling-`*.json` rule
lets a long one have its own file). Two entries have moved on: `states`
is superseded by `kinds` + a declared `statuses` list (`core/kind.ts` —
there is no un-kinded bucket), and `groups`/`pins` were folded into the
panels grammar, which is now files rather than a key (§M-5a/5a′).

| Key | Carries | Verdict |
|---|---|---|
| `dice` | faces/values/reroll/slots | sound, general |
| `groups` | which fields sit in which block | sound |
| `accents` | trade → colour | sound, cosmetic |
| `pins` | field shown inside a counter panel | sound |
| `dials` | counter → face (`cylinder`) | sound; more faces will come (ace tally?) |
| `use` | costField / costCounter / consumesKind / actions | sound — Use Item, Attack, Aim, traps, Forstall sweep all fit it |
| `initiative` | roll field + direction | sound |
| `states` | condition vocabulary + thresholds | sound; mech Compromised fits it |
| `vocabulary` | words (gm, conditions, gear…) | sound |

**Gaps the survey exposed** (each small, none urgent):

1. **Effects beyond range pools.** Trap/Forstall/mech upgrades want to
   bump counters, counter MAXes, and inflicted-status text. One
   generic op ("adjust counter n / adjust max n") covers most; the
   rest is prose.
2. **Deferred Grit** (mounted weapons crewed mode: operator 2 pays
   next turn). No shape models a debt; may honestly be a table
   scribble.
3. **Entity question:** horses and mechs — characters with a `kind`,
   or items? They have Health, are targeted, persist, and are owned.
   Decide when the first table wants one, not before.
4. **Hidden per-monster data** (Kurtz Frequency) — bestiary fields
   already strip for public snapshots; just add the field.
5. **Per-turn state** stays local + derived (aim's refill-release);
   nothing needs the server to know about turns.
6. **Proposing macros** (town rest, Prestige spends) — multi-write
   proposals with one undo. The fire button is the proof this shape
   works; these are its bigger siblings.

## What the seat still owes the sheet

In the book's own front-side order: Skills ✅ · Health/Defense ✅ ·
Grit ✅ · Statuses ✅ · Weapons ✅ (+ ammo ✅, Aim ✅) · **Abilities ⬜
(next: prose + uses counters + the Ace tally)**. Back side: Prestige
🔶 (counters only) · Talents ⬜ · Reputation ⬜ · Inventory/Supplies 🔶
· Appearance/Disposition/History ⬜ (notes fields — cheap, if wanted).
