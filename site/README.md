# site — teller.ink

The brochure (`docs/CORE-NEXT.md` §16). A static page that knows nothing
about teller as a program: no api, no build step, no framework, no
bindings. *teller.ink may carry bytes; it never runs the game.*

```
site/
  wrangler.jsonc     static assets only, its own worker (`teller-ink`)
  og.svg             source for public/og.png
  public/
    index.html       the page
    site.css         the one stylesheet
    site.js          the copy buttons, and nothing else
    404.html
    _headers         the content-security policy
    fonts/           three faces, with their licences
```

## The look

teller's own ink and brass, and one rule that draws every picture
(Brian, 2026-11-15, chosen over a ledger-paper direction and a
readout-panel direction):

> Anything you can touch at the table is **pale line**. Anything teller
> does is **lit brass**.

Dice, minis and terrain are outlines; every screen glows. It is the
thesis as a drawing, so a picture that breaks it is saying something
false about the product.

Type is Newsreader for display, Hanken Grotesk for reading and IBM Plex
Mono for anything typed. All three are SIL Open Font License (the
`OFL-*.txt` files beside them), and they are carried here rather than
linked so the page loads nothing from anyone else — which is also why
`_headers` can afford a policy with no third-party origin and no inline
script or style. Keep it that way: a new picture rides presentation
attributes and a class, never a `style=""`.

## Working on it

```sh
wrangler dev --config site/wrangler.jsonc      # serves with the real headers
wrangler deploy --config site/wrangler.jsonc   # publishes to teller.ink
```

Any static server works for a look; only `wrangler dev` applies
`_headers`, so that is the one that proves the policy still holds.

The social card is drawn from the hero. After changing either:

```sh
rsvg-convert site/og.svg -o site/public/og.png
```

with Newsreader (72pt) and IBM Plex Mono installed as desktop fonts —
librsvg reads system fonts, not the web files in `public/fonts`.

## What it must stay true to

The page quotes the product: the six screen roles, what `teller host`
prints, the install line. When one of those changes, this page is now
wrong in public. The install line in particular hands a stranger
whatever the tap's formula currently points at.
