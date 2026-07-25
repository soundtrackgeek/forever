# Midnight Radio v0.0.3 implementation QA

- Source visual: `design/concepts/03-midnight-radio.png`
- Connected-shell screenshot: `design/implementation/midnight-radio-0.0.2.png`
- First Connection screenshot: `design/implementation/first-connection-0.0.3.png`
- Connection settings screenshot: `design/implementation/connection-settings-0.0.3.png`
- Minimum-window screenshots:
  `design/implementation/first-connection-0.0.3-minimum.png` and
  `design/implementation/connection-settings-0.0.3-minimum.png`
- Viewport: 1584 × 992 CSS pixels
- Source dimensions: 1584 × 992
- Implementation dimensions: 1584 × 992
- Browser scale: 1× CSS density
- Compared state: default Search view, `night geometry` results, first release selected, three active transfers
- Render method: live Vite application opened and exercised in the in-app browser

## Required fidelity surfaces

- Layout: passed — the 198 px navigation rail, 1020 px search workspace, 366 px release inspector, 33 px title bar, and 155 px transfer shelf preserve the source frame and hierarchy.
- Spacing: passed — the network toolbar, featured release, results toolbar, result rows, inspector sections, and footer actions maintain the source density and alignment.
- Typography: passed — compact neutral sans-serif copy, restrained weights, amber micro-labels, and violet secondary labels reproduce the intended hierarchy.
- Colors and surfaces: passed — near-black indigo canvas, violet selection, amber actions, hairline borders, shallow radii, and low-contrast dividers match the Midnight Radio language.
- Imagery: passed — generated production assets preserve the moon, monolith, water, violet, indigo, and amber art direction at the required crops without placeholder or CSS art.
- Icons: passed — all visible controls use a consistent Phosphor icon family with matched light/regular weights.
- Behavior: passed — search submission and empty state, filters, list/grid switching, release selection, queuing, pause/resume, navigation, updater states, onboarding advanced fields, simulated connection transitions, live profile status, and connection settings were exercised.
- Accessibility: passed — controls expose semantic names, modal semantics, image alternatives, visible focus treatment, keyboard search, and reduced-motion handling.
- Responsiveness: passed — the exact target viewport and the Tauri minimum window size of 1024 × 680 were tested with no document overflow. Onboarding fits without internal scrolling; connection settings use one intentional vertical scroll region at minimum size.

## v0.0.3 visual comparison

1. The 198 px navigation rail, central search workspace, 366 px release inspector,
   33 px title bar, and transfer shelf remain aligned with the accepted source.
2. The connected state retains the source’s top-left green signal, search field,
   content hierarchy, selected Search item, violet result accents, and amber
   download action.
3. Featured and inspector artwork preserve the source’s moon/monolith crops,
   while table thumbnails, transfer art, and avatar remain visually coherent.
4. Typography keeps the same compact neutral sans hierarchy, amber uppercase
   micro-labels, restrained weights, and violet metadata.
5. The First Connection and settings additions keep the same near-black indigo
   surfaces, shallow radii, hairline borders, amber guidance accent, violet
   controls, and low-noise information density.
6. The account-registration note aligns to the form grid instead of interrupting
   it, and the cadence selector sits inside the existing maintenance card rather
   than adding another competing panel.

## Comparison history

1. Pass 1 found the inspector source profile below the visible fold because track and availability blocks were taller than the reference.
2. Track density, availability line-box behavior, and profile padding were corrected. The source profile now aligns above the fixed action footer.
3. Final side-by-side comparison confirmed the primary grid, title/search placement, artwork crops, featured release, results density, release inspector, and transfer queue are visually aligned.

## Intentional deviations

- The reference player transport is represented by a transfer-focused shelf because playback is outside the v0.1.0 vertical slice.
- The original concept artwork was regenerated as a production-safe asset in the same visual direction, so moon and monolith geometry are not pixel-identical.
- The First Connection overlay and settings workspace are additive pre-alpha
  surfaces; neither existed in the single-screen concept.
- Sidebar collapse and theme controls remain deferred; connection, diagnostics,
  and update affordances are functional.

## Copy review

The connected source copy is intentionally unchanged: “Across the network,”
“Rare find,” result language, and transfer labels retain the approved
radio/signal metaphor. New copy is limited to connection truth and actions:
“First connection,” “Tune into Soulseek,” state-specific network labels,
credential-storage explanations, reconnect diagnostics, and settings controls.
No visual-heading copy from the accepted search screen was rewritten.

The v0.0.3 copy addition is intentionally literal rather than metaphorical:
“Why almost any login works” and “Unused usernames are registered
automatically” explain Soulseek’s implicit account creation at the exact point
where it can otherwise look like failed validation. The only visual deviation
is the added amber information strip and the native cadence selector; both use
the accepted Midnight Radio tokens and spacing.

## Final result

passed
