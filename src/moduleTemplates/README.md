# Module authoring guide

This folder is the lightweight “how to build a module” entry point.

Use it when you want to create or edit a single module file without carrying the whole codebase in context.

## Folder groups

- `audioEffects/`: audio DSP and filters
- `sequencers/`: clocked note generators and step grids
- `generators/`: input sources and note sources
- `noteTools/`: note-domain helpers such as chord builders, muxers, splitters, arps, repeats, and mergers
- `utility/`: general graph helpers that are not musical note tools

The folder name becomes the shop page when `shop.tab` is omitted.

## Core fields

Every module file should describe:

- `type`: unique module type for the file
- `label`: short in-panel title
- `category`: one of `osc`, `processor`, `drum`, `sequencer`, `utility`, `generator`
- `hue`: panel/jack accent color
- `shop`: display name, description, optional price, optional tab override
- `inputPorts` / `outputPorts`: note/audio/send jacks
- `defaultParams` / `paramDefs`: the knobs or selectors the panel needs
- `panelKind`: which existing panel to reuse, if any
- `runtimeType`: optional alias to an existing runtime implementation

## Note utility conventions

Use `noteTools` for nodes that work in note space instead of audio space.

Good fits:

- chord builders
- note mergers
- note multiplexers and splitters
- arpeggiators
- note repeats, stutters, and ratchets

Recommended parameter names:

- `mode`
- `rate`
- `gate`
- `swing`
- `pattern`
- `repeats`
- `steps`
- `spread`

## Special MIDI cases

These are built-ins, not usually user-authored modules:

- `midi-all`: global input source for all hardware and QWERTY/on-screen note input
- `midi-in`: per-device input source keyed by `deviceId`

If a custom generator file is just a wrapper around one of those behaviors, use `runtimeType` to reuse the built-in runtime.

For note tools that need timing behavior, `runtimeType` can point at a purpose-built note runtime like `noteArp`.

## Runtime alias rule

If the file is only a new label, tab, or layout for an existing behavior:

- keep `type` unique
- set `runtimeType` to the built-in behavior you want to reuse

If the file introduces new note behavior:

- keep the template self-contained
- add a matching runtime later

## Practical rule of thumb

- use `audioEffects` for audio processing
- use `sequencers` for clocked step/note emitters
- use `generators` for note sources
- use `noteTools` for all note transformation helpers
- use `utility` for everything else that is mostly graph plumbing
