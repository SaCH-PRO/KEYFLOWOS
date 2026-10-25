# Living System Atlas -> Mission Control Integration

Status: CONVERGENCE CONTRACT
Atlas: `KF-ATLAS-001`
Existing owner surface: issue `#129`, PR `#132`

## Discovery

The repository already contains an active owner/admin Mission Control programme:

- issue `#129`: live programme control panel, progress bars and dependency web;
- PR `#132`: Phase A read-only Mission Control implementation;
- route: `/admin/mission-control`;
- server read model: `ProjectMissionControlSnapshot`.

This means the Atlas should **not** create a second dashboard.

The owner-facing control panel should converge on Mission Control, with the Living System Atlas becoming one of its canonical read models / graph sources.

## Separation of responsibilities

### Living System Atlas owns

- cross-layer semantic graph;
- product/capability -> journey -> kernel -> execution -> code -> proof -> development lineage;
- evidence classes;
- provenance and confidence;
- semantic ownership;
- graph freshness;
- contradiction representation;
- KEY cognitive topology;
- reverse traceability.

### Mission Control owns

- owner/admin presentation;
- programme health;
- active workstreams;
- packet/PR state;
- evidence-backed progress;
- blockers and next legal action;
- worker/session lanes;
- proof rail;
- dependency/critical-path visualization;
- alerts;
- later controlled owner actions through the existing authority plane.

### Existing business Command Center remains separate

The business-user Command Center is a product-operating surface. Development Mission Control is an owner/admin engineering/programme surface. They may share visual primitives, but must not share authority or silently mix business state with development-control state.

## Convergence target

```
repository/code/generated maps
          |
          v
  Living System Atlas
  semantic/evidence graph
          |
          +-----------------------+
          |                       |
          v                       v
   KEY context/reasoning   Mission Control snapshot
                                  |
                                  v
                         owner/admin control panel
```

The Mission Control UI should consume a typed projection of Atlas information rather than interpreting raw architecture files in the browser.

## Proposed read-model extension

The existing `ProjectMissionControlSnapshot` should eventually gain an Atlas projection such as:

```ts
interface AtlasMissionControlProjection {
  atlasVersion: string;
  verifiedAt: string | null;
  freshness: 'FRESH' | 'STALE' | 'CONTRADICTED' | 'UNKNOWN';

  layers: Array<{
    id: string;
    label: string;
    status: 'MAPPED' | 'PARTIAL' | 'UNVERIFIED' | 'CONTRADICTED';
    proven: number | null;
    total: number | null;
  }>;

  nodes: MissionAtlasNode[];
  edges: MissionAtlasEdge[];

  criticalPath: string[];
  contradictions: AtlasContradiction[];
  staleClaims: AtlasClaimRef[];

  keyCognition: KeyCognitionProjection;
  journeys: JourneyProjection[];
  kernels: KernelProjection[];
}
```

This is a read projection, not a new source of truth.

## Required control-panel views

The control panel should eventually expose the Atlas through progressive zoom:

1. **Programme**
   - active workstreams;
   - health;
   - exact-head proof;
   - blockers;
   - next legal action.

2. **System Atlas**
   - KEYFLOWOS / KEY / reality / development system;
   - zoom L0-L8.

3. **Journey**
   - user/business journeys and current completeness.

4. **Kernel**
   - identity, authority, temporal work, evidence, recovery, etc.

5. **KEY cognition**
   - perception;
   - memory/world model;
   - reasoning;
   - executive/governance;
   - agency;
   - learning.

6. **Execution trace**
   - entry -> authority -> transaction -> event -> external effect -> evidence -> reconciliation -> recovery.

7. **Repository**
   - domain/module/file/event/entity/provider topology.

8. **Development**
   - packet -> branch -> PR -> proof -> review -> admission -> merge -> checkpoint.

9. **Evidence**
   - observed / accepted / intended / derived / historical / unknown;
   - freshness;
   - contradictions;
   - provenance.

10. **Progress**
    - explicit numerator/denominator only;
    - UNKNOWN / UNBOUNDED where denominator is not trustworthy.

## No-fake-green law

The Atlas and Mission Control share the same progress rule:

**No percentage without an evidence-backed denominator.**

Examples of valid progress:

- `4 / 35` application packets checkpointed;
- `16 / 16` declared proof cases;
- `7 / 12` kernels with reviewed live-code traceability.

Invalid progress:

- "KEY is 73% complete" with no bounded denominator;
- counting skipped evidence as passing;
- counting stale proof from an old head;
- inferring worker state from absence/presence of comments;
- treating a generated ownership guess as reviewed semantic convergence.

## Current Mission Control reality

PR `#132` already implements Phase A foundations:

- owner/admin-only read path;
- server-side GitHub aggregation;
- exact-head PR/check representation;
- fail-closed health semantics;
- evidence progress;
- UNKNOWN / UNBOUNDED when denominator is missing;
- worker lanes intentionally unknown until trustworthy heartbeats exist;
- read-only UI.

However, its implementation branch currently diverges materially from current main. Atlas integration must therefore occur through convergence/rebase/reimplementation against current main rather than by assuming the old branch is current truth.

## Sequencing

### A. Finish Atlas foundation
Current `KF-ATLAS-001`:
- authority model;
- layers;
- node/edge contract;
- source indexes;
- Mission Control convergence contract.

### B. Materialize Atlas graph
- deterministic generated graph;
- journey/kernel import;
- ownership review;
- reverse indexes;
- freshness and contradiction validation.

### C. Reconcile Mission Control
- characterize PR `#132` against current main;
- retain proven Phase A semantics;
- rebase/reimplement cleanly where required;
- add Atlas projection to the typed snapshot.

### D. Build owner graph UI
This is the point at which we are explicitly **building the visual control panel around the Atlas**:
- dependency web;
- zoomable system atlas;
- detail drawer;
- critical path;
- evidence/freshness overlays;
- KEY cognition view.

### E. Controlled actions
Only after read-path trust is proven:
- pause/resume;
- release bounded work;
- request review;
- acknowledge blocker;
- open packet/PR.

Every mutation must use existing control-plane authority and audit semantics.

## Hard rule

**Do not build a second control panel. Converge Atlas visualization into Mission Control.**
