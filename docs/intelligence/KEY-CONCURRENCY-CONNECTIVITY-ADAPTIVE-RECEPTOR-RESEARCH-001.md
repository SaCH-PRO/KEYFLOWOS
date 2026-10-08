# KEY Concurrency, Connectivity & Adaptive Receptor Expansion — Research Pass 001

Status: **RESEARCH / ARCHITECTURE CONVERGENCE — NO PRODUCTION CUTOVER AUTHORIZED**  
Companions:
- `KEY-COGNITIVE-ARCHAEOLOGY-AND-CONVERGENCE-PASS-001.md`
- `KEY-COGNITIVE-IMPLEMENTATION-CROSSWALK-001.md`
- PR #105 Connector Fabric architecture
- #110/#118/#119/#121 multi-worker control-plane work
- #125 Adaptive Receptor Fabric
- #106 Context Genome / durable context programme

## 1. Research question

How should KEYFLOWOS/KEY:
1. ingest many simultaneous streams of information/stimuli without overload or loss of provenance;
2. connect deeply and seamlessly to more software, devices, operating systems and services;
3. discover and expose more capabilities as a growing tool base;
4. do so without turning KEY into provider-specific hacks, unsafe UI scraping, or uncontrolled tool explosion?

The intended meaning of "deep integration" is **authorized semantic integration through supported APIs, events, OS/device interfaces, local bridges and instrumentation**. It does not include bypassing access controls or exploiting systems.

## 2. Existing architecture already points in the right direction

PR #105 already defines:
- provider-neutral capability naming;
- Connector Registry v2;
- Capability Registry;
- Connector Router;
- Credential/Grant Vault;
- Event Mesh;
- Identity Graph;
- KEY Action Gateway;
- MCP Gateway;
- Device Bridge;
- Browser Extension;
- Connector SDK/Marketplace;
- event-first/polling-last;
- official semantic interface preference;
- connector generation/revocation fencing;
- capability -> control -> clearance rather than connection -> authority.

Therefore this research should **extend and converge** the Connector Fabric, Adaptive Receptor Fabric and K2/K6 architecture, not create a second integration subsystem.

## 3. Biological design lessons

### 3.1 Receptor repertoires evolve with the environment

Sensory receptor families expand, contract and specialize as organisms occupy different environments. Chemoreceptor repertoires are especially dynamic.

KEY implication:
- receptor inventory should be evolvable, not a fixed provider list;
- new environmental niches should create `ReceptorGap` demand;
- repeated useful gaps can justify a new adapter/receptor;
- unused/dead receptors can be deprecated after evidence;
- receptor growth should be selected by utility, reliability, coverage and cost.

### 3.2 Sensory adaptation is gain control, not "ingest everything at full volume"

Biological sensory systems change their encoding/gain as stimulus statistics change. Sensorimotor systems amplify relevant feedback and attenuate disruptive/self-generated feedback.

KEY implication:
- every receptor/stream needs dynamic sampling/gain;
- high-volume sources require backpressure, summarization and aggregation;
- self-generated events must be tagged so KEY can distinguish reafference from novel external evidence;
- salience should change ingestion depth, not truth/authority.

### 3.3 Multisensory integration preserves distinct streams before fusion

Multiple senses improve detection and judgment, but integration depends on timing, source relationship and context.

KEY implication:
- never flatten Gmail, Slack, database CDC, browser activity, device notifications and telemetry into one undifferentiated event stream;
- retain modality/source/provenance;
- align by entity, causal chain and event time;
- fuse only after deduplication and source-quality assessment;
- allow agreement to raise confidence without raising authority by repetition alone.

### 3.4 Active sensing is a perception-action loop

Active sensing selects actions that obtain the most useful next observation.

KEY implication:
- receptors should not be purely passive;
- when uncertainty matters, KEY may ask a targeted query, refresh a source, inspect a resource, subscribe to a more specific stream, or request human clarification;
- sensing actions must have a value-of-information / cost / risk calculation;
- "what should I observe next?" belongs in K5 Executive, while the observation itself enters K2 Reality.

### 3.5 Immune systems combine broad pattern recognition with adaptive specificity

Innate pattern-recognition receptors cover broad recurrent classes; adaptive immune repertoires provide huge specific diversity.

KEY implication:
- maintain generic receptor families for common protocols/formats;
- compile specific adapters from generic protocol primitives where possible;
- quarantine unknown/untrusted inputs first;
- repeated validated patterns can become promoted specialized receptors;
- novelty != threat and unfamiliar != authority.

## 4. Engineering systems that strongly map to KEY

### 4.1 MCP: AI-facing capability negotiation

MCP standardizes external resources/context/tools for LLM hosts, with host/client/server capability negotiation and an official server registry.

Adopt:
- MCP as one first-class connector protocol;
- consume external MCP tools/resources through the same Connector/Capability Registry;
- expose approved KEYFLOWOS capabilities through KEYFLOWOS MCP;
- registry discovery can produce connector candidates.

Do not:
- make MCP the only connector model;
- let MCP tool presence imply trust or action authority.

### 4.2 OpenAPI + GraphQL introspection: machine-discoverable software affordances

OpenAPI gives a machine-readable description of HTTP APIs. GraphQL introspection can expose schema/types/fields where the server permits it.

KEY implication:
- a receptor/connector candidate can first search for an authorized machine-readable description;
- parse operations, schemas, auth requirements and webhooks;
- compile these into candidate CapabilityDescriptors and EventDescriptors;
- generate typed adapter scaffolding automatically;
- require conformance tests before registration.

This is the beginning of a **Connector/Tool Compiler**, not merely a connector SDK.

### 4.3 AsyncAPI + CloudEvents: event-first semantic ingress

AsyncAPI describes message/event-driven APIs independent of protocol. CloudEvents provides a common event envelope across producers/platforms.

KEY implication:
- ingest webhook, queue, MQTT, Kafka, WebSocket and pub/sub streams through protocol-specific bindings but normalize occurrences to a canonical KEY observation/event envelope;
- use AsyncAPI when available for channel/message discovery;
- borrow CloudEvents' narrow event-context/data split rather than inventing provider-specific event shapes.

### 4.4 W3C Web of Things: a strong universal "affordance" abstraction

W3C WoT describes physical or virtual Things using three core interaction types:
- Properties;
- Actions;
- Events;
plus protocol bindings, data schemas and security descriptions.

This is unusually close to what KEY needs.

Proposed KEY narrow-waist mapping:
- **Property / Resource** -> what can be observed/read;
- **Action / Tool** -> what can be invoked/changed;
- **Event / Stream** -> what can be subscribed to.

A Gmail account, Shopify store, Windows desktop, browser tab, robot, phone, database or SaaS workspace can all be projected into the same abstract affordance graph even though the bindings differ.

Do not literally replace current Connector Fabric with WoT; adopt the design principle.

### 4.5 Kafka Connect / Airbyte / Apache Camel: connector factories, not handwritten integrations

Kafka Connect distinguishes source and sink connectors and distributes connector tasks across workers. Airbyte demonstrates declarative/low-code connector creation for common HTTP APIs. Apache Camel demonstrates a mature component model and Enterprise Integration Patterns across hundreds of systems.

KEY implication:
- create protocol families and declarative adapter templates;
- automatically generate most common HTTP/GraphQL/webhook connectors;
- reserve custom code for genuinely unusual semantics;
- formalize integration patterns: filter, translate, split, aggregate, scatter-gather, circuit-break, saga, retry;
- connector code should be mostly configuration against reusable protocol/runtime primitives.

### 4.6 Reactive Streams + Flink event time: ingest many streams without drowning

Reactive Streams exists specifically for asynchronous streams with non-blocking backpressure. Flink distinguishes event time from processing time and uses watermarks to coordinate out-of-order parallel streams.

KEY implication:
- the receptor fabric needs explicit backpressure and bounded queues;
- event time, observed time and recorded time must remain separate;
- streams need sequence/offset/watermark semantics where available;
- late/out-of-order data should update the world model without pretending it happened "now";
- idle or lagging sources should not freeze the whole cognitive system.

This connects directly to Context Genome bitemporality.

### 4.7 Erlang/actor systems: isolate concurrent conversations/workflows

Actor-like systems reduce concurrency problems by giving each actor isolated state and serializing messages to that actor, while many actors run concurrently. Erlang/OTP supervision trees restart failed workers.

KEY implication:
- one packet/workflow/conversation can behave as an actor/mailbox;
- many can run concurrently;
- one semantic object keeps one writer/lease by default;
- supervisors recover workers;
- joins return evidence/results to KEY rather than merging workers into identities.

This directly supports #110/#118/#119/#121.

### 4.8 OpenTelemetry + eBPF: interoception and deep authorized system sensing

OpenTelemetry normalizes traces, metrics, logs and context. eBPF can attach to kernel/application hook points for high-fidelity observability/security/networking with verifier-enforced sandboxing.

KEY implication:
- use OpenTelemetry as a general internal "nervous telemetry" layer;
- where the owner explicitly enables it, local agents can use OS-level observability to expose process/network/system signals;
- eBPF-style instrumentation is a model for deep sensing without modifying every application;
- deep telemetry remains observational by default, least-privilege, and explicitly authorized.

### 4.9 Browser and OS semantic fallbacks

Chrome DevTools Protocol exposes DOM/network/debugger/etc. commands/events. Windows UI Automation exposes a semantic desktop UI tree and interaction patterns.

KEY implication:
integration-depth preference should remain:

1. official API/SDK;
2. official webhook/change stream/subscription;
3. MCP or machine-readable protocol surface;
4. native OS/device API;
5. browser protocol/extension/native messaging;
6. accessibility/UI automation;
7. user-mediated/manual path.

The fallback should be semantic and permissioned, never covert screen scraping where a stable interface exists.

### 4.10 CDC: source-of-change receptors

Database change-data-capture systems can emit committed INSERT/UPDATE/DELETE changes from database logs or CDC facilities.

KEY implication:
- when a database owner explicitly authorizes it, CDC can be a high-fidelity receptor for state change;
- treat CDC as observation of source-system change, not business authorization;
- retain source offset, commit/event time, table/entity mapping and schema version;
- never infer that access to CDC implies permission to write back.

## 5. Proposed convergence: Adaptive World Interface Fabric

Do **not** create a new parallel service family. Treat this as the evolution of:
- Connector Fabric;
- Adaptive Receptor Fabric;
- Capability Registry;
- Event Mesh;
- Context Genome;
- K2 Reality;
- K5 Executive/Specialization;
- K6 Agency;
- K7 Adaptation.

Conceptual flow:

```text
WORLD / SOFTWARE / DEVICES / PEOPLE / DATA
        |
        v
INTERFACE DISCOVERY
  MCP | OpenAPI | GraphQL | AsyncAPI | WoT | SDK manifests
  webhooks | CDC | browser | OS APIs | device protocols | telemetry
        |
        v
ADAPTER / RECEPTOR COMPILER
  auth/grants
  schemas
  protocol binding
  source identity
  events/resources/actions
        |
        v
SHADOW CONFORMANCE + SECURITY + SEMANTIC TEST
        |
        v
RECEPTOR / EFFECTOR REGISTRY
        |
        +---------------------------+
        |                           |
        v                           v
MULTI-STREAM RECEPTOR FABRIC     CAPABILITY / TOOL FABRIC
        |                           |
        v                           v
OBSERVATION ENVELOPE            ACTION CONTRACT
        |                           |
        v                           v
backpressure / event time       authority / approval
dedupe / entity resolution      idempotency / saga
salience / source quality       effect certainty
multimodal fusion              verification
        |                           |
        v                           |
CONTEXT GENOME / WORLD MODEL <-----+
        |
        v
KEY EXECUTIVE
  active sensing
  tool selection
  workflow compilation
  specialization
        |
        v
ACTION / OUTCOME
        |
        +--> learning / receptor evolution
```

## 6. Canonical observation envelope expansion

The receptor/event contract should carry enough information to synchronize heterogeneous streams without destroying provenance.

Candidate fields:

```text
observation_id
source_id
receptor_id
connector_id
connector_generation
scope
tenant_id / user_id / device_id where applicable
modality
schema_id + schema_version
source_event_id
stream_id
stream_position / sequence / offset
observed_at
occurred_at
recorded_at
valid_from / valid_to where applicable
content_hash
raw_evidence_pointer
entity_candidates
relation_candidates
correlation_id
causation_id
self_generated / external
confidence
verification_state
source_authority
sensitivity/privacy tags
latency
quality
replay/idempotency key
```

Rule: **fusion never deletes the underlying observations.**

## 7. Multi-stream synchronizer

Multiple simultaneous information streams need a dedicated logical stage before cognition.

Responsibilities:
- protocol ingestion;
- bounded queues/backpressure;
- event-time alignment;
- watermark/lag tracking;
- deduplication;
- entity resolution;
- correlation/causation linking;
- contradiction detection;
- source quality;
- modality-specific transforms;
- salience/gain;
- aggregation/windowing;
- partial results when one stream is unavailable.

Important distinction:

> "Synchronous experience" for the user does not require synchronous blocking I/O internally.

The implementation should usually be asynchronous/event-driven, then create deterministic synchronized views for KEY.

## 8. Receptor expansion loop

A KEY-native receptor should be able to evolve through a governed lifecycle:

```text
UNSUPPORTED / UNKNOWN INPUT
        |
        v
ReceptorGap
        |
        v
discover available interface descriptions
        |
        +-- MCP registry/server manifest
        +-- OpenAPI
        +-- GraphQL introspection
        +-- AsyncAPI
        +-- WoT Thing Description
        +-- SDK/plugin manifest
        +-- documented event/webhook surface
        +-- authorized OS/browser/device surface
        |
        v
compile candidate receptor/effector
        |
        v
sandbox + conformance + security tests
        |
        v
SHADOW
        |
        v
measure value / reliability / leakage / latency / cost
        |
        v
human/governed promotion
        |
        v
ACTIVE CAPABILITY
        |
        v
monitor -> adapt -> deprecate or specialize
```

This is the integration equivalent of receptor evolution.

## 9. Tool-base expansion without tool explosion

KEY should not expose every provider endpoint directly to cognition.

Maintain a hierarchical Capability Graph:

```text
intent-level capability
  -> provider-neutral operation
     -> implementation binding
        -> protocol endpoint / local tool
```

Example:

```text
"schedule a meeting"
  -> calendar.event.create
     -> Google Calendar binding
     -> Microsoft Graph binding
     -> local device calendar binding
```

Each capability should carry:
- typed input/output;
- read/write/effect class;
- auth/grant requirements;
- risk;
- reversibility;
- idempotency;
- cost/latency;
- expected evidence;
- supported scopes;
- provider implementations;
- health/reliability;
- rate/quota limits;
- freshness;
- deterministic/probabilistic behavior.

Repeated successful multi-tool workflows may later be promoted into a higher-level **skill/procedure**, but only after eval and lineage proof.

## 10. Active sensing controller

K5 should be able to decide not only "which tool should I call?" but:

> "Which observation would reduce uncertainty enough to matter?"

Candidate objective:

```text
value_of_information
- acquisition_cost
- latency_cost
- privacy_cost
- risk
- cognitive_resource_cost
```

Possible actions:
- refresh one source;
- subscribe to a stream;
- inspect a related record;
- request a delta since a known cursor;
- ask the user;
- query a second independent source;
- increase sampling during an anomaly;
- reduce sampling when stable.

This gives KEY goal-directed perception rather than indiscriminate data hoarding.

## 11. Connectivity-depth ladder

For each target system, prefer the deepest **authorized semantic** layer available:

| Depth | Surface | Typical value |
|---|---|---|
| L1 | official REST/GraphQL/gRPC API | structured resources/actions |
| L2 | webhooks/push/subscriptions/AsyncAPI | real-time events |
| L3 | CDC/event log | source-of-change state transitions |
| L4 | MCP/plugin/tool protocol | AI-oriented capabilities |
| L5 | native OS/device SDK | local device/system state/actions |
| L6 | browser protocol/extension | DOM/network/browser context |
| L7 | semantic accessibility/UI automation | fallback for GUI-only apps |
| L8 | OpenTelemetry/eBPF/local instrumentation | deep system interoception/observability |

Depth is not authority. Higher depth usually means **higher privacy/security sensitivity** and therefore stronger consent, scopes, sandboxing, audit and revocation.

## 12. Research-driven additions to current Connector Fabric

PR #105 is strong, but this pass recommends explicitly adding:

1. **Interface Discovery Engine** — discovers machine-readable interfaces and supported protocols.
2. **Descriptor Normalizer** — maps MCP/OpenAPI/GraphQL/AsyncAPI/WoT/SDK manifests into one connector candidate model.
3. **Connector/Receptor Compiler** — generates typed adapter scaffolds and tests.
4. **Multi-Stream Synchronizer** — backpressure, event-time, watermarks, joins, dedupe, source quality and fusion.
5. **Active Sensing Controller** — goal-directed queries/subscriptions based on value of information.
6. **Capability Graph** — separates intent-level capability from provider endpoint.
7. **Receptor Evolution Lifecycle** — gap -> candidate -> shadow -> certified -> active -> adapt/deprecate.
8. **Deep Local Interoception Layer** — OpenTelemetry and optional OS telemetry/instrumentation under explicit consent.
9. **Bidirectional Affordance Model** — Resource/Property, Action/Tool, Event/Stream.
10. **Connector conformance/eval harness** — semantic tests, not merely transport success.

These should be absorbed into existing ownership (CONNECTOR / INGRESS / KNOWLEDGE / ACTION / RECOVERY / UX / KEY cognitive K2-K7), not introduced as a new sovereign programme.

## 13. Relationship to concurrency

Concurrency and connectivity are one problem at two boundaries:

- **Concurrency:** many internal workers/conversations/streams at once.
- **Connectivity:** many external sources/systems at once.

Both need:
- identity;
- isolation;
- typed messages;
- backpressure;
- ordering;
- event time;
- idempotency;
- leases/generations;
- dependency graphs;
- supervision;
- provenance;
- deterministic join/convergence.

The same actor/event architecture that lets multiple Claude/ChatGPT sessions work safely can become the substrate that lets KEY ingest and coordinate many world streams.

## 14. Implementation research sequence

### R0 — inventory
Map current connector/receptor/event/capability code and PR #105 against this research.

### R1 — narrow-waist contracts
Harden:
- Observation;
- Event;
- Resource/Property;
- Action/Tool;
- Capability;
- ProtocolBinding;
- ConnectorManifest;
- ReceptorManifest;
- StreamCursor/Watermark.

### R2 — multi-stream semantics
Introduce bounded backpressure/event-time/cursor/late-event contracts in shadow form.

### R3 — descriptor ingestion
Prototype read-only import of OpenAPI + one event descriptor format + MCP manifest into candidate capabilities.

### R4 — connector compiler
Generate a read-only connector candidate, tests and capability projection from descriptors.

### R5 — active sensing
Use uncertainty + value-of-information to choose a read/refresh/subscription action in shadow mode.

### R6 — deep local surfaces
Qualify browser/Windows/device semantic adapters and observability inputs under explicit permission.

### R7 — promoted tool/skill evolution
Allow proven repeated workflows to become higher-level capabilities only through eval, governance and lineage.

## 15. Hard invariants

- Connectivity != authority.
- Observation != fact.
- Repetition != authority.
- Tool discovery != tool trust.
- Tool availability != permission.
- Higher integration depth requires stronger consent/audit, not weaker controls.
- Prefer semantic APIs/events over UI automation.
- Preserve raw evidence and provenance.
- Backpressure is mandatory for unbounded streams.
- Event time != processing time.
- A receptor may fail without stopping unrelated receptors.
- Unknown input may create a receptor-gap candidate, never an automatic privileged adapter.
- Dynamically generated adapters start in sandbox/shadow mode.
- No connector may silently broaden its scopes.
- One KEY identity; multiple receptors/tools/workers are capabilities/topology, not identities.
- Do not onboard an external orchestration platform merely because its design is useful; implement the learned patterns natively unless explicitly decided otherwise.


## 16. Stress-response / regulatory-program architecture

The biological analogy should be refined slightly: DNA does not literally "send a packet". A stress signal activates signaling pathways and transcription factors, which induce a coordinated gene-regulatory program. That program can increase or decrease expression of receptors, enzymes, transporters and signaling machinery; endocrine/neural systems can also alter hormone release, receptor sensitivity and downstream responsiveness on different time scales.

That is a strong model for KEY.

KEY should support a first-class **Regulatory Program / Response Program**: a bounded, typed instruction bundle that temporarily reconfigures many subsystems together when a recognized condition is present.

Conceptually:

```text
STIMULUS / CONDITION
        |
        v
STATE CLASSIFIER
  anomaly | opportunity | overload | uncertainty | incident | deadline | recovery
        |
        v
REGULATORY PROGRAM
        |
        +-- receptor up/down-regulation
        +-- sampling-rate changes
        +-- attention/salience weighting
        +-- tool/capability availability
        +-- model/reasoning depth
        +-- worker/swarm topology
        +-- resource/compute budget
        +-- retry/backoff policy
        +-- memory retrieval/consolidation bias
        +-- approval/safety thresholds
        +-- telemetry/interoception depth
        +-- communication/escalation behavior
        |
        v
TEMPORARY OPERATING STATE
        |
        v
OUTCOME / FEEDBACK
        |
        v
DECAY / RECOVERY / CONSOLIDATION
```

### 16.1 Why this should be a coordinated packet

Without a coordinated regulatory program, stress or opportunity handling becomes scattered local conditionals:

`if incident -> poll faster`
`if uncertainty -> use bigger model`
`if overload -> reduce sampling`
`if deadline -> spawn workers`

That creates hidden interactions and unstable behavior.

A regulatory program makes the coordinated response explicit, versioned, inspectable and reversible.

Candidate contract:

```text
RegulatoryProgram {
  id
  version
  trigger_conditions
  applicable_scopes
  activation_evidence
  priority
  mode
  ttl / decay
  receptor_modulation[]
  stream_modulation[]
  attention_modulation[]
  cognition_modulation[]
  resource_modulation[]
  capability_modulation[]
  topology_modulation[]
  safety_modulation[]
  memory_modulation[]
  telemetry_modulation[]
  exit_conditions
  recovery_program
  provenance
}
```

### 16.2 Fast and slow response layers

Biology uses responses on multiple time scales. KEY should too.

**Fast layer — reflex / autonomic**
- milliseconds to seconds;
- deterministic limits, circuit breakers, rate reduction, queue shedding, failover, hold, alerting;
- should not depend on elaborate model reasoning.

**Intermediate layer — executive modulation**
- seconds to minutes;
- increase/decrease sampling;
- allocate more compute;
- switch reasoning depth;
- call independent verifier;
- spawn bounded parallel workers;
- alter retrieval depth;
- change tool-selection strategy.

**Slow layer — adaptive / transcription-like**
- minutes to days;
- promote a repeated receptor gap into an adapter candidate;
- change durable routing weights;
- add a new procedure/skill;
- alter consolidation priorities;
- propose a new connector/receptor;
- update long-term policy only through governed evidence.

This prevents every transient stressor from causing permanent architectural change.

### 16.3 Example programs

#### INCIDENT_RESPONSE
Trigger:
- integrity violation;
- repeated failed effects;
- strong anomaly;
- security/reliability threshold crossed.

Possible coordinated modulation:
- up-regulate logs, traces and critical receptors;
- increase independent verification;
- reduce or freeze high-risk writes;
- increase evidence retention;
- allocate incident worker topology;
- narrow authority;
- raise alert/escalation salience;
- increase source cross-checking;
- activate recovery planning.

#### INFORMATION_DEFICIT
Trigger:
- decision-critical uncertainty above threshold.

Modulation:
- increase active sensing;
- query additional independent sources;
- raise retrieval depth;
- increase temporal/history lookback;
- temporarily allocate larger reasoning budget;
- reduce irreversible action authority until evidence improves.

#### HIGH_LOAD
Trigger:
- stream volume, queue depth, token/compute cost or latency exceeds envelope.

Modulation:
- down-regulate low-value receptors;
- aggregate/window repetitive events;
- lower sampling frequency;
- defer low-salience cognition;
- preserve high-risk/high-authority streams;
- enforce backpressure and admission control.

#### OPPORTUNITY_BURST
Trigger:
- time-sensitive high-value opportunity.

Modulation:
- increase relevant market/customer/event receptors;
- prioritize required tools;
- allocate bounded parallel analysis;
- shorten non-critical polling elsewhere;
- preserve ordinary safety/authority boundaries.

#### RECOVERY
Trigger:
- incident condition cleared.

Modulation:
- gradually restore normal receptor gain;
- release temporary holds;
- reconcile deferred events;
- consolidate incident learning;
- evaluate whether any temporary adaptation merits durable promotion.

### 16.4 Up-regulation and down-regulation

A receptor should not only be ON/OFF.

Useful modulation dimensions include:
- sampling frequency;
- event subscription breadth;
- batch/window size;
- allowed latency;
- data fidelity;
- retention depth;
- independent-source requirement;
- compute allocated to interpretation;
- salience weight;
- rate limit;
- notification/escalation threshold.

This is closer to biological receptor sensitivity and endocrine modulation than a binary feature flag.

### 16.5 Homeostasis and allostatic load

Repeated activation must have a cost.

Every regulatory program should charge against explicit budgets:
- compute;
- token/model cost;
- API quota;
- bandwidth;
- storage;
- worker slots;
- human attention;
- latency;
- operational risk.

KEY should track cumulative **allostatic load**: prolonged elevated operating state should trigger recovery or resource rebalancing rather than becoming the silent new normal.

### 16.6 Hysteresis and anti-flapping

Triggers should not oscillate rapidly.

Use:
- activation thresholds;
- separate recovery thresholds;
- minimum dwell time;
- cooldown;
- evidence persistence;
- exponential decay.

Example:

```text
activate HIGH_LOAD at queue > 80%
recover only after queue < 50% for 5 min
```

This prevents continuous up/down receptor thrashing.

### 16.7 Regulatory hierarchy

Not all programs are equal.

Suggested precedence:

```text
CONSTITUTION / HUMAN AUTHORITY
        >
SAFETY / SECURITY / INCIDENT
        >
RESOURCE VIABILITY
        >
TASK / GOAL OPTIMIZATION
        >
PREFERENCE / STYLE
```

A performance-oriented program may not override a safety or authority program.

Conflicting programs should be composed through explicit arbitration rather than last-write-wins.

### 16.8 Relationship to K1-K7

- K1 Self/Constitution: sets non-overridable bounds and program precedence.
- K2 Reality: detects triggering conditions and receptor state.
- K3 Memory/World Model: supplies context/history and records activation lineage.
- K4 Cognition: changes reasoning methods/depth.
- K5 Executive: selects/activates programs and arbitrates conflicts.
- K6 Agency: changes execution topology, tools and operational behavior.
- K7 Adaptation/Viability: homeostasis, recovery, learning and durable promotion.

### 16.9 Hard invariants

- A stress response changes **operating configuration**, not identity.
- Temporary modulation must not silently become permanent policy.
- Resource escalation does not imply authority escalation.
- Receptor up-regulation increases observation, not truth.
- More workers/models do not imply more confidence without independent evidence.
- Emergency mode must have explicit entry, exit and recovery criteria.
- Every activation is attributable to evidence and recorded.
- Every program is reversible unless a separately governed durable change is accepted.
- Competing programs compose by declared precedence and arbitration, never accidental last-write-wins.

This regulatory-program model should become part of the future Specialization/Executive compiler and Adaptive Receptor Fabric rather than a separate biological subsystem.


## 17. Primary references used

- Model Context Protocol specification: https://modelcontextprotocol.io/specification/
- Official MCP Registry: https://registry.modelcontextprotocol.io/
- OpenAPI Specification: https://spec.openapis.org/oas/latest.html
- GraphQL Introspection: https://graphql.org/learn/introspection/
- AsyncAPI Specification: https://www.asyncapi.com/docs/reference/specification/
- CloudEvents: https://github.com/cloudevents/spec
- W3C Web of Things Thing Description: https://www.w3.org/TR/wot-thing-description-2.0/
- Apache Kafka Connect documentation: https://kafka.apache.org/documentation/
- Airbyte Connector Development: https://docs.airbyte.com/platform/connector-development
- Apache Camel / Enterprise Integration Patterns: https://camel.apache.org/
- Reactive Streams: https://www.reactive-streams.org/
- Apache Flink event time/watermarks: https://nightlies.apache.org/flink/
- Erlang/OTP Design Principles: https://www.erlang.org/doc/system/design_principles.html
- OpenTelemetry Signals: https://opentelemetry.io/docs/concepts/signals/
- eBPF: https://ebpf.io/what-is-ebpf/
- Chrome DevTools Protocol: https://chromedevtools.github.io/devtools-protocol/
- Microsoft UI Automation: https://learn.microsoft.com/windows/win32/winauto/
- Debezium CDC: https://debezium.io/documentation/
- sensory adaptation / gain control / active sensing / multisensory integration / receptor evolution literature referenced in the accompanying research discussion.
