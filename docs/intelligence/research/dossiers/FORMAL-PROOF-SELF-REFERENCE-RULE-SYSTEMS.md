# Research Dossier — Formal Systems, Proof, Self-Reference and Generative Rules

Sources used in this pass:
- Daniel P. Friedman and Carl Eastlund, *The Little Prover*
- Douglas Hofstadter, *I Am a Strange Loop* / prior GEB self-reference programme
- Pāṇini's Aṣṭādhyāyī as studied in modern formal/computational linguistics
- existing KEYFLOWOS formal/self-reference/symbolic R&D track

Status: TARGETED TRANSLATION PASS 1  
Authority: RESEARCH_ONLY

## Evidence discipline

This dossier deliberately separates:
- formal proof mechanisms;
- historical/computational analysis of rule systems;
- philosophical models of self-reference;
- metaphorical or mystical analogies.

Only the first two can directly support technical implementation claims without additional evidence.

## 1. Formal proof belongs at narrow deterministic boundaries

MIT Press describes *The Little Prover* as an introduction to inductive proofs about programs with a simple proof assistant.

KEYFLOWOS translation:
- use formal/derivable proof where the property is actually formal;
- do not ask an LLM judge to prove what a deterministic checker can prove;
- reserve probabilistic evaluation for semantic properties that cannot be reduced to exact invariants.

Strong candidate domains:
- parser/state-reducer invariants;
- idempotency algebra;
- state-machine reachability;
- schema/contract invariants;
- deterministic policy composition;
- immutable revision/fingerprint properties.

Do not attempt to formally prove the entire product.

## 2. Proof-carrying action is a useful target concept

Consequential execution should increasingly carry machine-checkable evidence of:

- capability identity + version;
- argument fingerprint;
- authority/control requirement;
- principal/evidence chain;
- idempotency/effect identity;
- admitted execution state;
- outcome evidence.

This is not a new authority layer. It is a stronger representation of the existing action boundary and Assurance concepts.

## 3. Self-reference must not become self-authorization

Hofstadter's self-reference/strange-loop work is useful as a philosophical model for systems that represent themselves.

Technical law for KEY:

> SELF-MODEL != SOURCE OF AUTHORITY.

KEY may:
- inspect its own state;
- model its own confidence/capabilities;
- propose changes to prompts/procedures/models;
- evaluate its historical behavior.

But self-generated conclusions about itself remain claims/candidates until admitted through externalized governance/evidence.

This protects against:
- "I believe I am safe, therefore I may act";
- "my self-eval passed, therefore deploy";
- "my generated procedure worked once, therefore promote".

## 4. Generative rule systems support compact semantic contracts

Modern scholarship treats Pāṇini's Aṣṭādhyāyī as a highly formal rule system and actively analyzes its rule interaction and generative power.

Useful technical mechanism:
- compact rules;
- explicit precedence/interaction;
- metalanguage;
- composition;
- derivation trace.

KEYFLOWOS correspondence:
- policy/rule evaluation;
- output grammars;
- capability schemas;
- procedure DSL;
- packet/control grammar.

The lesson is not to imitate Sanskrit grammar. It is to make rule interaction explicit when many compact rules compose.

## 5. Rule order and conflict are part of semantics

A rule set is not just a bag of conditions.

Where multiple rules can apply, the architecture must define:
- precedence;
- composition;
- block/allow interaction;
- conflict behavior;
- defaults;
- fail-open/fail-closed state;
- derivation trace.

This reinforces AutonomyOrchestrator, GuardrailPolicy and packet parser requirements.

## GenAI cross-reference

- Layer 3: procedure/interpreter semantics, not a second runtime.
- Layer 7: constrained/typed output and explicit grammars.
- Layer 8: tool/capability schemas and deterministic interpretation.
- Layer 9: exact proof where possible; semantic eval where necessary.
- Layer 10: policy rule interaction and fail-closed defaults.

## Implementation routing

### READY TO ROUTE — Proof-profile enrichment

Existing `PROOF-PROFILES.yaml` can add an explicit classification:
- EXACT_FORMAL_OR_DETERMINISTIC
- INTEGRATION_STATE
- EXTERNAL_EFFECT
- SEMANTIC_EVALUATION

This helps prevent using LLM/eval proof where exact proof exists.

### READY TO ROUTE — Action proof receipt

Existing action-boundary evidence already carries many proof-carrying fields. A future packet can standardize a projection/receipt without new persistence if the consumer trace proves this is sufficient.

### DO NOT ALLOCATE — self-model runtime

No new "consciousness/self-reference" service is justified from this research.

### DO NOT ALLOCATE — symbolic/mystical computation

I Ching, Kabbalistic, sacred-geometry and similar sources remain metaphorical/historical research unless independent formal or empirical claims survive verification.

## Proof obligations

- exact invariant uses deterministic proof where feasible;
- semantic evaluator cannot override deterministic failure;
- rule conflict/precedence is explicit;
- default/failure state is explicit;
- self-evaluation cannot self-promote;
- action proof receipt binds exact revision/identity;
- mutation of a formal invariant causes deterministic proof failure.

## Disposition

ADOPT:
- proof at formal boundaries;
- explicit rule interaction;
- derivation traces;
- self-model/authority separation.

DEFER:
- broad theorem proving across application behavior.

REJECT:
- self-reference as authority;
- metaphor as evidence;
- formal-looking notation without machine-checkable semantics.

No production change is authorized by this dossier.
