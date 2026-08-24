// The seat chrome's tab glyphs — ported from the old app
// (src/components/sheet/glyphs.tsx). Line drawings in the card's own
// style, one stroke weight, no fills, currentColor so they take the
// text's tone.
//
// The port shipped SIX of them, "trimmed to the marks the new stack's
// declared screens actually use" — and the trim was measured against
// screen icons only, while the `icons` record names a dozen more. A
// missing glyph draws nothing and says nothing, so Scrap sat in the
// purse as a bare number with a gap where its cog belongs (Brian,
// 2026-08-20, from the iPad). The set is cheap and the assignment is
// the system's: carry every mark a system might name, and let it
// choose.
//
// The set is teller's own; the ASSIGNMENT is the system's (`icons` in
// the template, or a screen's own `icon` — rule 2). A glyph name
// nothing here knows draws nothing, and the tab wearing it still works
// (see `Screens.tsx`'s bare-word fallback, ported into `SeatChrome`).

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const GLYPHS: Record<string, React.ReactNode> = {
  // A coin on its edge-lines: two circles and a stamped center.
  coin: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="5" />
      <path d="M12 9.5v5" />
    </>
  ),
  // A satchel: flap over body, strap stub below the buckle.
  satchel: (
    <>
      <path d="M4.5 9.5h15v9a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5v-9z" />
      <path d="M4.5 9.5 7 5h10l2.5 4.5" />
      <path d="M12 13v3" />
    </>
  ),
  // The sheet: a sheet of paper with a fold, ruled twice.
  sheet: (
    <>
      <path d="M6 3.2h8.5L18 6.7v14.1H6z" />
      <path d="M14.5 3.2v3.5H18" />
      <path d="M8.8 11.5h6.4M8.8 15h6.4" />
    </>
  ),
  // A revolver: barrel, cylinder, grip, trigger guard.
  sixgun: (
    <>
      <path d="M3.4 8.6h13.9v3.6H3.4z" />
      <circle cx="8.4" cy="10.4" r="1.5" />
      <path d="M17.3 9.4h3.3" />
      <path d="M11.6 12.2l-2.3 7.4a1 1 0 0 1-1 .7H6.6" />
      <path d="M5.2 12.2c.6 1.7 1.9 2.6 3.6 2.7" />
    </>
  ),
  // A star, five points — the sheriff's, and what an ability is worth.
  star: (
    <path d="M12 3.1l2.5 5.6 6.1.6-4.6 4.1 1.3 6-5.3-3.1-5.3 3.1 1.3-6L3.4 9.3l6.1-.6z" />
  ),
  // A cog: hub, ring, and eight teeth.
  cog: (
    <>
      <circle cx="12" cy="12" r="5.5" />
      <circle cx="12" cy="12" r="1.8" />
      <path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M6 6l2.1 2.1M15.9 15.9L18 18M18 6l-2.1 2.1M8.1 15.9L6 18" />
    </>
  ),
  // A hat, tipped: creased crown over a lens-shaped brim.
  hat: (
    <>
      <path d="M7 15.2C6.2 10.6 7.1 5.6 12 5.6s5.8 5 5 9.6" />
      <path d="M9 7.8q3 1.7 6 0" />
      <path d="M3 15.4c4 2.7 14 2.7 18 0" />
      <path d="M3 15.4c3.5-1.8 14.5-1.8 18 0" />
    </>
  ),
  // A card with a pip, and the corner of the one hidden behind it.
  card: (
    <>
      <rect x="8.6" y="3.4" width="10.8" height="17.2" rx="1.6" />
      <path d="M14 8.4l2.3 2.9-2.3 2.9-2.3-2.9z" />
      <path d="M6.4 6.2l-1.5.6a1.6 1.6 0 0 0-.9 2l3.1 9.5" />
    </>
  ),
  // A track in the dirt: pad and three toes.
  track: (
    <>
      <path d="M8 14.8c0-2.3 1.9-3.6 4-3.6s4 1.3 4 3.6-1.8 4.1-4 4.1-4-1.7-4-4.1z" />
      <ellipse cx="7.5" cy="8.9" rx="1.5" ry="1.9" />
      <ellipse cx="12" cy="7.3" rx="1.6" ry="2" />
      <ellipse cx="16.5" cy="8.9" rx="1.5" ry="1.9" />
    </>
  ),
  // A horseshoe, ends down, four nail holes.
  horseshoe: (
    <>
      <path d="M7.4 19.8v-7.2a4.6 4.6 0 0 1 9.2 0v7.2" />
      <path d="M8.5 13.1h.01M8.1 16.4h.01M15.5 13.1h.01M15.9 16.4h.01" />
    </>
  ),
  // A cartridge stood on its base. SOLID, unlike every other glyph
  // here: this one is read as a row that fills, and an outline doesn't
  // carry a bar.
  bullet: (
    <>
      <path
        fill="currentColor"
        stroke="none"
        d="M12 2.4c2.1 0 3.6 3.3 3.6 7.4v1.1H8.4V9.8C8.4 5.7 9.9 2.4 12 2.4z"
      />
      <path
        fill="currentColor"
        stroke="none"
        d="M8.4 12.4h7.2v8.2a1 1 0 0 1-1 1H9.4a1 1 0 0 1-1-1z"
      />
    </>
  ),
  // A hit: struck dead centre, and the strike radiating out of it.
  hit: (
    <>
      <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
      <path d="M12 3.2v3.4M12 17.4v3.4M3.2 12h3.4M17.4 12h3.4" />
      <path d="M6.2 6.2l2.4 2.4M15.4 15.4l2.4 2.4M17.8 6.2l-2.4 2.4M8.6 15.4l-2.4 2.4" />
    </>
  ),
  // An ace: the pip alone, which is how a card shows its rank at a
  // glance across a table.
  ace: (
    <path
      d="M12 3.4c2.4 3.4 7 6 7 9.4a3.4 3.4 0 0 1-5.9 2.3c.2 2 .7 3.4 1.5 4.5H9.4c.8-1.1 1.3-2.5 1.5-4.5A3.4 3.4 0 0 1 5 12.8c0-3.4 4.6-6 7-9.4z"
      fill="currentColor"
      stroke="none"
    />
  ),
  // A blank: the face that came up with nothing on it.
  blank: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M8.6 12h6.8" />
    </>
  ),
  // A spur: the rowel and the heel band it turns on.
  spur: (
    <>
      <circle cx="14.6" cy="12" r="3.4" />
      <path d="M14.6 5.6v2.2M14.6 16.2v2.2M8.2 12h2.2M18.8 12h2.2M10.4 7.8l1.6 1.6M17.2 14.6l1.6 1.6M18.8 7.8l-1.6 1.6M12 14.6l-1.6 1.6" />
      <path d="M7.4 6.2a7.6 7.6 0 0 0 0 11.6" />
    </>
  ),
  // The small things that ride in a pocket from the life before. A
  // drawer of them is picked from by SHAPE — twelve sentences in
  // twelve identical boxes is a wall of text, and the mark is what
  // makes one tile a locket and the next a horseshoe at a glance.
  // Drawn from the words rather than from anybody's page.

  // A letter, flap folded down.
  letter: (
    <>
      <rect x="3" y="5.6" width="18" height="12.8" rx="1.6" />
      <path d="M3.4 6.6l8.6 6 8.6-6" />
    </>
  ),
  // A homestead: roof, door, and a chimney with something in it.
  homestead: (
    <>
      <path d="M3.4 11.6L12 4.8l8.6 6.8" />
      <path d="M5.6 10.8v8.4h12.8v-8.4" />
      <path d="M10.2 19.2v-4.6h3.6v4.6" />
      <path d="M16.4 8.2V5.6h2.2v4.3" />
    </>
  ),
  // A poster, nailed up at the corners and curling.
  poster: (
    <>
      <path d="M5.4 3.8h13.2v14.4l-2.2 2h-11z" />
      <path d="M7.6 6.6h8.8M7.6 9.6h8.8M7.6 12.6h5.4" />
      <path d="M7 5.4h.01M17 5.4h.01" />
    </>
  ),
  // A pocket watch on its bow, hands at a quarter past.
  watch: (
    <>
      <circle cx="12" cy="13.6" r="6.8" />
      <path d="M10.6 3.6h2.8v2.6h-2.8z" />
      <path d="M12 9.8v3.8h3" />
    </>
  ),
  // And the marks a bundle of kit is told apart by — the one thing
  // only that bundle carries, rather than four variations on a
  // rucksack. Same gap as the drawer's, found on the same screen.

  // A compass: rose ring and a needle pointing off true north.
  compass: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M15.2 8.8l-2 4.4-4.4 2 2-4.4z" />
      <path d="M12 2.6v1.4M12 20v1.4M2.6 12H4M20 12h1.4" />
    </>
  ),
  // A lantern: bail handle, glass, and the flame inside it.
  lantern: (
    <>
      <path d="M9.4 3.6a2.6 2.6 0 0 1 5.2 0" />
      <path d="M7.6 6h8.8l-1 3.2v8.4H8.6V9.2z" />
      <path d="M6.8 20.4h10.4" />
      <path d="M12 11.4c1.4 1.2 1.8 2.4 1.2 3.4-.5.8-1.9.8-2.4 0-.6-1-.2-2.2 1.2-3.4z" />
    </>
  ),
  // A coil of rope: three turns and the working end hanging free.
  rope: (
    <>
      <ellipse cx="12" cy="8" rx="6.4" ry="3.2" />
      <path d="M5.6 8v3.4c0 1.8 2.9 3.2 6.4 3.2s6.4-1.4 6.4-3.2V8" />
      <path d="M5.6 11.6V15c0 1.8 2.9 3.2 6.4 3.2" />
      <path d="M12 18.2c1 1.4 2.4 2 4.2 1.8" />
    </>
  ),
  // A harmonica: the comb, its cover plate, and the reed slots.
  harmonica: (
    <>
      <rect x="2.8" y="8.2" width="18.4" height="7.6" rx="1.4" />
      <path d="M2.8 11.4h18.4" />
      <path d="M7 13.2v2.2M10.3 13.2v2.2M13.7 13.2v2.2M17 13.2v2.2" />
    </>
  ),
  // A palette with a brush laid across it.
  paints: (
    <>
      <path d="M11 4.6c4.4 0 7.8 2.9 7.8 6.4 0 2-1.6 2.6-2.9 2.6-1 0-1.8.6-1.8 1.6 0 1.4-1 2.2-2.6 2.2-4.3 0-7.8-2.9-7.8-6.4S6.6 4.6 11 4.6z" />
      <path d="M8 9.2h.01M11.6 7.8h.01M14.6 9.8h.01" />
      <path d="M16.4 19.6l4-4.6" />
    </>
  ),
  // A handkerchief, hung by one corner with a mark stitched in it.
  kerchief: (
    <>
      <path d="M12 3.8l7.4 7.4-7.4 7.4-7.4-7.4z" />
      <path d="M9.8 11.2h4.4M12 9v4.4" />
    </>
  ),
  // A folding knife, blade out of the handle.
  knife: (
    <>
      <path d="M3.6 15.4h11.6a4 4 0 0 0 0-8H8.4" />
      <path d="M3.6 15.4v2a1.4 1.4 0 0 0 1.4 1.4h9.4" />
      <path d="M8.4 7.4L5.2 10.6" />
    </>
  ),
  // A locket on its chain, hinged open a crack.
  locket: (
    <>
      <path d="M7.4 3.8l4.6 3.2 4.6-3.2" />
      <ellipse cx="12" cy="14" rx="5.4" ry="6.2" />
      <path d="M12 7.8v12.4" />
    </>
  ),
  // A dried flower, pressed flat.
  flower: (
    <>
      <circle cx="12" cy="7.6" r="2" />
      <path d="M12 5.6c0-2 1.4-3 2.8-2.2 1.3.8 1.2 2.6-.4 3.6M12 5.6c0-2-1.4-3-2.8-2.2-1.3.8-1.2 2.6.4 3.6" />
      <path d="M13.9 8.7c1.7-1 3.4-.5 3.5 1s-1.5 2.4-3.3 2M10.1 8.7c-1.7-1-3.4-.5-3.5 1s1.5 2.4 3.3 2" />
      <path d="M12 9.8v10.4" />
    </>
  ),
  // A fossil: the coiled shell every kid finds first.
  fossil: (
    <>
      <path d="M12 3.6a8.4 8.4 0 1 1-8.4 8.4A6.2 6.2 0 0 1 9.8 5.8 4.4 4.4 0 0 1 14.2 10a3 3 0 0 1-3 3" />
      <path d="M14.4 4.4l1.4 2.6M18.4 6.6l-1.8 2.2M20.2 10.4l-2.6.8" />
    </>
  ),
  // A crumpled note, creased across.
  note: (
    <>
      <path d="M5.8 4.4h9l3.4 3.4v11.8H5.8z" />
      <path d="M14.8 4.4v3.4h3.4" />
      <path d="M8 11.2l3.4 1.6-2.4 1.8 3.6 1.4" />
    </>
  ),
  // A quill — something of your own, and what the blank slot wears.
  quill: (
    <>
      <path d="M19.6 4.2c-6 .4-11 3.6-12.4 9.4l-2.4 6" />
      <path d="M19.6 4.2c.6 6.6-3 11.4-9.4 12.2" />
      <path d="M6.2 16.2h4.6" />
    </>
  ),
  // One die from the pool — a cube face with three pips. The fallback
  // a die budget wears when its system named no mark of its own.
  die: (
    <>
      <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="3.4" />
      <path d="M8.4 8.4h.01M12 12h.01M15.6 15.6h.01" />
    </>
  ),
  // The junk drawer: three chevrons, the universal "and the rest".
  more: (
    <>
      <circle cx="5.6" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="18.4" cy="12" r="1.3" />
    </>
  ),
};

export function Glyph({
  name,
  className = '',
  style,
}: {
  name: string;
  className?: string;
  /** Sizing for a caller that can't reach teller's utilities — shelf
   * code, whose classes are only styled if teller happens to use the
   * same ones (§L's second landmine). */
  style?: React.CSSProperties;
}) {
  const art = GLYPHS[name];
  if (!art) return null;
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} style={style} {...STROKE}>
      {art}
    </svg>
  );
}
