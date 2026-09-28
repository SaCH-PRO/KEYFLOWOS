# KEYFLOWOS Trust Assurance Programme

Status: **CANONICAL CROSS-CUTTING EXECUTION OVERLAY**  
Adopted: 2026-09-28  
Applies to: all KEYFLOWOS execution packets, supporting infrastructure, product surfaces, AI actions, data stores, connectors, providers and release evidence  
Canonical packet count: **unchanged at 35**  
Production release authorized: **false**  
Production mutations authorized by this document: **false**

## 1. Purpose

KEYFLOWOS is a multi-tenant operating system that can hold and act on CRM/contact data, bookings, contracts, invoices/payments, communications, files, connector credentials, knowledge/memory, AI context and business actions. Security, privacy and cyber-liability controls therefore cannot be treated as a late certification task.

This programme makes trust obligations load-bearing across the existing 35-packet convergence programme without creating a competing journey, kernel, authority system or execution runtime.

The programme has four goals:
1. prevent cross-tenant, authority, secret, privacy and external-effect failures by design;
2. make privacy and security obligations traceable to implementation and proof;
3. preserve evidence needed for incident response, assurance and cyber/Technology E&O underwriting;
4. reach production with a defensible security/privacy posture before later SOC 2 / ISO certification work.

## 2. Governing principle

```text
SECURITY / PRIVACY / COMPLIANCE
!= a separate product subsystem

They are constraints on:
identity
authority
action
data
time
external effects
knowledge
finance
recovery
operator evidence
release
```

Existing semantic owners remain authoritative. This overlay strengthens them.

Examples:
- tenant identity/isolation -> K1 / TENANT-001;
- human authority -> K2 / AUTH-001;
- governed actions -> K3/K5/K6/K11 / ACTION-001;
- privacy deletion/retention -> J19 / PRIVACY-001;
- provider certainty/recovery -> EXTFX / INGRESS / CONNECTOR / RECOVERY;
- financial truth -> Wave C packets;
- proof/release -> K12 / INTEGRATED / OPS / RELEASE.

No new security kernel is created unless future evidence proves the existing ownership model cannot express a required invariant.

## 3. Standards and regulatory baselines

These are used as engineering/assurance baselines, not as unsupported claims of legal compliance or certification.

### Core engineering baselines
- NIST Cybersecurity Framework 2.0;
- NIST SSDF 1.1 (SP 800-218);
- OWASP ASVS 5.0.0;
- OWASP API Security;
- NIST AI RMF 1.0 plus current NIST GenAI guidance where applicable.

### Privacy and market overlays
- Trinidad and Tobago Data Protection Act, 2011 (Act 13 of 2011): local statutory baseline; applicability and proclaimed provisions must be confirmed by qualified counsel before relying on them.
- EU GDPR: privacy-by-design/default engineering baseline and binding law where territorial/material scope applies.
- CCPA/CPRA: conditional market overlay when applicable.
- EU AI Act: conditional overlay for applicable EU AI use.
- HIPAA: not a default launch claim; a separate healthcare profile is required before KEYFLOWOS handles ePHI as an applicable business associate.

### Financial/assurance baselines
- PCI DSS 4.0.1: payment security baseline; KEYFLOWOS should minimize scope by avoiding raw PAN/CVV storage/processing/transmission where hosted/tokenized provider flows can be used.
- SOC 2 readiness: evidence/control maturity target; no SOC 2 claim until the relevant independent report exists.
- ISO/IEC 27001:2022 alignment: ISMS target; no certification claim until certification is obtained.

## 4. Trust domains

Every execution packet must classify whether it affects any of these domains.

### TA-01 Governance and risk
Required outcomes:
- maintained security/privacy risk register;
- named control owner for material risks;
- explicit accept/mitigate/transfer/avoid decision;
- no unsupported compliance/certification claims.

### TA-02 Identity, tenant isolation and authority
Required outcomes:
- every tenant-scoped read/write/effect derives current tenant authority server-side;
- client-provided tenant identifiers select context but never confer access;
- wrong-tenant tests are mandatory for tenant-bearing paths;
- stale/revoked authority cannot survive final action admission;
- public/customer surfaces cannot become tenant-authority surfaces.

Primary owners: TENANT-001, AUTH-001, ACTION-001.

### TA-03 Secure SDLC and software supply chain
Required outcomes:
- dependency/vulnerability scanning;
- secret scanning with push protection where available;
- static analysis / CodeQL or equivalent;
- protected review/CI gates;
- reproducible dependency lockfiles;
- security-sensitive changes traced to tests/evidence;
- no security gate weakening merely to make CI green.

Primary owners: K12, repository execution controls.

### TA-04 Data inventory, classification and minimization
Required outcomes:
- data classes identified: public, internal, confidential, personal, sensitive, credential/secret, payment/financial, regulated-health where applicable;
- collection/persistence justified by a product purpose;
- least-data/default-minimization principle;
- location/derived-copy lineage known for deletion/correction;
- production customer data not exposed to coding agents without explicit authorization and controls.

### TA-05 Secrets, cryptography and credential lifecycle
Required outcomes:
- connector/provider tokens and application secrets are never ordinary plaintext business fields;
- secrets excluded from logs, traces, issue comments, test artifacts and model prompts;
- encryption/key management and rotation path defined;
- least-privilege service identities;
- credential revocation/generation fencing reconciles stale work.

Primary owners: CONNECTOR-001, INGRESS-001, OPS-001.

### TA-06 Audit, evidence and observability
Required outcomes:
- material security/business actions have durable actor/authority/effect evidence;
- logs are structured, correlated and redacted;
- audit evidence is distinct from active business truth;
- security events can be scoped to tenant, actor, action/effect and time;
- audit stores cannot silently become an alternate mutable source of truth.

Primary owners: K8/K11/K12, ACTION, RECOVERY, OPS.

### TA-07 Privacy rights, retention and deletion
Required outcomes:
- access/export/correction/deletion request paths are implementable and tenant-safe;
- deletion distinguishes active truth, derived state, retained evidence and backups;
- soft delete alone never satisfies an erasure claim;
- derived knowledge/vector/file/provider copies converge after eligible deletion/correction;
- retention controls are load-bearing where represented as enforceable product semantics;
- deletion/retention decisions are evidenced.

Primary owner: J19 / PRIVACY-001.

### TA-08 Third-party, subprocessor and connector risk
Required outcomes:
- provider/subprocessor inventory;
- data categories/purposes per provider;
- contractual/privacy/security requirements tracked;
- token scopes minimized;
- provider-side deletion/revocation/reconciliation supported where applicable;
- provider outage/unknown outcome does not fabricate local success.

Primary owners: EXTFX, INGRESS, CONNECTOR, RECOVERY.

### TA-09 Payments and financial cyber controls
Required outcomes:
- raw cardholder data kept out of KEYFLOWOS wherever possible;
- payment-provider hosted/tokenized flow preferred;
- webhook authenticity/replay controls;
- financial actions use current authority/control/clearance;
- immutable financial/effect evidence preserved;
- payment logs/analytics do not leak prohibited payment data.

Primary owners: FINANCE, COMMERCE, BOOKING, COMMERCIAL, ACTION, INGRESS.

### TA-10 AI governance
Required outcomes:
- AI proposal/inference is not automatically authoritative business truth;
- AI action capability is resolved through ACTION-001;
- action risk/control requirements are policy-bound and server-evaluated;
- higher-risk/destructive/financial/external actions can require explicit human control evidence;
- prompts/context obey tenant, privacy and minimization boundaries;
- model/provider data-use terms are classified;
- client-facing AI transparency is supported where legally/product-required;
- model/tool/action/audit lineage supports reconstruction.

Primary owners: ACTION, KNOWLEDGE, CONVO, VOICE, COMMAND, GROWTH.

### TA-11 Incident response, resilience and recovery
Required outcomes:
- incident severity/classification;
- contain/revoke/rotate/disable paths;
- tenant/data impact determination;
- evidence preservation;
- breach-notification decision workflow;
- tested backup restore and documented recovery objectives before GA;
- security incident exercises before production release.

Primary owners: RECOVERY, OPS, RELEASE plus organizational runbooks.

### TA-12 Assurance, contracts and cyber liability
Required outcomes:
- control/evidence register suitable for customer assurance;
- subprocessor list and DPA terms;
- privacy notice/terms accurately describe implemented behavior;
- external penetration test before GA unless formally risk-accepted;
- cyber liability and Technology E&O underwriting pack before material production exposure;
- SOC 2 / ISO roadmap begins from existing evidence rather than retrofitted screenshots.

Primary owners: OPS, RELEASE and company governance.

## 5. Execution-wave integration

The canonical 35-packet sequence remains unchanged.

### Wave A — Tenant -> Authority -> Action
Trust emphasis: TA-02, TA-06, TA-10.
Current ACTION-001 requirement: trust obligations are incorporated during characterization/proof without expanding beyond the bounded selected action family.

### Wave B — Occurrence / ingress / connector / recovery
Trust emphasis:
- webhook authenticity/replay;
- OAuth/token lifecycle and generation fencing;
- secret handling;
- subprocessor/provider inventory;
- recovery/incident evidence;
- no fabricated provider success.

### Wave C — Commercial / finance
Trust emphasis:
- PCI scope minimization;
- financial access/approval proof;
- financial audit/effect evidence;
- sensitive financial-data classification/retention;
- fraud/abuse and webhook boundaries.

### Wave D — Knowledge / public / AI / privacy / UX
Trust emphasis:
- privacy rights and derived-state deletion;
- retention policy enforcement;
- AI data governance/transparency;
- public/customer isolation;
- client-facing privacy/security controls;
- healthcare profile remains disabled unless separately qualified.

### Wave E — Integrated proof / ops / release
Trust emphasis:
- authenticated DAST or equivalent dynamic coverage;
- external penetration test;
- dependency/SAST/secret scan gates;
- backup/restore and incident exercise;
- subprocessor/DPA/privacy notice evidence;
- PCI scope evidence;
- AI governance evidence;
- cyber/Technology E&O readiness;
- SOC 2/ISO evidence map.

## 6. Milestone gates

### TRUST-G0 — Adopted baseline (now)
Required:
- this programme and machine-readable matrix are canonical;
- execution board/control standard/package standard reference the overlay;
- active packet does not bypass trust classification.

### TRUST-G1 — Before Wave B is released
Required:
- repository secret/dependency/static-analysis posture characterized;
- data inventory schema and security/privacy risk-register schema defined;
- privileged account/MFA expectation documented;
- incident-response owner and initial runbook defined;
- current DAST gap explicitly tracked rather than treated as coverage.

### TRUST-G2 — Before any real external provider or real customer-data pilot
Required:
- subprocessor/provider inventory;
- production-secret management/rotation;
- privacy data-flow map for pilot scope;
- logging/redaction proof;
- incident contact/escalation path;
- backup/restore proof for pilot data;
- customer contractual/privacy terms reviewed for actual behavior.

### TRUST-G3 — Before production payments
Required:
- PCI scope determination documented;
- no raw PAN/CVV persistence in KEYFLOWOS;
- payment-provider responsibility documented;
- webhook signature/replay/idempotency proof;
- financial authority/control proof;
- payment-log redaction proof.

### TRUST-G4 — Before general availability with personal data
Required:
- privacy notice and processor/DPA position;
- rights-request workflow;
- retention matrix;
- deletion/derived-state proof;
- subprocessor register;
- incident/breach workflow and exercise;
- secure SDLC gates active;
- external penetration test or explicit documented exception.

### TRUST-G5 — Before AI autopilot can execute material actions
Required:
- capability/risk/control classification;
- human-control thresholds;
- stale authority/policy invalidation proof;
- model/provider data handling assessment;
- prompt/tenant isolation proof;
- applicable AI disclosure support;
- action lineage/audit evidence.

### TRUST-G6 — Before production release authorization
Required:
- INTEGRATED, OPS and RELEASE packet evidence;
- no unresolved Critical security finding;
- High findings resolved or formally risk-accepted with owner/expiry;
- DAST coverage appropriate to reachable authenticated/public surfaces;
- restore test and incident tabletop completed;
- privacy/payment/AI applicability checklist signed off;
- cyber liability + Technology E&O placement decision recorded;
- no claim of SOC 2/ISO/HIPAA certification unless actually obtained.

### TRUST-G7 — Enterprise assurance stage
Target:
- SOC 2 readiness -> Type I/Type II as commercially justified;
- ISO/IEC 27001 ISMS/certification as commercially justified;
- recurring penetration tests and access reviews;
- continuous vendor/subprocessor and evidence monitoring.

## 7. Required programme artifacts

These are governance/evidence records, not new semantic runtimes:
1. `docs/intelligence/governance/TRUST-ASSURANCE-MATRIX.yaml`
2. security/privacy risk register;
3. data inventory + classification register;
4. retention/deletion matrix;
5. subprocessor/provider register;
6. incident-response and breach-decision runbook;
7. backup/restore evidence record;
8. AI capability/action risk register;
9. security test/evidence index;
10. customer-assurance evidence index;
11. cyber/Technology E&O underwriting evidence pack.

Exact storage location/format for items 2-11 may be finalized by the relevant packet or governance workstream. Do not create duplicate sources of truth where an existing artifact already owns the information.

## 8. Packet trust-impact contract

Every packet released after adoption must return:

```yaml
trust_impact:
  domains: []
  data_classes_touched: []
  personal_data: false
  sensitive_data: false
  secrets_or_credentials: false
  payment_or_financial_data: false
  external_processors_or_providers: []
  ai_action_or_inference: false
  privacy_retention_or_deletion: false
  security_controls_changed: []
  new_attack_surface: []
  required_negative_controls: []
  evidence_refs: []
  residual_risks: []
```

If not applicable, record the negative explicitly. Security/privacy impact may not disappear merely because functional tests pass.

## 9. Secure-development admission rules

For applicable packets, proof must consider:
- wrong tenant / IDOR;
- stale or revoked authority;
- replay/duplicate ingress;
- forged/invalid webhook;
- concurrent action claim;
- stale connector generation;
- secret/PII leakage to logs;
- over-broad data export;
- deletion leaving active derived state;
- retention bypass;
- unsafe file/content handling;
- dependency/security regression;
- AI bypass of current action clearance;
- provider timeout/unknown result;
- backup/recovery failure.

Unexpected passage of a negative control invalidates admission.

## 10. Agent and environment rules

ChatGPT owns trust-overlay interpretation, packet mapping, evidence admission and contradiction resolution.

Claude Code implements only bounded packet changes and must return trust-impact metadata plus applicable security/privacy proof.

Kimi Code adversarially reviews trust impact, especially cross-tenant access, bypass writers/readers, stale authority, secret leakage, replay, privacy lineage, migration ambiguity and proof vacuity.

All coding agents:
- use development/synthetic/sanitized data by default;
- do not request/expose production customer data without explicit authorization;
- never paste production secrets into chats/issues/prompts;
- do not weaken security gates or retention/privacy obligations to complete a packet.

## 11. Legal and assurance boundary

This programme is an engineering/evidence plan, not legal advice, PCI QSA advice, audit, insurer underwriting or certification.

Before market-specific launch, qualified counsel/assessors must confirm applicability and customer-facing claims.

## 12. Completion law

The 35-packet programme is not release-ready merely because functional convergence is complete.

```text
functional truth
+ tenant/authority proof
+ secure SDLC proof
+ privacy lifecycle proof
+ provider/payment proof
+ AI governance proof
+ incident/recovery proof
+ external assurance evidence
= TRUST-ELIGIBLE RELEASE CANDIDATE
```

Production release remains a separate explicit authorization.
