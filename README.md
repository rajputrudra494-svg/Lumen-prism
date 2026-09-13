# Lumen Path

A browser puzzle game about bending real light. Place mirrors, prisms, lenses and
filters on an optical bench so that every sensor receives the beam it is asking
for — the right colour, the right brightness, sometimes at the right moment.

The optics are not faked. Reflection is the vector form `R = D − 2(D·N)N`,
refraction is Snell's law with a per-wavelength Cauchy index, and a prism throws
a spectrum because blue genuinely has a higher index than red — not because
something draws a rainbow.

**Open `index.html`.** No build step, no install, no server required.

---

## Contents

- [Playing](#playing)
- [Controls](#controls)
- [The physics](#the-physics)
- [The bench and the light](#the-bench-and-the-light)
- [Phones](#phones)
- [Project layout](#project-layout)
- [Tests](#tests)
- [Levels](#levels)
- [Level editor and sharing](#level-editor-and-sharing)
- [Daily challenge](#daily-challenge)
- [Multiplayer](#multiplayer)
- [Where a backend would plug in](#where-a-backend-would-plug-in)
- [Accessibility](#accessibility)
- [Performance](#performance)
- [Known limits](#known-limits)

---

## Playing

Open `index.html` in any modern browser. It works from the filesystem; if you
would rather serve it:

```bash
python -m http.server 8123
```

then visit `http://localhost:8123`.

There are no external assets, no CDN, no ES modules and no `fetch` calls, so
nothing about the filesystem origin breaks. The one caveat is that a few
browsers refuse `localStorage` on `file://`; the game plays fine either way, but
it will not remember progress, and the settings screen says so when that
happens.

Pick a piece from the tray, tap the bench to place it, then drag the knobs on
the piece itself to aim — there is no side panel; every control lives on the
selected piece. A sensor lights when the light arriving at it satisfies its requirement.
Stars are awarded for solving at or under par:

| Stars | Condition |
|-------|-----------|
| ★☆☆ | Solved at all |
| ★★☆ | Within one object of par |
| ★★★ | At or under par on **both** objects and interactions |

Using a hint caps that level at two stars.

---

## Controls

Select a piece and its controls appear around it:

| Control | Action |
|---|---|
| Drag the piece | Move |
| **Blue knob** | Rotate — **Shift** snaps to 15°, **Ctrl/Cmd** to 45°; on touch, angles settle onto 15° steps when within 2.5° |
| **White end knobs**, or scroll | Resize |
| **Amber knob** | Flex a curved mirror or lens |
| **Green knob** (beam splitter) | Slide the reflect/transmit ratio · or `+` `−` |
| **Red × badge** | Return the piece to the tray · or `Delete` |
| **⇄ badge** (one-way mirror) | Flip the mirrored face · or `F` |
| **↻ badge** (filter) | Next colour · or `C` |
| **n badge** (prism, glass, lens) | Next type of glass · or `M` |
| Two-finger pinch / twist | Resize and rotate (touch) |
| Arrow keys | Nudge — **Shift** for fine |
| `[` `]` | Rotate 1° — **Shift** for a quarter degree |
| `,` `.` | Shrink / grow |
| Double-click (mouse) | Return a piece to the tray |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `R` · `H` | Reset the level · hint |
| `Esc` | Close a panel, or cancel placement |

Colours and glass that a level hands you are part of the puzzle, so their
badges are hidden on those pieces.

While you drag, a dashed preview line shows where the beam will end up, so you
can aim without letting go and checking.

---

## The physics

Everything below is implemented in `src/optics/`, in about 2,000 lines of
commented vector maths. There is no third-party physics engine anywhere in the
light path.

**Reflection.** `R = D − 2(D·N)N`. Because it is the vector form, angle of
incidence equals angle of reflection at *any* mirror rotation with no special
cases. Curved mirrors use the true radial normal of their arc, so a concave
mirror converges a parallel bundle at the mirror-equation focal point — midway
between the vertex and the centre of curvature — as an emergent result rather
than a scripted one.

**Refraction.** Snell's law in vector form. The refractive index comes from
Cauchy's equation `n(λ) = A + B/λ²`, so every material has real dispersion.
Total internal reflection happens exactly where the discriminant goes negative,
which is the critical angle. Every interface also gets a Fresnel-weighted
partial reflection (Schlick), which is why glass shows a faint ghost at glancing
angles and almost none head-on.

**Dispersion.** White light entering a dispersive medium splits into nine
monochromatic bands, each refracting at its own index. After that they are
independent rays — you can pick one out of the fan with a mirror, or filter the
rest away. Flint glass (`B = 0.00743`) throws a visibly wider spectrum than
crown (`B = 0.00420`), and the game uses that difference.

**Beam splitting.** A half-silvered plate produces a reflected and a transmitted
child with the energy divided by its ratio, which the player can dial.

**Attenuation.** Three independent multiplicative losses — distance through air,
per-chapter fog, and Beer–Lambert absorption inside glass — plus a per-surface
loss at every interaction. A beam that falls below the intensity threshold fades
out and stops triggering sensors, which is the entire subject of the Sunken Reef
chapter.

**Colour.** Beams carry an RGB triple and mix additively at a sensor, so red and
green really do land as yellow. Sensors can require a colour, a wavelength band,
a minimum brightness, a maximum brightness, a beam count, or a polarisation.

**Polarisation.** Malus's law, `I = I₀cos²θ`. Unpolarised light loses exactly
half at the first filter. Two crossed polarisers extinguish completely — and
level 31 is the three-polariser paradox, where inserting a *third* filter at 45°
between two crossed ones makes light reappear.

**Diffraction.** The grating equation `d·sinθ_m = m·λ`, evaluated per order.
Orders that would need `|sinθ| > 1` are evanescent and simply do not appear.

**Propagation.** The tracer walks the ray tree breadth-first, so branches
resolve in bounce order. That gives a natural budget (drop the deepest branches
first) and means segments arrive already sorted for the travelling-light
animation, so a splitter visibly forks in the right sequence.

### Optical objects

| Object | Behaviour |
|---|---|
| Flat mirror | Specular reflection |
| Concave mirror | Converges a bundle to a real focus |
| Convex mirror | Diverges a bundle into a fan |
| Flex mirror | Player-adjustable curvature, concave → flat → convex |
| Prism | Refracts and disperses; selectable glass |
| Lens | Converging or diverging, focusing by refraction alone |
| Glass block | Freeform refractive solid, arbitrary polygon |
| Beam splitter | Reflects and transmits, adjustable ratio |
| Colour filter | Passes matching wavelengths, absorbs the rest |
| Polarising filter | Malus's law; rotating it gates the beam |
| Diffraction grating | Splits into spectral orders |
| One-way mirror | Mirrored on one face, clear from behind |
| Portal | Teleports a beam to its twin with an adjustable exit angle |
| Absorber | Stops light dead |

### Moving parts

`src/engine/props.js` is a small purpose-built rigid-body layer — not a physics
engine — that drives element transforms only, so the optics solver never knows
anything is moving.

- **Pendulum** — integrates `θ'' = −(g/L)sinθ − bθ'` without the small-angle
  approximation, because at the amplitudes these puzzles use a real pendulum is
  measurably slower than the linearised one. You do not steer it; **where you
  drop it sets the release angle**, and it can only hold a beam on target at the
  top of its swing, where it is momentarily still.
- **Turntable, track, orbit** — constant rotation, eased linear travel, circular
  paths.
- **Beat mirror** — steps a fixed angle on each beat and rests in between; the
  rest is your window.
- **Thermal mirror** — absorbs a fraction of every beam that lands on it. Past
  an onset threshold the substrate bows and the reflected bundle fans out. The
  threshold matters: without it, throttling the beam would just trade brightness
  for flatness at a fixed rate. With it, there is a real power budget to stay
  under, and "send it less light" becomes a decision.

---

## The bench and the light

The pieces sit on a wooden optical bench in a dim room, and the room is lit by
the beams themselves.

**The wood is grown in code**, once per chapter, in `src/engine/bench.js` —
there are still no image files, so the game works offline and off the
filesystem. A flat-sawn board shows growth rings sliced at a shallow angle,
which is a sine of the across-grain position displaced by slow noise. The
costly noise is evaluated on a coarse grid for one long board; the table is
then assembled from that board with random offsets, flips, lengths and stain
per plank, and finished with seams, end joints, knots and a varnish sheen. It
builds in about 15 ms. Each chapter has its own species and room light — maple
under cool lab light, walnut by moonlight, charred cedar in the Spire, limed oak
under violet in the Event Horizon.

**Lighting is a multiply pass.** A low-resolution light map holds the room's
faint ambient, a hanging lamp, the pool each beam throws onto the boards, the
splash where it strikes something, and the spill from each lamp's lens. That
map is blurred and multiplied over the table, so the wood is only as bright as
the light reaching it — a beam visibly lights up the boards it crosses.

**Beams are drawn as scattered light**, not lines: a crisp core, a halo, and a
scattering shaft that widens with distance, plus dust motes that glint only
where a beam passes through them. Scattering strength follows the chapter's fog
coefficient — the same number the tracer attenuates by — so a room where you
can see more of the beam from the side really is a room that costs more light.
Strong beams are tone-mapped (`1 − e^(−1.2 I)`) so several lamps on one path
glow rather than burn out to flat white.

**This is rendering, not physics.** The tracer still decides exactly where each
ray goes and how much energy reaches each sensor; what lights a sensor is always
the crisp core, never the glow around it. That is why all 75 levels still verify
unchanged.

Hardware is drawn as the real thing: silvered glass whose reflected highlight
slides as the mirror turns, brass cap screws, black anodised clamps and ring
mounts, glass with polished edges and internal reflections, a holographic sheen
on the grating, lamp housings with cooling fins and a lens flare, and brass
photocells under glass domes. Everything casts a soft shadow away from the work
light — rotated by hand when the stage is turned, since canvas shadow offsets
ignore the transform.

---

## Phones

- **The stage fits around the HUD.** The renderer measures the real HUD and tray
  boxes and fits the world inside what is left, so no lamp or sensor can sit
  under a button on any screen.
- **Portrait turns the stage sideways** instead of letterboxing a 16:9 world
  into a strip — about 2.9× the playable area. Only the drawing rotates; text is
  counter-rotated to stay upright. Pendulum levels stay upright, because their
  gravity has a visible direction.
- **Landscape moves the tray** into a rail down the right-hand edge, and the HUD
  collapses to one row.
- **Handles are sized in screen pixels**, with larger targets and hit areas for
  touch, so they are equally grabbable at any zoom.
- Optional vibration when you place a piece or light a sensor; phones default
  to the medium glow setting to spare the battery.

A frame draws in under 1 ms on a desktop and about 3 ms on an emulated phone.

---

## Project layout

```
index.html              Everything loads from here. No build step.
styles/main.css

src/
  math/vec2.js          Vector maths, reflect(), refract(), seeded PRNG
  optics/
    spectrum.js         Wavelength ↔ RGB, additive mixing, colourblind encoding
    materials.js        Cauchy dispersion, absorption, Fresnel, critical angle
    geometry.js         Ray/segment, ray/arc, ray/polygon, ray/AABB intersection
    elements.js         The 14 optical object types and their interactions
    raytracer.js        Breadth-first ray propagation with budgets
  engine/
    props.js            Pendulum, turntable, track, orbit, beat, thermal drift
    scene.js            Level runtime, receiver evaluation, stars, undo snapshots
    bench.js            Procedural wooden tabletop and dust motes
    renderer.js         Canvas 2D: table, light map, hardware, scattered light, overlay
    input.js            Pointer, touch and keyboard; gizmos and gestures
    audio.js            Web Audio synthesis — no audio assets
    storage.js          localStorage with in-memory fallback; backend stubs
    history.js          Undo / redo
  game/
    authoring.js        Level-authoring helpers, including the tracer probes
    levels.js           75 levels across 11 chapters
    share.js            URL-safe level codes
    daily.js            Procedural daily challenge
    replay.js           Ghost replay and clip export
    net.js              Co-op and versus over a pluggable transport
    editor.js           Level editor
    ui.js               All chrome
  main.js               Game controller and loop

server/relay.js         Zero-dependency WebSocket relay for multiplayer
tools/                  Test and authoring tools (Node)
```

The game ships as **classic scripts sharing one `LP` global**, not ES modules.
That is deliberate: `index.html` then works when opened straight off the
filesystem, and the identical source files can be loaded into Node by the test
tools with no shim and no build.

---

## Tests

```bash
node tools/test-optics.js    # 137 physics assertions
node tools/verify.js         # every level is solvable
node tools/test-content.js   # dailies, share round trips, editor, difficulty proofs
node tools/test-relay.js     # multiplayer protocol (needs the relay running)
```

`test-optics.js` checks the solver against **closed-form answers**, not
snapshots — Snell's law, Malus's law, the grating equation, the mirror equation,
Beer–Lambert, energy conservation across a splitter, and a pendulum period
against the finite-amplitude correction `T ≈ T₀(1 + θ₀²/16)`. A regression shows
up as a number that no longer matches theory.

`verify.js` is the important one for content. For all 75 levels it checks that
the level loads, is **not** already solved with nothing placed, that the shipped
reference solution fits the declared inventory, that replaying it lights every
sensor, that it earns three stars so par is actually achievable, and that the
trace stays inside the per-frame performance budget. Timed levels are simulated
forward until they solve.

`test-content.js` goes one step further for the hard chapters and proves their
difficulty, not just their solvability: that an even split really does leave
Split Decision's hungry sensor short, that no single polariser at any of 91
angles unlocks Polar Lock, that removing any lamp from the Event Horizon leaves
its gate shut, and that leaving Thermal Runaway's splitter at its default
overheats the mirror.

Authoring aids:

```bash
node tools/probe.js '<json>'   # trace an arrangement and print every segment
node tools/timeline.js clk-43  # step a moving level through time
```

### How levels are guaranteed solvable

Mirror puzzles are authored as a **polyline the light should walk**, and the
mirror angle at each waypoint is solved in closed form: the normal must bisect
the incoming and outgoing directions, so `N = normalise(out − in)`. Substituting
that back into the reflection formula returns `out` exactly. The puzzle is
therefore generated *from* a known-good solution rather than the other way
round.

Levels involving focus, dispersion or teleportation cannot be solved by
trigonometry alone, so they **probe the real tracer at load time** — running a
scratch scene to find where a bundle actually converges, or where the 470 nm
band actually lands — and place their sensors on that measured point.
Brightness thresholds are likewise expressed as a fraction of the energy the
arrangement genuinely delivers, so a level can never demand more light than
physics can supply.

---

## Levels

75 levels: 71 story levels across 10 themed chapters, plus 4 sandboxes. The
first eight chapters each introduce one optical idea, use it several ways, then
combine it with the previous chapter's. The last two introduce nothing new —
they take the slack out. Boss levels sit at every tenth stage — 10, 20, 30, 40,
50, 60 and 70 — plus a chapter-ending boss at 63 and the final boss at 71.

| Chapter | Teaches |
|---|---|
| The Lab | Reflection, resizing, placement zones, attenuation |
| The Observatory | Curved mirrors, focusing, off-axis gathering |
| Crystal Caves | Refraction, total internal reflection, dispersion |
| Sunken Reef | Absorption, fog, colour filters, budgets |
| Neon Quarter | Beam splitting, one-way glass, polarisation |
| Deep Space Relay | Portals, diffraction gratings, photon budgets |
| Clockwork Tower | Turntables, pendulums, rails, rhythm, timing |
| Aurora Fields | Heat management and full additive colour mixing |
| **Obsidian Spire** | Precision: tight bays, alarms beside the obvious route, decoy gates, dialled split ratios |
| **Event Horizon** | Mastery: relayed focus, Malus in small steps, diffraction orders, synchronised motion, a power budget |
| Open Bench | Four sandboxes with no goals at all |

The two hard chapters, level by level:

| # | Level | The catch |
|---|---|---|
| 56 | Needle's Eye | Six turns through three offset gaps, inside narrow bays |
| 57 | Tripwire | Four alarms leave only narrow corridors over and under a block |
| 58 | Prismatic Relay | Pluck both ends of one rainbow and send them to opposite corners |
| 59 | Split Decision | Four sensors; an even split cannot feed the hungriest |
| 60 | **The Obsidian Engine** (boss) | Red + green to a yellow gate, white filtered to blue, an alarm on the lazy route |
| 61 | Portal Maze | Sealed rooms joined only by gates — one of them a trap |
| 62 | Moving Target | Feed a turntable, then wait for it to line up with a slot |
| 63 | **Crown of the Spire** (boss) | Split, filter, disperse and fold, with two alarms watching |
| 64 | Gravity Well | An alarm sits exactly where the dish focuses; relay the cone past it |
| 65 | Polar Lock | One polariser between crossed ones is no longer enough; two, evenly spaced, are |
| 66 | Lightspeed | Six turns through fog with 85% of the best route's light required |
| 67 | Spectral Weave | Send the red of one diffraction order and the violet of the other home |
| 68 | Clockwork Singularity | Two turntables that agree only for a moment every ten seconds |
| 69 | Thermal Runaway | A split ratio window about 0.2 wide between overheating and starving |
| 70 | **Accretion Disk** (boss) | White in, three pure colours out, an alarm under the green line |
| 71 | **Event Horizon** (final boss) | Three primaries through one gate in a sealed wall, balanced to mix white |

Chapters unlock every 12 stars.

---

## Level editor and sharing

**Editor → build → test play → save answer → share.**

The editor works on a live scene, so the beam updates as you build. It will not
let you publish a broken level: `validate()` refuses a level that is already
solved with nothing placed, that has an unlinked portal, or whose stored answer
no longer works. To attach a reference answer you **solve your own level in test
mode** and press *Save answer*, which captures what you did — so shared levels
carry the same solvability guarantee the built-in ones do.

Sharing produces a URL with the level in the fragment:

```
index.html#lvl=<base64url>
```

A fragment rather than a query string, so the code never leaves the browser as
part of a request. Typical levels come out at 300–600 characters. Incoming codes
are untrusted input and are structurally validated and range-clamped before they
reach the engine.

---

## Daily challenge

One procedurally generated level per UTC day, identical for everyone, ranked on
fewest objects then fewest interactions.

The generator uses the same guarantee as the hand-made levels: it builds a
randomised light path first and solves for the mirrors that walk it, then runs
every candidate through the real tracer and rejects degenerate layouts (objects
overlapping, pieces jammed against the frame, a free win) before accepting one.
`tools/test-content.js` generates and verifies **two years** of dailies on every
run; none has ever needed the fallback.

---

## Multiplayer

Two modes, over a pluggable transport:

- **Co-op** — the inventory is split between the players. Neither can solve the
  level alone because neither has all the pieces.
- **Versus** — one shared beam, one sensor each, first to light theirs wins.

**Hotseat needs nothing.** For online play, run the relay:

```bash
node server/relay.js          # listens on ws://localhost:8787
PORT=9000 node server/relay.js
```

then enter its address and a room code in the Multiplayer panel.

The relay is deliberately dumb: it forwards JSON between members of a room and
has no idea what a mirror is. That works because the simulation is
deterministic — both clients run the identical tracer over the identical
placements and agree on the beam without a referee. It has zero dependencies and
speaks just enough of RFC 6455 to do the job.

The trade-off is the usual one for a trusted-peer design: a modified client
could lie about its placements. For a co-operative puzzle played with someone
you invited by room code, that is the right trade. If you need authoritative
play, the place to add it is the relay: keep the scene server-side, run
`src/optics/` under Node exactly as `tools/verify.js` does, and validate each
`place`/`move` before rebroadcasting.

---

## Where a backend would plug in

Everything persists to `localStorage` (with an in-memory fallback, and the
settings screen warns you when the browser is blocking storage). Two features
are specified as online, and both route through **`LP.Storage.remote`** in
`src/engine/storage.js`, which is a no-op stub by default.

Set `LP.Storage.remote.endpoint` to a base URL and these become live requests:

```
POST <endpoint>/scores    { levelId, seed, objects, bounces, ms, name }
GET  <endpoint>/scores?levelId=..&seed=..&limit=50   → [{ name, objects, bounces }]
POST <endpoint>/levels    { code, title, author }    → { id }
GET  <endpoint>/levels/:id                           → { code, title }
```

Nothing else in the codebase needs to change. The daily screen already renders a
global board when one is available and explains the local-only fallback when it
is not. A leaderboard service would sit alongside `server/relay.js`; the daily
seed is the UTC date string, so the server can regenerate and validate any
submitted run using the same `src/game/daily.js`.

---

## Accessibility

- **Colourblind mode** encodes every beam colour as a dash pattern *and* a
  glyph, so hue is never the only channel carrying meaning. Colour-requiring
  sensors show their symbol.
- **Reduced motion** switches off travelling beams, weather and particles, and
  is enabled automatically when the OS asks for it.
- Full keyboard control, including 0.25° rotation for fine work.
- Sound and music toggle independently; the game is fully playable silent.
- Progress can be exported and imported as JSON.

---

## Performance

The tracer only re-runs when the scene is dirty or the level contains moving
parts, so a static puzzle sitting untouched costs one canvas repaint. Budgets
(max depth 26, max 1,400 rays, max 3,000 segments) mean a cascade of splitters
degrades by dropping the deepest branches rather than by hanging. The heaviest
shipped scene — a sandbox with four emitters and a drawer full of glass — traces
in about 4 ms, and the test suite warns on anything over 12 ms.

The scattered-light pass renders at half resolution into an offscreen buffer,
which is blurred and composited additively — that additive composite is what
makes crossing beams brighten where they overlap, matching what the physics
says should happen. The table's light map runs at a quarter resolution or less,
since light on a surface varies slowly; the wood texture is built once per
chapter and cached. Graphics quality is adjustable.

---

## Known limits

Stated plainly, because they are design decisions rather than oversights:

- **Nested dielectrics** are not modelled. A ray exiting glass always returns to
  air (n = 1), so glass inside glass would be wrong. No level does that.
- **A beam splitter's transmitted ray is not laterally offset.** A real plate
  displaces it slightly; at puzzle scale that is well under a pixel.
- **Diffraction is orders-only.** There is no interference between overlapping
  beams — two coherent beams crossing add in intensity, not in amplitude, so you
  will not see fringes.
- **Clip export produces WebM, not GIF.** Browsers have no native GIF encoder
  and bundling one was not worth the weight; where `MediaRecorder` is
  unavailable the export falls back to a PNG still and says so.
- **The scattering, light pools and dust are visual.** Emitters do not
  physically spread into a cone; doing so would change the energy reaching every
  sensor. The core ray is what the physics follows.
- **The world is a fixed 1600×900.** Portrait phones turn it sideways, except on
  pendulum levels, which letterbox and suggest landscape.
- **Multiplayer trusts its peers**, as described above.
