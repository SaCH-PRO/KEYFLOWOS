# KeyFlowOS System Model

Status: WORKING CANONICAL MACRO MODEL — refined by J1/J2/J25 recovery

This file captures the current macroscopic understanding of how the major KeyFlowOS systems relate. It is not a substitute for journey-level microscopic analysis.

## Core thesis

> KeyFlowOS is a governed business-state transition system.

The product is not merely a set of modules or an AI tool runner. It continuously resolves:

- what is true about the business;
- what that truth means;
- what should happen next;
- what action exists to produce the desired change;
- who or what may perform that action;
- whether the exact invocation is presently cleared;
- which executor may consume that clearance;
- what changed and what evidence/outcome was produced.

## Refined causal model

```text
REAL WORLD / EXTERNAL SYSTEMS
        |
        v
   OBSERVATION / SIGNAL
        |
        v
   BUSINESS GRAPH                 What is true?
        |
        v
   BUSINESS GENOME                What does it mean?
        |
        v
        KEY                       What should happen?
        |
        v
    CAPABILITY                    What action exists?
        |
        v
AUTHORITY + POLICY + READINESS    May this exact invocation happen?
        |
        v
     CLEARANCE
        |
        v
  EXECUTION CLAIM                 Which execution process may consume it?
        |
        v
    EXECUTION
        |
        v
BUSINESS STATE TRANSITION
        |
        v
EVENT / EVIDENCE / OUTCOME
        |
        +-----------------------> BUSINESS GRAPH
                                   |
                                   v
                              GENOME EVOLUTION
```

## Formation / business-birth model

```text
Founder / operator intent
        |
        v
BUSINESS GENESIS / ONBOARDING
        |
        v
BUSINESS BLUEPRINT
        |
        v
OBSERVATIONS / ASSERTIONS / EVIDENCE
        |
        v
RESOLVED BUSINESS KNOWLEDGE
        |
        v
BUSINESS GENOME / READINESS
        |
        +-------------------> OPERATING CONFIGURATION
        |                    products/services/hours/public assets/connectors
        v
TENANT + HUMAN AUTHORITY
Business + Membership + authority envelope
        |
        v
COMMAND CENTER / OPERATING BUSINESS
```

Business Birth is therefore broader than inserting a Business row. The recovered model treats it as interlocking human, tenant, knowledge and operating initialization.

## Nine architecture planes

Working macro planes:

1. **Experience Plane** — human/customer/admin/operator interfaces and visible journeys.
2. **Business Semantic Model** — Blueprint, observations, assertions, evidence, resolved facts, Genome and related ontology.
3. **Business Capability Fabric** — stable capability contracts describing business actions.
4. **KEY Intelligence** — observation, context, reasoning, proposal, planning, recommendation and learning.
5. **Authority & Governance** — human authority, KEY autonomy/delegation, policy, approval, clearance and control-plane constraints.
6. **Domain Execution** — services and operations that actually mutate business/external state.
7. **Coordination / Flow / Time** — Temporal Flow, plans, queues, workflows, long-running processes, retries and scheduling.
8. **Business State / Operational Graph** — factual operational entities, relationships and outcomes.
9. **Integration / Infrastructure** — connectors, providers, persistence, queues, storage and runtime infrastructure.

Outside these planes sits the **Engineering Control Plane**: tests, migrations, deployment, observability, safety of system change and architecture governance.

## Knowledge model

### Business Graph

Working definition: the complete factual business state KeyFlowOS can legitimately treat as business reality.

Candidate decomposition:

```text
Business Graph
  = Operational Graph
  + Knowledge Graph
  + Evidence Graph
  + Authority Graph
  + Temporal history
```

The Business Graph is **not** synonymous with the Prisma database. Persistence is one implementation substrate for the graph.

### Business Blueprint

The Blueprint is primarily operator/founder declaration and structured configuration: what humans say or configure about the business. It is a major input to knowledge formation, but it is not automatically canonical observed truth.

### Evidence / assertion / resolved fact

Working Business Knowledge Kernel:

```text
SOURCE
  -> observation / signal
  -> semantic normalization
  -> FactDefinition
  -> assertion
  -> evidence + confidence + verification + freshness + risk
  -> resolution policy
  -> resolved fact
```

Working invariant: **a weaker assertion must never silently overwrite a stronger verified assertion.**

### Business Genome

The Genome is what KEY should currently believe about the business: interpreted and evidence-aware business knowledge plus confidence, gaps, stage, readiness, risk and actionability.

It is not equivalent to Blueprint declarations, raw database state or generic onboarding completeness.

### Living Business Constitution

The Constitution remains a versioned, governed expression of accepted business understanding and operating rules. It should derive from evidence-backed business knowledge and governance rather than act as an unrelated AI document.

## Readiness lattice

Do not collapse all readiness into one boolean.

Working dimensions:

1. Knowledge Readiness
2. Operational Readiness
3. Connectivity Readiness
4. Compliance Readiness
5. Authority Readiness
6. Action Readiness

```text
Knowledge
  + Operational
  + Connectivity
  + Capability
  + Authority
  + Risk Policy
  -> Action Readiness
```

Critical invariant:

`onboardingComplete != Genome healthy != module ready != action authorized != automation safe`

## Capability model

A capability is a stable business-action contract whose identity must survive:

```text
proposal -> policy evaluation -> approval/confirmation -> clearance -> execution -> outcome
```

Recovered current seam: `CapabilityContractService` already approximates this concept and should be evaluated for strengthening before inventing a replacement registry.

Important distinction:

- **Impact Tier:** how consequential an action is.
- **Control Requirement:** what control this particular invocation requires.

Possible control outcomes include AUTO, DIRECT_HUMAN, QUICK_CONFIRM, FORMAL_APPROVAL, ADMIN_APPROVAL, STEP_UP_AUTH, EXPLICIT_DELEGATION and BLOCK.

## Authority model

### Human authority

Human authority originates in a principal's relationship with a business and may be affected by Membership role, JobRole/position, explicit grants, explicit denials, delegations, approval tier and resource/capability context.

Working missing primitive:

```text
principal
  + business
  + Membership
  + role
  + position
  + overrides
  + denials
  + delegations
  + capability
  + resource/context
  -> effective authority
```

### KEY autonomy

KEY autonomy/delegation is a separate axis from human permission. A human being authorized to do something does not imply KEY is authorized to do it autonomously, and vice versa.

## Clearance model

**Clearance** answers: *Is this exact action presently authorized to execute?*

It should bind the exact material action, including capability identity/version and normalized parameters. A material action change should invalidate prior approval/clearance.

Working action fingerprint:

```text
hash(
  businessId
  + capabilityName
  + capabilityVersion
  + normalizedParameters
  + affectedEntities
  + riskTier
)
```

## Execution-claim model

Clearance and execution exclusivity are distinct.

- Clearance: this action may execute.
- Execution claim: this execution process is the one permitted to consume that clearance.

Working lifecycle:

```text
CLEARANCE_GRANTED
  -> atomic claim
  -> CLAIMED
  -> RUNNING
  -> SUCCEEDED | FAILED
```

This is intended to resolve duplicate proposal execution, plan races, queue/direct-execution races, retries, provider idempotency races and crash recovery.

## Principal lineage

Do not collapse all action provenance into one actor field. Working lineage includes:

- requestedBy
- proposedBy
- approvedBy
- executedBy
- executedFor
- delegatedBy

## Hierarchical clearance

A parent plan may authorize child actions without repeated user-hostile approvals only if the exact child capability identities and material parameters are inside the approved parent snapshot. Material mutation requires new clearance.

## Synthetic data

Persisted demo/synthetic bootstrap data must be classified so it cannot silently contaminate financial truth, Business Graph learning, Genome, analytics or readiness.

## Product activation model

Business Birth should expose real customer-visible value as early as safely possible. Existing storefront/public-booking machinery is a candidate activation proof: configuration -> preview/live asset -> share/publish -> first real value.

## System-model cautions

1. This file expresses the working canonical architecture, not proof that every current code path respects it.
2. Current code remains implementation evidence and must be rechecked when commit-sensitive.
3. Historical/legacy systems may remain active; classify consumers before retirement.
4. Proposal approval does not automatically equal portable clearance.
5. An idempotency key does not automatically equal a distributed execution claim.
6. Membership is more than a mere relationship in current implementation, but the final authority algebra is not yet frozen.
7. KEY role governance does not replace human authorization.

## Active convergence

Current analytical mesh:

```text
KF-JOURNEY-001 — Business Birth
        ↕
KF-JOURNEY-025 — Human Authority Lifecycle
        ↕
KF-JOURNEY-002 — KEY Request → Governed Action
```

Do not fully open J15 until tenant identity, effective human authority and execution-claim semantics have converged enough that approval can be analysed without redefining its foundations.
