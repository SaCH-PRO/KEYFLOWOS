# KeyFlowOS Master Context

Status: CANONICAL FOUNDATION — subject to controlled refinement as evidence improves.

## Product intent

KeyFlowOS is being developed as a business operating system for SMEs, freelancers, service businesses, and other operators who currently manage fragmented workflows across multiple disconnected tools.

The system's deeper ambition is not merely to collect business modules in one interface. It is to create a coherent digital operating system in which the business can be understood as a connected, evolving system and in which KEY can assist with observation, reasoning, recommendation, execution within authority, and learning.

## Stable product principles recovered from prior work

1. **Business activity should flow, not fragment.** Customer, operational, financial, temporal, communication, and intelligence state should connect rather than requiring repeated manual re-entry.
2. **AI is an operational intelligence layer, not merely a content-generation feature.**
3. **Create intelligence, not unlimited authority.** KEY's ability to act must be constrained by business context, evidence, permissions, readiness, risk, and governance.
4. **The system should be pre-opinionated enough to create value quickly, while remaining composable and evolvable.**
5. **Implementation reality, intended architecture, and historical blueprint must be distinguished during analysis.**
6. **Isolation is a development strategy; seamless integration is the user-facing outcome.** Controlled synchronous coupling is permitted where critical UX requires it.
7. **The application's true model is causal and cross-domain.** Modules alone are not sufficient to explain KeyFlowOS; end-to-end business journeys must be understood.

## Current macro architecture

The accepted macro model currently centers on:

- **Business Genesis** — structured formation/discovery of the business and its intent/context.
- **Business Blueprint** — structured business facts used as one major substrate of business understanding.
- **Business Genome** — the living, scored, evidence-backed understanding of what the business is, how it operates, what constrains it, how ready it is, and what it may safely do.
- **Living Business Constitution** — versioned/governed expression of the business's operating understanding and rules.
- **Business Graph** — connected operational entities and relationships representing the business's actual state.
- **Temporal Flow** — activities, commitments, events, state transitions, history, and future-oriented operational time.
- **KEY** — intelligence/orchestration layer that observes, understands, reasons, recommends, acts within authority, and learns from outcomes.
- **Capabilities/readiness/autonomy gates** — mechanisms that constrain what can be generated or executed when sufficient verified business context is absent.
- **Business Command Center / operating surfaces** — read models and interfaces that expose business health, priorities, risks, opportunities, approvals, readiness, and current operational state.

## Important semantic distinction

The terms Blueprint and Genome must not be treated as synonyms without evidence.

Current implementation evidence indicates:

- the Blueprint stores structured business facts;
- GenomeFact/GenomeEvidence represent more atomic and evidence-aware knowledge;
- scoring assesses completeness, quality, confidence, freshness, and operational readiness;
- the Genome is a reconciled/evidence-backed interpretation of structured facts plus wider observed state;
- the Constitution is a versioned/governed expression derived from that understanding.

This distinction remains subject to microscopic validation across all write paths.

## Analysis purpose

The current analytical programme exists to build a durable, computable representation of KeyFlowOS that can be consumed by ChatGPT, Claude Code, Kimi Code, future agents, and human collaborators.

The programme is not satisfied by a code map. It must eventually make it possible to reason from an arbitrary business state to:

- what entities should exist;
- what state transitions occurred;
- what KEY knows and does not know;
- what evidence supports that knowledge;
- what actions are permitted or blocked;
- what the user should experience;
- what events and side effects should occur;
- what invariants must hold;
- what tests prove the journey correct;
- where implementation differs from intended architecture.

## Current phase

Macroscopic system understanding has been developed and refined. The next active phase is the **computable microscopic model**, beginning with `KF-JOURNEY-001 — Business Birth`.

Do not assume later journey identifiers or their order until they are formally recovered or accepted in `03-ANALYSIS-MAP.md`.
