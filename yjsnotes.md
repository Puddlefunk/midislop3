Core idea

Treat the whole patch as a shared document:

nodes
connections (cables)
parameters

All live inside a single Yjs doc, automatically synced.

Data structure (practical schema)
Root
const doc = new Y.Doc()

const patch = doc.getMap("patch")
patch.set("nodes", new Y.Map())
patch.set("connections", new Y.Map())
1. Nodes

Each node = a module (osc, filter, env, etc.)

nodes.set(nodeId, new Y.Map({
  type: "oscillator",
  position: { x: 120, y: 300 },
  params: new Y.Map({
    frequency: 440,
    detune: 0,
  }),
  inputs: ["in1"],
  outputs: ["out1"]
}))
Why this works
Every param is independently synced
Two users tweaking different knobs = no conflict
Same knob at once = last-write-wins (usually fine for UI)
2. Connections (cables)

Treat cables as first-class objects:

connections.set(connId, {
  from: { node: "osc1", port: "out1" },
  to: { node: "filter1", port: "in1" }
})
Important
Use unique IDs for cables
Never store connections inside nodes → avoids merge chaos
3. Parameter automation (optional but powerful)

If you want timeline / modulation later:

params.set("frequency", {
  base: 440,
  automation: new Y.Array([
    { time: 0, value: 220 },
    { time: 1, value: 880 }
  ])
})
4. Presence (NOT in Yjs)

Things like:

cursor positions
“user is dragging cable”
selection highlights

👉 Do this via PartyKit, not Yjs

Yjs = persistent shared state
PartyKit = ephemeral realtime signals

Sync layer (how it connects)

Typical flow:

const provider = new WebsocketProvider(
  "wss://your-partykit-server",
  "room-id",
  doc
)

PartyKit just relays updates — Yjs handles merging.

Subtle design decisions (these matter)
1. Use Maps, not plain objects

Yjs only tracks changes properly in its own types.

2. Flat structure > nested chaos

✅ Good:

nodes: { id → node }
connections: { id → connection }

❌ Avoid:

node.connections = [...]

(flat = fewer merge edge cases)

3. IDs must be stable

Use:

uuid
or deterministic IDs if needed

Never reuse IDs after deletion.

4. Deletion is easy
nodes.delete(nodeId)
connections.delete(connId)

Yjs propagates cleanly.

What you get “for free”
multiplayer editing
undo/redo (with Y.UndoManager)
offline editing + resync
conflict resolution without thinking about it
Where this breaks (so you plan ahead)

Yjs is NOT good for:

real-time audio processing sync
strict ordering (like game ticks)
authority (who “wins” in gameplay)

That’s where PartyKit steps in if needed.

Clean mental split for your system
Patch graph (state) → Yjs
Audio engine (execution) → local per client
Session / presence / events → PartyKit