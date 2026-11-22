# Memory research and design (KF-MEMORY-RND-001)

Track 2 of owner ruling D-253 (2026-11-22): research and design for a permanent memory system serving both KEY (the
product's AI) and the AI coding agents that build KEYFLOWOS. Research only: nothing here authorises implementation. Under
D-254, KEY's memory packets join the v1 plan once the owner approves the design.

Track 1 (the agents' working memory layer, built) is in `docs/development/agent-memory/` and `scripts/agent-memory/`
(branch `wave/v1-wave-3d`, PR #221). This folder does not duplicate it; the design's section 11 compares the two.

| File | What it is |
|---|---|
| `PRIOR-RESEARCH-RECOVERED.md` | The owner's earlier memory research, recovered from issue #106 (all 13 comments), #122 to #126, PRs #112, #127, #148, the memory sections of #153, and the repository files; invariants quoted verbatim, each claim attributed; what KEY's memory code does today; conflicts in the record shown, not resolved |
| `MEMORY-SCIENCE-PARALLELS.md` | Memory science, the wider nervous system, immunology and clinical memory disorders: for each mechanism the science and its source, evidence strength, the engineering analogue and where the analogy breaks |
| `AI-MEMORY-SYSTEMS-SURVEY.md` | What is known about LLM and agent memory (compaction, caching, RAG, MemGPT/Letta, Mem0, Zep/Graphiti, generative agents, A-MEM, Voyager, state files, sub-agents) and its failure modes; items to verify are marked |
| `KEYFLOW-MEMORY-SYSTEM-DESIGN-001.md` | The proposed design: tiers, canonical vs derived, write path, consolidation, retrieval and the context compiler, procedural memory, safety (tenancy and revenue scope), metamemory, token economics, the agents' and KEY's instantiations, a mechanism ledger, and a check against every owner invariant |
| `EVALUATION-PLAN.md` | How to prove it works: clinical failure modes as tests, the leak suite, poisoning, retrieval and staleness, tokens and cost before and after, ablations |
| `PRODUCT-MEMORY-PACKETS-PROPOSAL.md` | 14 proposed v1 packets for KEY in the plan's JSON shape (proposal only; the plan file is not edited) |
| `OPEN-QUESTIONS-FOR-OWNER.md` | Decisions for the owner, each with options, a recommendation and what it changes |

Read order for the owner: this README, the design's section 0 (ten lines), `OPEN-QUESTIONS-FOR-OWNER.md`, then the packet
summary table. For an agent building a packet: the packet entry, then the design sections it cites.

Labels used throughout: **[SCI]** established science, **[ANA]** analogy, **[OWNER]** the owner's decision, **[PROP]** this
work's proposal, **[INFERRED]** an inference, "verify" a claim to check against its primary source.
