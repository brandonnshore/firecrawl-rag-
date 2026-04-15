---
title: Landing cascade — back cards must snap, not fade, into the morphing pill
category: ui-bugs
component: landing/PinnedPromise
symptoms:
  - Ghost text ("Tea...", "PAGES") visible behind the forming pill
  - Cards 1-7 cross-fade with the darkening pill background instead of disappearing cleanly
tags: [scrolltrigger, gsap, scrub, opacity-transition, morph-animation]
files:
  - src/app/landing.tsx
related_commits:
  - 6a8e455
  - 5226497
date: 2026-04-15
---

## Symptom

In the pinned demo on the landing page, the cascade of 8 page cards collapses to the stage center (`merge=1`), and card 0 ("Home") morphs into a black ChatGPT-style composer pill. During the morph, the back cards (1-7), URL bar, and "Pages indexed" counter were visibly cross-fading **through** the darkening pill — you could see "Tea..." and "PAGES" text bleeding through a translucent gray shape.

## Root cause

The back items used `opacity: 1 - pillForm` with a 260ms `transition` on opacity. Because `pillForm` ramps from 0→1 over the same scroll range that card 0's background interpolates from white to black, the two animations overlapped: while the pill was at ~50% darkness, the back cards were at ~50% opacity. That's the ghosting.

The intent was for the back cards to be **gone** by the time the pill exists, so card 0 reads as the single morphing element.

## Fix

Snap back items to `opacity: 0` with `transition: none` the instant `pillForm > 0` (which fires the same frame `merge` reaches 1). Applied identically to `StageItem` (cards 1-7, counter) and `UrlBar`.

```tsx
// StageItem
const opacity = entryHidden || pillForm > 0 ? 0 : 1
// ...
transition:
  pillForm > 0
    ? 'none'
    : merge > 0
      ? 'opacity 260ms cubic-bezier(0.32,0.72,0,1)'
      : 'opacity 280ms cubic-bezier(0.32,0.72,0,1), transform 420ms cubic-bezier(0.32,0.72,0,1)',
```

The `transition: none` is load-bearing — without it, even an instant opacity change inherits the prior 260ms ease and the ghosting returns.

## Prevention

When a morphing element shares a scroll range with elements it visually replaces:

1. Decide the moment the morph "owns" the visual — usually when the geometric collapse (merge) completes.
2. Make the replaced elements snap out at that exact moment, not fade across the morph.
3. Set `transition: none` on the snap; don't rely on a "fast" transition.
4. Cross-fades only work when the incoming element is opaque from frame 1. A morphing element whose background is interpolating is **not** opaque.

## Related: card spacing

Same component, same session, separate commit (`5226497`): the cards looked too tightly stacked. Tuning notes for the rest layout:

- `CARD_PITCH` = `CARD_H + gap`. Original 48 (4px gap) felt cramped; 56 (12px gap) reads as discrete tiles.
- `REST_OFFSET.url` and `REST_OFFSET.counter` must be re-tuned alongside `CARD_PITCH` to preserve the same visual clearance above and below the stack — otherwise the URL bar overlaps card 0.
- `STAGE_H` must grow to fit the wider span. Formula: `2 * max(|url|, |counter|) + buffer`.
