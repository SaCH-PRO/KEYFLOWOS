# KEYFLOWOS Research Corpus — Implementation Disposition Matrix

Status: CORPUS TRIAGE COMPLETE / TARGETED RESEARCH CONTINUES  
Authority: RESEARCH_ONLY

## Purpose

Ensure every source in `RESEARCH-CORPUS.yaml` has a clear role after Book × GenAI convergence.

A source can be valuable without producing a new implementation packet.

Disposition vocabulary:

- IMPLEMENTATION_BEARING — mechanisms survived cross-pressure and can support bounded engineering.
- OWNER_STRENGTHENING — useful, but findings route into an existing canonical programme/owner.
- RESEARCH_ONLY — useful for concepts/hypotheses; no current implementation need.
- METAPHOR_ONLY — may generate questions but is not technical evidence.
- SOURCE_VERIFICATION_REQUIRED — bibliographic/claim verification blocks extraction.
- CONTESTED_EMPIRICAL — technical adoption requires independent/current evidence.

## Matrix

| Source | Evidence posture | KEY / GenAI contribution | Disposition |
|---|---|---|---|
| Weinberg — Psychology of Computer Programming | software/social systems | shared repository truth, artifact-over-agent, roles/review | IMPLEMENTATION_BEARING -> ContextBundle + Development Organism |
| Hermans — Programmer's Brain | cognitive science applied to programming | cognitive failure taxonomy, context budget, external representations | IMPLEMENTATION_BEARING -> Context Compiler |
| Clean Code | engineering prescriptions | naming/readability/error handling; method-size rules remain contextual | OWNER_STRENGTHENING; pressure-test against Ousterhout |
| DDIA | distributed systems engineering | retries, consistency, identity, replay, reconciliation, derived projections | IMPLEMENTATION_BEARING across Context/Effects/Assurance |
| SICP | formal/computational models | interpreters, abstraction barriers, state/time models, compositional semantics | IMPLEMENTATION_BEARING -> semantic contracts/Procedure/Flow |
| Norman — Design of Everyday Things | human factors / design | signifiers, feedback, system image, error-resilient interaction | IMPLEMENTATION_BEARING -> action-understanding projection |
| Kahneman — Thinking, Fast and Slow | CONTESTED_EMPIRICAL in parts | broad fast/deliberative routing hypothesis only | OWNER_STRENGTHENING -> CognitiveTriage; replication-aware |
| Brooks — Mythical Man-Month | software-project engineering | conceptual integrity, coordination cost, no silver bullet | IMPLEMENTATION_BEARING -> development-agent orchestration |
| Peopleware | organizational/software-team | interruption/handoff/environment cost | IMPLEMENTATION_BEARING -> development-organism metrics |
| Kernighan/Pike — Practice of Programming | engineering practice | interfaces, debugging, testing, portability, notation | OWNER_STRENGTHENING -> proof profiles/tooling |
| Algorithms to Live By | computational decision analogies | explore/exploit, stopping, scheduling, cache/search | OWNER_STRENGTHENING -> bounded routing/experiments |
| Tornhill — Software Design X-Rays | behavioral code analysis | hotspots, temporal coupling, evolution evidence | IMPLEMENTATION_BEARING -> offline architecture analyzer |
| GEB | formal systems + philosophy/metaphor | representation, recursion, self-reference questions | RESEARCH_ONLY; formal mechanisms routed to Assurance |
| I Am a Strange Loop | philosophical/cognitive model | self-model != authority | OWNER_STRENGTHENING; no new self-model runtime |
| Logicomix | historical/philosophical logic | foundations/proof culture | RESEARCH_ONLY |
| The Little Prover | formal program proof | exact proof at deterministic boundaries | IMPLEMENTATION_BEARING -> proof-class honesty |
| Hardy — Mathematician's Apology | philosophy/aesthetics | elegance/compression as heuristic | RESEARCH_ONLY; never proof of architecture quality |
| Wisdom Codes | spiritual/self-help; empirical claims require verification | language/value hypotheses only | METAPHOR_ONLY / CONTESTED_EMPIRICAL |
| Tao of Programming | programming satire/philosophy | tradeoff/organizational metaphors | METAPHOR_ONLY |
| Fibonacci Codex | bibliographic and substantive verification incomplete | none until verified | SOURCE_VERIFICATION_REQUIRED |
| Happiness Hypothesis | psychology + comparative wisdom | human-value/wellbeing hypotheses | CONTESTED_EMPIRICAL / RESEARCH_ONLY |
| Beginner's Guide to Constructing the Universe | mixed mathematics/symbolism | pattern/geometry hypotheses | RESEARCH_ONLY; separate math from symbolism |
| Pāṇini — Aṣṭādhyāyī | historical formal rule system; modern computational analysis exists | compact generative rules, precedence, metalanguage | OWNER_STRENGTHENING -> DSL/policy semantics |
| I Ching | historical/combinatorial symbolic system | combinatorial metaphor / historical comparison | METAPHOR_ONLY unless exact mathematical claim isolated |
| Sefer Yetzirah | religious/mystical primary text | symbolic/combinatorial analogy | METAPHOR_ONLY |
| Power of Kabbalah | spiritual self-help | technology metaphors | METAPHOR_ONLY |
| Algorithmic Kabbalah: AI Through the Zohar | source identity unverified | none | SOURCE_VERIFICATION_REQUIRED |
| Pragmatic Programmer | engineering practice | contracts, tracer bullets, orthogonality, automation, reversibility | IMPLEMENTATION_BEARING -> Context/Proof tooling |
| Flow — Csikszentmihalyi | human psychology | interruption/clear-goal/feedback hypotheses | OWNER_STRENGTHENING for developer workflow; no AI anthropomorphism |
| Ousterhout — Philosophy of Software Design | software design | deep modules, information hiding, complexity | IMPLEMENTATION_BEARING -> anti-duplication/context interfaces |
| Fowler — Refactoring | software engineering | small behavior-preserving transformations | OWNER_STRENGTHENING -> migration/proof classification |
| Beck — TDD By Example | software engineering practice | rapid feedback, red/green/refactor | OWNER_STRENGTHENING -> proof funnel |

## What this means for implementation

The corpus does NOT justify 30 implementation projects.

It converges to five implementation-bearing clusters:

1. **Context / cognition**
   - ContextBundle
   - deterministic context compiler
   - cognitive failure taxonomy
   - risk-aware cognitive routing

2. **Development organism**
   - artifact-over-agent authority
   - bounded handoffs
   - coordination-cost metrics
   - behavioral hotspot/change-coupling analysis

3. **Semantic contracts / computation**
   - explicit interpreters/contracts
   - Procedure/Flow composition
   - temporal/state semantics
   - rule precedence/derivation

4. **Action understanding / human interaction**
   - visible proposal/authority/execution/outcome distinctions
   - signifiers and feedback
   - error-resilient confirmation/approval

5. **Assurance**
   - proof-class honesty
   - exact deterministic proof where applicable
   - integration/external-effect/semantic proof separation
   - mutation-sensitive evidence

Everything else either strengthens these clusters or remains research/metaphor.

## GenAI cross-convergence result

The 10-layer GenAI stack provides modern mechanism families.

The book corpus provides pressure tests for:
- cognition;
- representation;
- abstraction;
- state/time;
- coordination;
- human interaction;
- proof;
- failure.

Together they converge on one architecture rather than parallel intellectual stacks.

## Safety conclusion

No spiritual, symbolic, philosophical or psychological source may bypass:
- repository evidence;
- formal/empirical verification;
- canonical ownership;
- control-plane authority;
- negative-control proof.

The implementation-bearing corpus is now sufficiently classified to proceed through bounded packets rather than further undirected reading.
