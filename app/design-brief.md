# WaveScope design brief

## Design read
For desktop music listeners and multi-monitor tinkerers who want idle screens to behave like laboratory instruments: precise, technical, quietly playful.

## Concept spine
**The site is a signal laboratory.** Every section reads like a calibrated instrument panel: graph-paper grids, monospace channel readouts, phosphor traces, framed black screens that look like physical test equipment sitting on white paper.

## Delivery tier
**cinema.** Marketing page for a real product with a live interactive centerpiece.

## Locked palette
- Mist paper `#F2F4F1` (page ground, cool light gray-green white)
- Ink `#121714` (text, green-cast near-black, never pure #000)
- Ultramarine `#3346C9` (the ONE accent: traces, CTAs, readouts)
- Instrument black `#0B0D0C` (product surface only: visualizer canvases and framed device panels)

Defense: a light Swiss-laboratory ground with ultramarine traces inverts the neon-on-black visualizer cliché (banned family 2) and makes the black canvases read as physical instruments placed on paper. Derived from the material world: graph paper, phosphor oscilloscope traces, anodized test gear, BNC cables.

Anti-convergence axes (first build this chat, derived from material world): palette = lab paper + ultramarine; type = Satoshi + JetBrains Mono; hero architecture = image-as-canvas instrument panel; Tier-1 = C2 live particle canvas; CTA garments = framed block + underlined mono inline; corner language = sharp with hairline rules.

## Locked type
- Display + UI: **Satoshi** (clean grotesk, tight tracking)
- Readouts, labels, specs: **JetBrains Mono**
- No serif anywhere.

## Tier-1 technique
**C2, particle canvas (canvas/pixel family).** The hero IS a running WaveScope visualizer: a full-width framed instrument panel whose canvas samples the generated hero artwork into a particle waveform field, idling on a built-in demo signal and bending toward the visitor's cursor; one click arms the microphone so the hero visualizes the visitor's own room.

Defense: the spine is "signal laboratory" and C2 makes the visitor the signal. The product demonstrates itself with its own math.

Contracts: frame 1 paints the composed particle field immediately (screenshot-safe); `prefers-reduced-motion` renders the composed static field with no animation loop; mobile drops cursor physics for touch and scales particle count by `devicePixelRatio` and core count.

## Section plan (6 sections, 5 layout families, eyebrow budget 2)
1. **Hero**: image-as-canvas instrument panel, text bottom-left over the panel edge. Family: full-bleed canvas hero.
2. **Signal inputs**: asymmetric split; left lead copy, right stacked channel cards (System audio, Microphone, Audio file, Demo oscillator) with mono readouts. Anchor: top-left lead.
3. **Visualizer gallery**: gapless grid of LIVE mode thumbnails (real canvases running the actual math at low res) on black instrument screens. Anchor: stacked center header.
4. **Control room** (multi-monitor + 8K): the single material switch: full-bleed ink-black band, oversized metrics strip (displays, 7680x4320, 60 fps), studio desk imagery. Anchor: centered statement.
5. **Quickstart**: vertical rhythm rail, 4 numbered steps along a hairline. Anchor: off-grid offset.
6. **Footer CTA**: framed banner block plus minimal footer. Anchor: inverted classic.

Second-read moment: the section-4 material switch (placed once).

## Asset plan
- Hero artwork, 2 candidates (macro phosphor-trace light sculpture, ultramarine on black) as particle source + panel poster.
- Section plates: fine graph-paper texture (light), control-room atmospheric plate (dark).
- Content imagery: studio desk with three glowing monitors (control room), macro studio monitor speaker (inputs).
- Custom icon set: 8 glyphs (speaker, mic, file, sine, monitor, fullscreen, gauge, keys), 2px stroke, ink on white, sliced + background-removed.
- Logo monogram: W-as-waveform mark; favicon head kit derived from it.
- OG image 1200x630 in brand language.
- No video: Tier-1 is the live canvas, not a scrub.

## CTA inventory
- **Launch WaveScope** (primary; hero + footer band, one label page-wide): framed rectangular block, hairline ultramarine border; on hover an ultramarine trace sweeps across the fill; `:active` scale 0.98.
- **Read the manual** (secondary; hero + nav): underlined inline JetBrains Mono link with arrow; underline draws left-to-right like a sweep on hover.
- Gallery cards: the whole card is pressable and launches that mode in /viz (interaction identity: screen glow lifts on hover, no button chrome).

## Product surfaces (beyond the landing page)
- `/viz`: the instrument itself. Instrument-black UI, mono readouts, auto-hiding control deck, fullscreen + multi-display controls.
- `/docs`: the manual on paper ground: inputs, all visualizer modes, resolution, multi-monitor, shortcuts, browser support.

## Copy rules honored
No em/en dashes anywhere, headlines under 8 words, one CTA label per intent, no filler verbs, no invented marketing stats (product spec facts like 7680x4320 are real capabilities).
