# KeyFlowOS System Model

Status: WORKING CANONICAL MACRO MODEL

This file captures the current macroscopic understanding of how the major KeyFlowOS systems relate. It is not a substitute for journey-level microscopic analysis.

## Core causal model

```text
Human founder / operator intent
        |
        v
BUSINESS GENESIS
        |
        v
BUSINESS BLUEPRINT
        |
        v
BUSINESS GENOME
        |
        v
LIVING BUSINESS CONSTITUTION
        |
        | governs / constrains
        v
+--------------------------------------------------+
|              OPERATING BUSINESS                  |
|                                                  |
|   BUSINESS GRAPH <----> TEMPORAL FLOW            |
|          |                  |                    |
|          +--------+---------+                    |
|                   v                              |
|                  KEY                             |
|                   |                              |
| Observe -> Understand -> Reason -> Recommend     |
|          -> Act within authority -> Learn        |
|                   |                              |
|                   v                              |
|                OUTCOMES                          |
+--------------------------------------------------+
        |
        v
Evidence / observations / results
        |
        v
Genome updates / evolution proposals / governance
        |
        +-----------------------------> Genome
```

## Interpretation

### Business Genesis

Genesis is the business-formation and business-discovery intake layer. It converts founder/operator intent, answers, context, and supporting evidence into structured business understanding.

### Business Blueprint

The Blueprint is a structured representation of business facts. Current code uses it as a major source for Genome reasoning and as a synchronization target for relevant business-profile changes.

### Business Genome

The Genome is intended to be living operating DNA rather than a one-time onboarding profile. Current implementation includes evidence-aware facts, multi-axis scoring, integrity measures, readiness, and cross-domain interpretation.

### Living Business Constitution

The Constitution is a versioned, governed expression of the business understanding. It should be treated as downstream of evidence-backed business knowledge rather than as an arbitrary generated document.

### Business Graph

The Business Graph is the connected operational reality: people, contacts, services, products, projects, invoices, bookings, communications, relationships, assets, and other domain entities and their links.

### Temporal Flow

Temporal Flow represents what happens through time: events, commitments, transitions, histories, urgencies, future obligations, and changing operational state.

### KEY

KEY is the intelligence/orchestration layer. The accepted direction is that KEY should create intelligence, not unchecked authority. Its ability to act should depend on context, evidence, readiness, permissions, governance, and risk.

### Readiness and capability gating

The current implementation contains Genome readiness and autonomy gating. The microscopic programme must determine whether these mechanisms form a coherent capability model across the complete lifecycle of a business.

## System-model cautions

1. This diagram expresses intended causal relationships, not proof that every current code path respects them.
2. Historical systems may coexist with newer systems. Duplicate aggregators, orphan routes, legacy modules, and partial rewrites must be classified rather than silently ignored.
3. Business creation at the database/API level may not equal semantic "Business Birth" at the product level.
4. Blueprint, Genome, Constitution, Graph, and Temporal Flow must remain distinct concepts unless later evidence shows a different canonical model is required.

## Microscopic target

Each journey analysis should progressively answer:

```text
entry state
  -> human action/intent
  -> interface state
  -> API/command
  -> domain operation
  -> database mutations
  -> events/queues/jobs
  -> Graph/Temporal effects
  -> Genome/evidence effects
  -> KEY knowledge/authority changes
  -> visible outcome
  -> exit state
```

The first active journey is `KF-JOURNEY-001 — Business Birth`.
