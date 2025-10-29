AGENTS.md

Project Codename: star-nexus
Mission: A living civilization simulator with embodied cognition, reproduction, factional politics, urban vs clan sovereignty, and intergenerational ideology — ultimately to become a commercial Steam game.

This document is the spec and command sheet for implementation agents (e.g. codegen assistants, build agents, etc.).
It defines:

Project goals and phases

Folder / code structure for all layers

Canonical data models, brains, and systems

Runtime and messaging architecture for the middle layer (three.js + Web Worker)

Expectations for the Unity production port

This is the document you follow when creating code, files, and behavior.

0. PROJECT OVERVIEW

We are building a biologically and politically generative sim:

Agents have “minds” made of neurons (behavioral states), moods (affective tones), and temperament (stable personality sliders).

Agents exist in a physical world (grid with town/plains/forest).

Agents can reproduce, gestate fetuses, give birth, develop from baby → child → teen → adult.

Households (HouseMind) and the town/city (UrbanMind) are themselves “minds,” slower-moving collective cognition loops.

Those collectives try to capture loyalty, labor, and children.

Over time, this produces factions, feuds, cults, and dynasties.

This sim becomes:

A design lab (Python).

A live, visual, non-blocking dashboard (browser via three.js + Web Worker).

A Unity ECS runtime (C# DOTS/Burst) for the Steam game.

The sim is deterministic under a seed and produces save/load snapshots.

1. MULTI-LAYER DEVELOPMENT STRATEGY

We have three layers:

1.1 Python Lab (python_lab/)

Purpose:

Fastest iteration on ideas.

Prove new mechanics: reproduction, gestational imprinting, HouseMind vs UrbanMind conflict, cultural inheritance.

Generate “golden runs” (snapshots) that become behavioral canon.

Reality:

We will accept “janky but expressive” code here. It’s our research space.

1.2 Browser Simulation Layer (node/)

Purpose:

Interactive dashboard and visualization.

Runs in your normal three.js starter project (npm install, npm run dev).

Simulation executes in a Web Worker (off the main thread).

Main thread renders world state in three.js and shows overlays/UI (panels optional).

This proves we can run the civilization loop in realtime without blocking rendering.

Core decisions:

We keep this as simple as possible structurally so it’s easy to work with.

We design the data flow for async / multithreading / GPU offload from the start.

This layer will also be our eventual modding and storytelling tool.

1.3 Unity Production Layer (unity/)

Purpose:

Shipping build for Steam.

Reimplements the same simulation logic in C# using Unity DOTS/ECS + Burst for performance.

Reads the same JSON brain definitions.

Renders the game with production visuals, UI, input, save/load, etc.

2. REPO STRUCTURE (TOP LEVEL)

All code should appear in a single git repository:

star-nexus/
  README.md
  AGENTS.md                <-- THIS FILE
  LICENSE
  .gitignore

  python_lab/
    pyproject.toml         # poetry/uv environment
    src/
      snx/
        __init__.py
        core/
          rng.py
          grid.py
          brains.py        # loads JSON brain defs, validates them
          agents.py        # data classes for Agent, House, City
          moods.py
          demands.py
          schemas.py       # pydantic models for validation
        sim/
          systems.py       # brain tick, move, repro, aging, collectives
          loop.py          # fixed step simulation loop
        io/
          snapshot.py      # save/load snapshots
          assets.py        # path helpers for brains/world data
        viz/
          plots.py         # optional matplotlib debugs
    data/
      brains/              # canonical brain JSONs (see §4)
      worlds/              # world seeds / terrain configs
    notebooks/
      01_lifecycle.ipynb
      02_collectives.ipynb
    out/
      runs/                # golden snapshot outputs from python

  node/
    package.json
    vite.config.js or vite.config.ts
    public/
      index.html
    src/
      main.js              # main thread entry (three.js scene, worker hookup)
      scene/
        MapScene.js        # three.js scene management + rendering
        materials.js       # reusable materials/shaders, per-life-stage colors
        ui-overlay.js      # optional 2D canvas overlays (labels, trails, etc.)
      sim/
        sim.worker.js      # Web Worker entry: runs full simulation logic
        core/
          rng.js
          world.js         # generate world grid, town/plains/forest
          brains.js        # load brain JSONs, hold in-memory graphs
          agents.js        # agent struct creation, stage transitions
          moods.js
          demands.js
          systems/
            tickBrain.js   # node selection / brain stepping
            move.js        # movement rules by node + life-stage
            repro.js       # conception, gestation, birth
            aging.js       # lifecycle (baby → child → teen → adult)
            collectives.js # HouseMind & UrbanMind ticks, demands
        data/
          BabyMind_v1.json
          ChildMind_v1.json
          TeenMind_v1.json
          AdultMind_v1.json
          HouseMind_v1.json
          UrbanMind_v1.json
      util/
        messageBus.js      # functions to standardize worker <-> main messaging
        snapshotTypes.js   # JSDoc typedefs for snapshots and entities
      gpu/
        influenceField.glsl   # GPU heatmap of territorial/urban authority (stub)
        densityField.glsl     # GPU trail/density accumulation (stub)

  unity/
    ProjectSettings/
    Packages/
    Assets/
      StarNexus/
        Scripts/
          Components/
            Position.cs
            LifeStage.cs
            Temperament.cs
            Moods.cs
            BrainState.cs
            Reproductive.cs
            SocialLinks.cs       // parents, caregiver, bond partner, house ID
            Membership.cs        // house/city affiliation
          Systems/
            BrainSystem.cs
            MoveSystem.cs
            ReproSystem.cs
            GestationSystem.cs
            AgingSystem.cs
            HouseholdSystem.cs
            UrbanSystem.cs
            DemandSystem.cs
            SnapshotSystem.cs    // save/load snapshots
          Core/
            RNG.cs
            WorldGrid.cs
            BrainGraphs.cs       // data containers for imported brain JSON
            DemandBuffs.cs
          Importers/
            BrainJsonImporter.cs // JSON -> ScriptableObject / NativeArray
            SnapshotImporter.cs
          Tests/
            DeterminismTests.cs
        Resources/
          Brains/               // imported brain assets
          Worlds/
        Art/
          Materials/
          Meshes/
          (etc.)

3. SIMULATION MODEL (CANONICAL)

All stacks (Python, browser worker, Unity ECS) must express the same concepts.

3.1 Time

tick = 5 minutes of in-world time.

Individual brains update every tick.

HouseMind updates every 12 ticks (1 in-world hour).

UrbanMind updates every 72 ticks (6 in-world hours).

Lifecycle timing (compressed to be observable in a play session):

Gestation: 200 ticks

Baby: 200 ticks

Child: 400 ticks

Teen: 400 ticks

Adult: indefinite (for now)

We compress “years” into “days” of sim time purely to see generational turnover.

3.2 World Geometry

100×100 grid by default.

We define a “center” at (cx, cy) = (width/2, height/2).

Terrain by radius from center:

town if dist < 10

plain if 10 ≤ dist ≤ 30

forest if dist > 30

Movement: agents move stepwise by ±1 in x/y per tick (8-direction drift), clamped to [0,width-1]×[0,height-1].

3.3 Determinism

We must implement a seeded RNG (e.g. XorShift / PCG).

The seed + tick + relevant RNG streams must guarantee deterministic replay.

Snapshots record seed and tick so we can reproduce.

4. BRAINS (THE NEURAL GRAPHS)

Each mind is a graph:

nodes: behavioral states (“neurons”) an agent can inhabit.

edges: possible state transitions with weights.

Each node has a base frequency (its inherent desire to fire) and nominal duration in ticks.

The agent has a current_node and a node_timer. When timer hits 0, they pick next node via weighted choice.

All brain definitions live in JSON files under:
python_lab/data/brains/ and node/src/sim/data/.

These JSONs are canonical. Unity will import them.

4.1 Brain JSON schema
{
  "version": 1,
  "name": "AdultMind_v1",
  "nodes": [
    { "id": "Gather",        "base_freq": 1.0, "duration": 6, "tags": ["work","outward"] },
    { "id": "Stockpile",     "base_freq": 1.0, "duration": 6, "tags": ["home","inward"] },
    { "id": "Socialize",     "base_freq": 1.0, "duration": 6, "tags": ["home","social"] },
    { "id": "BuildDwelling", "base_freq": 0.8, "duration": 6, "tags": ["home","build"] },
    { "id": "Patrol",        "base_freq": 0.8, "duration": 6, "tags": ["work","outward","guard"] },
    { "id": "MarkTerritory", "base_freq": 0.6, "duration": 6, "tags": ["outward","guard"] },
    { "id": "Wander",        "base_freq": 1.0, "duration": 6, "tags": ["outward"] },
    { "id": "Rest",          "base_freq": 1.0, "duration": 6, "tags": ["home","rest"] }
  ],
  "edges": [
    ["Gather","Stockpile",1.0],
    ["Gather","Wander",0.6],
    ["Stockpile","Socialize",0.8],
    ["Stockpile","BuildDwelling",0.6],
    ["Socialize","Wander",0.8],
    ["Socialize","Gather",0.6],
    ["BuildDwelling","Patrol",0.7],
    ["BuildDwelling","Rest",0.7],
    ["Patrol","MarkTerritory",0.8],
    ["Patrol","Rest",0.5],
    ["MarkTerritory","Patrol",0.6],
    ["MarkTerritory","Rest",0.5],
    ["Wander","Gather",0.8],
    ["Wander","Socialize",0.6],
    ["Wander","Rest",0.4],
    ["Rest","Gather",0.6],
    ["Rest","Socialize",0.6]
  ],
  "start_node": "Gather"
}


We define one JSON per brain:

BabyMind_v1

Nodes:

CryForCare

Feed

SleepWarm

ObserveVoices

FearScream

Edges:

CryForCare → Feed (1.0)

CryForCare → CryForCare (0.2)

Feed → SleepWarm (1.0)

SleepWarm → ObserveVoices (1.0)

ObserveVoices → CryForCare (0.8)

FearScream → CryForCare (1.0)

Durations: 5 ticks per node by default.

Tags example:

CryForCare: ["need","social"]

Feed: ["need","care"]

SleepWarm: ["rest","home"]

ObserveVoices: ["learn","social"]

FearScream: ["fear","alert"]

ChildMind_v1

Nodes:

FollowCaregiver

ExploreNearby

FetchSmallThings

HideWhenScared

ImitateRitual

Edges:

FollowCaregiver → ExploreNearby (0.7)

FollowCaregiver → FetchSmallThings (0.6)

ExploreNearby → HideWhenScared (0.5)

ExploreNearby → ImitateRitual (0.4)

ExploreNearby → FollowCaregiver (0.6)

FetchSmallThings → FollowCaregiver (0.8)

FetchSmallThings → ExploreNearby (0.6)

HideWhenScared → FollowCaregiver (1.0)

ImitateRitual → FollowCaregiver (0.8)

ImitateRitual → ExploreNearby (0.6)

Durations: 6 ticks.

Tags:

FollowCaregiver: ["home","social","safety"]

ExploreNearby: ["outward","curiosity"]

FetchSmallThings:["help","duty"]

HideWhenScared: ["fear","safety"]

ImitateRitual: ["ritual","doctrine","loyalty"]

TeenMind_v1

Nodes:

ProveMyself

ShowLoyalty

SneakAndHoard

ChallengeBorder

CourtAlly

Edges:

ProveMyself → ShowLoyalty (0.7)

ProveMyself → SneakAndHoard (0.6)

ProveMyself → ChallengeBorder (0.8)

ShowLoyalty → ProveMyself (0.7)

ShowLoyalty → CourtAlly (0.7)

SneakAndHoard → ProveMyself (0.6)

SneakAndHoard → ChallengeBorder (0.7)

ChallengeBorder → ProveMyself (0.6)

ChallengeBorder → CourtAlly (0.5)

CourtAlly → ShowLoyalty (0.8)

CourtAlly → ProveMyself (0.6)

Durations: 6 ticks.

Tags:

ProveMyself: ["status","risk","outward"]

ShowLoyalty: ["loyalty","ritual","inward"]

SneakAndHoard: ["resource","selfish","resentment"]

ChallengeBorder: ["border","territorial","risk"]

CourtAlly: ["social","bonding","future_pair"]

AdultMind_v1

(See full JSON above in §4.1)

Tags:

outward = gather/patrol/wander/mark-territory

inward/home = stockpile/socialize/build/rest

guard = protect land

build = infrastructure

rest = recovery

HouseMind_v1 (collective household mind)

Nodes (slow-cycle):

FortifyHome

AvengeSlight

NurtureHeir

ProtectYoung

EnsureLineage

AccumulateStock

Edges, suggested:

FortifyHome → AccumulateStock (0.6)

FortifyHome → ProtectYoung (0.7)

AvengeSlight → FortifyHome (0.8)

AvengeSlight → EnsureLineage (0.4)

NurtureHeir → EnsureLineage (0.8)

NurtureHeir → FortifyHome (0.5)

ProtectYoung → AvengeSlight (0.7)

ProtectYoung → FortifyHome (0.6)

EnsureLineage → NurtureHeir (0.8)

EnsureLineage → AccumulateStock (0.6)

AccumulateStock → FortifyHome (0.7)

Tick rate: every 12 ticks (1 in-world hour).
Emits “demands” that influence member agents (see §6).

UrbanMind_v1 (city / polity mind)

Nodes:

CollectTribute

MaintainOrder

ProjectDoctrine

AbsorbYouth

SanctifyBirth

SuppressRivals

Edges, suggested:

CollectTribute → MaintainOrder (0.7)

CollectTribute → ProjectDoctrine (0.6)

MaintainOrder → CollectTribute (0.6)

MaintainOrder → SuppressRivals (0.5)

ProjectDoctrine → AbsorbYouth (0.8)

ProjectDoctrine → MaintainOrder (0.5)

AbsorbYouth → ProjectDoctrine (0.6)

AbsorbYouth → MaintainOrder (0.6)

SanctifyBirth → ProjectDoctrine (0.8)

SanctifyBirth → AbsorbYouth (0.7)

SuppressRivals → MaintainOrder (0.7)

Tick rate: every 72 ticks (6 in-world hours).
Also emits Demands.

5. AGENT STRUCTURE

Agents are the individual people.

5.1 Fields

All stacks must represent agents with (at least) these fields:

{
  id: "A7",

  x: 52,
  y: 47,

  age_stage: "teen",     // "baby"|"child"|"teen"|"adult"
  age_ticks: 0,          // ticks spent in current stage

  sex_body: "female",    // "male"|"female"
  gender_identity: "man",// "man"|"woman"|"nonbinary"|etc

  fertility: 0.78,       // >0 if sex_body == "female" and age_stage == "adult"
  pregnancy: {
    time_remaining: 200,
    fetus_temperament: {
      trust_bias: 0.45,
      fear_bias: 0.9,
      loyalty_bias: 0.40,
      resentment_bias: 0.44,
      territorial_bias: 0.8,
      zeal_bias: 0.42
    },
    co_parent_id: "A5"
  } || null,

  bond_partner_id: "A5",         // pair bond

  primary_caregiver_id: "A4",    // used by baby/child stages
  parents: ["A4","A5"],          // birth parents recorded for lineage

  temperament: {
    trust_bias:        0.45,
    fear_bias:         1.0,
    loyalty_bias:      0.42,
    resentment_bias:   0.43,
    territorial_bias:  1.0,
    zeal_bias:         0.44
  },

  moods: {
    fear:         0.2,
    boredom:      0.0,
    zeal:         0.1,
    bitterness:   0.3,
    rage:         0.0,
    contentment:  0.4
  },

  brain: {
    graph_name:   "TeenMind_v1", // name of brain asset for current life stage
    current_node: "ProveMyself",
    node_timer:   4              // ticks until this node "finishes" and we pick a new node
  }
}

5.2 Temperament (the “psychological genome”)

Temperament fields:

trust_bias

fear_bias

loyalty_bias

resentment_bias

territorial_bias

zeal_bias

All are floats [0,1].

Inheritance:

When conception happens:

Start with avg of parents ± small noise.

During gestation:

Fetus temperament gets modified by the gestating parent’s stress at each tick:

fear_bias += 0.01 * stress

territorial_bias += 0.005 * stress

stress = min(1.0, distance_from_center/40 + randomUniform(0,0.1))

Meaning: being carried/fed/sheltered in frontier zones imprints territorial paranoia and vigilance into the child.

This is culture-as-embodied heritability.

5.3 Moods

Moods are short/medium-term affective states that bias node desirability. Core moods v1:

contentment

fear

boredom

zeal

bitterness

rage

Mood → multiplier map (example):

High fear increases desire for HideWhenScared, Rest, decreases ChallengeBorder and Wander.

High zeal increases ImitateRitual, ShowLoyalty, decreases selfish behavior like SneakAndHoard.

High bitterness increases hoarding/resentment actions, decreases prosocial nodes.

These multiplier rules are data, not hardcoded — store them in moods.js or a JSON later.

6. COLLECTIVE ENTITIES

Two higher-order “minds”: HouseMind (household) and UrbanMind (town).
They run slower and exert pressure on agents via “Demands.”

6.1 HouseMind

Represents a dwelling / family / clan unit. Fields:

{
  id: "H1",
  x: 58,
  y: 47,
  members: ["A4","A5","A7","A11"],
  authority: 0.5,
  brain: {
    graph_name: "HouseMind_v1",
    current_node: "FortifyHome",
    node_timer: 12   // updates hourly, 12 ticks/node
  }
}


Behavior:

Chooses a node like FortifyHome, ProtectYoung, NurtureHeir.

Issues Demands that bias its members.

Example: ProtectYoung → buff Patrol/MarkTerritory desire in adult members near the house, boost HideWhenScared in children.

6.2 UrbanMind

Represents the central polity (the town / proto-state). Fields:

{
  id: "C1",
  x: 50,
  y: 50,
  authority: 0.7,
  brain: {
    graph_name: "UrbanMind_v1",
    current_node: "CollectTribute",
    node_timer: 72   // updates every 6 in-world hours
  }
}


Behavior:

Nodes like CollectTribute, AbsorbYouth, SanctifyBirth, SuppressRivals.

Issues Demands affecting agents near the town center.

AbsorbYouth: Teens near town get big multiplier for ShowLoyalty, ImitateRitual. This is how the city steals heirs from the clans.

SanctifyBirth: newborn babies are symbolically claimed as “of the city,” shifting starting loyalty/zeal baselines long-term.

6.3 Demands

Demands are temporary localized buffs to specific nodes for specific agents.

Conceptually:

{
  source_id: "H1",           // HouseMind or UrbanMind
  scope: "house",            // "house"|"city" etc
  origin: [58,47],
  radius: 12,
  targets: ["Patrol","MarkTerritory"],
  multiplier: 1.3,
  expires_at_tick: 3456
}


Application:

When computing next-node desirability for any agent, check applicable Demands in range.

Multiply desirability for listed nodes by the multiplier.

7. SIMULATION LOOP

Every tick, in this order (both in Python and browser worker, and later Unity ECS):

Conception / Pregnancy

Adults with sex_body == "female", fertility > 0, not currently pregnant:

If bonded (bond_partner_id exists) → roll conception chance each tick:
roll < 0.02 * fertility

If conception happens:

create pregnancy object, including:

time_remaining = 200 (GESTATION_TICKS)

fetus_temperament = average(parents) + noise

co_parent_id

Gestation

For each pregnant agent:

decrement time_remaining

apply gestational imprinting to fetus_temperament (fear_bias, territorial_bias).

If time_remaining <= 0: birth:

create new agent with age_stage = "baby", at parent position

assign its parents

assign primary_caregiver_id = gestating parent

inherit temperament from fetus_temperament

clear pregnancy

Brain Tick

Decrement each agent’s brain.node_timer.

If node_timer <= 0:

compute desirability score for each outgoing edge from current_node.

Score = edge_weight * target_node.base_freq

mood_multiplier

personality_multiplier (from temperament)

demand_multiplier (from HouseMind/UrbanMind Demands)

Pick next node by roulette wheel.

Set new current_node and reset node_timer to node.duration.

Movement

Given current node tags:

Babies: barely move; effectively anchored to caregiver/home tile.

Children: try to move toward caregiver.

Teens: alternate between outward exploration (ProveMyself,ChallengeBorder) and drifts back toward center or allies.

Adults:

outward nodes (Gather,Patrol,MarkTerritory,Wander) drift away from center;

inward/home nodes (Stockpile,Socialize,BuildDwelling,Rest) drift toward center or their household anchor point.

Clamp to world bounds.

Aging / Stage Transition

Increment age_ticks.

If baby and age_ticks > 200 → become child

reset age_ticks=0

brain.graph_name = ChildMind_v1

new brain.start_node

If child and age_ticks > 400 → become teen

brain.graph_name = TeenMind_v1

If teen and age_ticks > 400 → become adult

brain.graph_name = AdultMind_v1

if sex_body == female, set fertility = random [0.4, 0.9]

else fertility = 0

Collective Minds

Every 12 ticks (1 hour), update each HouseMind brain:

similar “node_timer / pick next node” logic

emit new/updated Demands for its members / local radius

Every 72 ticks (6 hours), same for UrbanMind:

decide doctrine moves like AbsorbYouth / SanctifyBirth

emit Demands around town center

Stats / Snapshot

Build snapshot object with:

tick

world size

list of all agents (at minimum: id, x, y, age_stage)

list of houses (id, x, y, authority)

city (id, x, y, authority)

population counts by stage

Send snapshot to renderer (browser main thread) or save it (Python) or store it for debugging (Unity test logs).

8. BROWSER LAYER ARCHITECTURE (three.js + Worker)
8.1 Main thread (src/main.js)

Responsibilities:

Initialize three.js scene via MapScene.

Spin up new Worker('./sim/sim.worker.js', { type: 'module' }).

Send an INIT message to the worker with seed, world size, number of initial adults, ticksPerUpdate.

Listen for SNAPSHOT messages from worker.

For each new snapshot:

MapScene.updateFromSnapshot(snapshot):

ensures each agent has a mesh

sets mesh position to (x,y)

colors mesh based on age_stage

optionally update overlay layers (territory heatmap, etc.)

Handle selection UI later.

Pseudo-main.js:

import { MapScene } from './scene/MapScene.js';

const scene = new MapScene({ width:100, height:100 });

const worker = new Worker(new URL('./sim/sim.worker.js', import.meta.url), { type:'module' });

worker.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type === 'SNAPSHOT') {
    scene.updateFromSnapshot(msg);
  }
};

worker.postMessage({
  type: 'INIT',
  seed: 123,
  worldSize: [100,100],
  adults: 6,
  ticksPerUpdate: 4
});

8.2 MapScene (src/scene/MapScene.js)

Responsibilities:

Create renderer, camera (orthographic; top-down or slight tilt).

Generate terrain mesh/tiles.

Maintain a Map of agentId -> mesh.

updateFromSnapshot(snapshot):

for each agent:

create mesh if missing

position mesh to agent coords

recolor mesh by stage:

baby: magenta

child: yellow

teen: cyan

adult: white

Also: prepare hooks for GPU overlays (fear/territory heatmaps) — stub out planes and uniforms for later.

8.3 Worker (src/sim/sim.worker.js)

Responsibilities:

Hold the authoritative sim state in memory:

world

agents[]

houses[]

city

tick

active demands[]

On INIT, create the world, seed adults, set timers.

Then run an internal loop:

step the simulation N ticks (ticksPerUpdate)

post SNAPSHOT to main

schedule the next iteration with setTimeout(loop, 0) (to yield)

Pseudo-sim.worker.js:

import { initWorld } from './core/world.js';
import { initBrains } from './core/brains.js';
import { spawnInitialAdults } from './core/agents.js';
import { tickAllBrains } from './systems/tickBrain.js';
import { moveAllAgents } from './systems/move.js';
import { handleReproduction } from './systems/repro.js';
import { applyAging } from './systems/aging.js';
import { tickCollectives } from './systems/collectives.js';

let world, agents, houses, city, tick;
let ticksPerUpdate = 4;

self.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type === 'INIT') {
    const { seed, worldSize, adults } = msg;
    ticksPerUpdate = msg.ticksPerUpdate ?? 4;
    world   = initWorld(worldSize[0], worldSize[1]);
    initBrains(); // loads JSON into memory
    ({ agents, houses, city } = spawnInitialAdults(seed, world, adults));
    tick    = 0;
    loop();
  }
};

function loop(){
  for (let i=0; i<ticksPerUpdate; i++){
    stepOneTick();
  }
  postMessage(buildSnapshot());
  setTimeout(loop, 0); // yield back to browser so render stays smooth
}

function stepOneTick(){
  // reproduction (conception; gestation; births)
  handleReproduction(agents, tick, world);
  // brains
  tickAllBrains(agents, houses, city, tick, world);
  // movement
  moveAllAgents(agents, world);
  // aging transitions
  applyAging(agents);
  // house/city collective updates
  tickCollectives(houses, city, agents, tick, world);
  tick++;
}

function buildSnapshot(){
  const stats = summarizeStages(agents);
  return {
    type: "SNAPSHOT",
    tick,
    world: { w: world.w, h: world.h },
    agents: agents.map(a => ({ id:a.id, x:a.x, y:a.y, age_stage:a.age_stage })),
    houses: houses.map(h => ({ id:h.id, x:h.x, y:h.y, authority:h.authority })),
    city: { id:city.id, x:city.x, y:city.y, authority:city.authority },
    stats
  };
}

function summarizeStages(agents){
  const out = { baby:0, child:0, teen:0, adult:0 };
  for (const a of agents) out[a.age_stage] = (out[a.age_stage]||0)+1;
  return out;
}


That’s the heart of it.

9. UNITY EXPECTATIONS

The Unity layer should replicate this simulation, not invent a new one.

9.1 Unity data equivalents

Each agent becomes an ECS entity with components:

Position (int2 or float2)

LifeStage (enum: baby/child/teen/adult)

AgeTicks (int)

Temperament (6 floats)

Moods (6 floats)

BrainState (currentNodeIndex, nodeTimer, brainGraphIndex)

ReproductiveState (fertility, pregnancy struct, bond partner, parents)

Links (caregiver, parents, houseID, cityID)

etc.

HouseMind and UrbanMind become ECS entities with:

BrainState

Authority

Position

Members (could be external mapping, not necessarily per-entity array)

Demands become transient ECS components or a shared buffer structure.

9.2 Unity systems (Burst jobs where possible)

BrainSystem: parallel job to decrement node timers and select next node.

MoveSystem: parallel job to nudge positions.

ReproSystem / GestationSystem: runs over eligible adults, may spawn new entities.

AgingSystem: stage bump logic (switch brain graph, reset age_ticks).

HouseholdSystem: hourly updates; updates demands.

UrbanSystem: 6-hour updates; updates demands.

DemandSystem: resolves demands into per-agent multipliers.

SnapshotSystem: for debugging parity and save/load.

We must aim for deterministic results (given same seed and tick order).

9.3 Shared assets in Unity

Unity must import:

The same brain JSONs from python_lab/data/brains/ or node/src/sim/data/.

A world descriptor (100×100, radius thresholds).

Optionally a “balance constants” JSON (gestation ticks, mood multipliers, etc.).

10. DELIVERABLE CONTRACT / WHAT TO BUILD NOW

For codegen / implementation agents, these are the immediate deliverables:

10.1 Create repo folder structure exactly as described above:

python_lab/ with placeholder modules.

node/ with the described files.

unity/ with placeholder Assets/StarNexus/Scripts/... etc.

gpu/ stubs in node/src/gpu/.

10.2 Implement the browser sim worker skeleton

node/src/sim/sim.worker.js must:

accept INIT

spawn initial adults (6 adults clustered near center)

run tick loop

send SNAPSHOT objects to main thread

10.3 Implement MapScene

node/src/scene/MapScene.js must:

create a three.js renderer, scene, and orthographic camera

render the terrain background (town/plains/forest colors in a 2D plane mesh or grid)

maintain a map of agent meshes by ID

color-code agent meshes by age_stage:

baby: magenta

child: yellow

teen: cyan

adult: white

expose updateFromSnapshot(snapshot)

10.4 Implement basic brains.js, agents.js, and world.js in the worker

world.js: generate the 100×100 terrain classification

agents.js: function spawnInitialAdults(seed, world, n) that:

creates adult agents near center,

initializes temperament with random ~0.2–0.7 ranges,

assigns sex_body randomly "male"|"female",

assigns gender_identity randomly from "man"|"woman"|"nonbinary" with weights [0.4,0.4,0.2],

if "female" and "adult", assign fertility in ~[0.4,0.9],

pair-bond some of them

set their brain to AdultMind_v1 with current_node="Gather", node_timer=6

brains.js: load BabyMind_v1.json, ChildMind_v1.json, TeenMind_v1.json, AdultMind_v1.json, HouseMind_v1.json, UrbanMind_v1.json into memory structures so tickBrain.js can use them

10.5 Document the snapshot protocol

In node/src/util/snapshotTypes.js, define JSDoc typedefs:

Snapshot

SnapshotAgent

SnapshotHouse

SnapshotCity

So all code agrees on message shape.

11. DESIGN PRINCIPLES (DO NOT BREAK)

Separation of concerns

Sim logic in worker.

Rendering in main thread.

Visualization (GPU heatmaps etc.) in main thread using data from worker.

No AI logic in main thread.

Determinism

All randomness goes through seeded RNG.

We must be able to reproduce a run from seed + tick.

Embodiment

Agents are not abstract. They occupy tiles and move, and that movement shapes political temperament.

Gestation is spatial: stress imprint depends on where the pregnant agent physically is.

Social recursion

Individuals form households.

Households negotiate/mobilize members.

Town (UrbanMind) tries to extract tribute, allegiance, and youth from households.

We always model these as minds with neurons and moods — not just numeric buffs.

Readable brains

Node graphs stay human-readable and small (~5–12 nodes).

Edges are explicit, directional, weighted.

Everything is in JSON so designers (and you) can edit, diff, version.

Scalability path

What runs in Python first becomes Worker JS next, then becomes Unity ECS later.

The brains, demands, moods, lifecycle constants must stay portable across all three.

12. SUMMARY

This project simulates not just villagers, but culture itself as a living, inheriting intelligence:

Brains for babies, kids, teens, adults.

Brains for houses and cities.

Reproduction, gestation, imprinting, childhood socialization, teen factionalization, adult governance.

Territorial and civic power competing to capture the next generation.

All embedded in space, time, and memory.

You (the code agent) are to:

Stand up the repo structure above.

Build the browser middle layer around a worker-driven sim loop and a three.js renderer.

Use the brains and systems as written.

Keep determinism and modularity.


NOTE: Make sure to setup .gitignores in the individual sub units of the project, so an appropriate python one in the python labe, an appropriate one for node/three.js/etc in that project, and an appropriate one in the unity area
NOTE2: In each subfolder, you can also create new AGENTS.md files. These files can be used to add specific rules or overrides to a folders contents, with nested logics. 
NOTE3: Finish setting up node/three.js/vite 
They can also be used to take notes on appropriate parts of the projects.

Prepare for Unity ECS port by keeping data shapes stable.

When in doubt: the browser middle layer is the source of truth for behavior right now. Python is for deep experiments. Unity is for commercialization.
