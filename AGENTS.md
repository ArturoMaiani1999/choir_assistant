# Choir Assistant: repository instructions

## Frontend and UX

For every user-facing change, visual and interaction quality are acceptance
criteria at the same level as functional correctness.

Before editing the frontend:

1. Read `docs/product/ui-design-system.md` and the canonical document for the
   affected surface, if one exists.
2. Use the `frontend-skill` instructions when that skill is available.
3. State a visual thesis, a content hierarchy, and the interaction behavior.
4. Reuse the existing tokens and patterns. Do not introduce a new visual idiom
   for an isolated feature.

During implementation:

- Keep the music or primary task visually dominant.
- Prefer progressive disclosure over explanatory paragraphs.
- Prefer plain layout, dividers, and whitespace over nested cards.
- Give every view one clear primary action and use short Italian utility copy.
- Preserve keyboard access, visible focus, 44 px touch targets, reduced motion,
  and equivalent desktop/mobile behavior.
- Dialogs must support their explicit close control, `Escape`, and backdrop
  click unless closing would lose unfinished user data. A blocked close must
  explain the required decision briefly.

Before considering a frontend change complete:

- Run the closest browser smoke test.
- Inspect the result at 1366x768 and 390x844 when layout changed.
- Check the default state for clipping, unnecessary scrolling, competing
  actions, verbose copy, and unexplained visual inconsistency.
- Record any intentional exception in the relevant product document.

