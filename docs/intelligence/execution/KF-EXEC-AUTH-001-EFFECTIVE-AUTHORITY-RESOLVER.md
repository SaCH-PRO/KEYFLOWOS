# KF-EXEC-AUTH-001 — Effective Authority Resolver Foundation

Status: DRAFT / NO IMPLEMENTATION AUTHORIZATION
Primary kernel: K2 Human Authority & Organization
Journeys: J25, J15, J2, J6, J1, J8, J11, J12, J23
Baseline: main@8f173bfe79f1418159cf4099ea18b0d60d203ec2

## Objective

Introduce one explainable decision-time authority result over existing Membership, JobRole/OrgAssignment, explicit grants/overrides/denials/delegation and approval-tier inputs, while preserving compatibility with current checks during migration.

Target question:

What may this principal legitimately do in this Business on this capability/resource right now, and why?

## Current evidence

Likely source families:
- apps/server/src/modules/structure/structure.service.ts and controller;
- Membership/JobRole/OrgAssignment schema;
- apps/server/src/modules/key-autonomy/authority-grant-rule.service.ts;
- apps/server/src/modules/ai/ai-settings.service.ts/controller.ts;
- BusinessGuard / ModuleScopeGuard;
- Approval routing and AI approval services;
- existing copied permissionScopes/maxApprovalTier projections.

Known semantic defects include stale copied role authority, inconsistent approval-tier checks, caller/grantor provenance pressure and broad control-plane mutation authority.

## Accepted target

EffectiveAuthorityResult includes at least:
- principal/business;
- relationship validity;
- base role/permissions;
- active organizational assignments;
- explicit grants/overrides;
- explicit denials;
- delegations;
- effective max approval tier;
- capability/resource/context constraints;
- validity/expiry/revocation;
- rule/provenance trace.

Core law:
granted authority <= grantor grantable authority.

## Precedence constraints

This packet must not invent precedence casually.

Implementation must encode the accepted shape:
- active Membership is required for ordinary authenticated-human authority;
- active position/JobRole contributes bounded current authority;
- explicit deny is represented explicitly, not only by absence;
- delegation/grant cannot exceed grantable authority;
- expired/revoked sources contribute nothing;
- approval tier is distinct from execution permission;
- source provenance remains explainable.

Any contradiction discovered in real current fields must be returned to architecture before coding around it.

## Existing seams to strengthen

Use current Membership, Structure, AuthorityGrant and policy services.
Do not add a second role system.

## Prohibited shortcuts

- no flattened union of all scopes if it can escalate;
- no copying new role state into Membership as sole truth;
- no client-supplied grantor identity;
- no route-local bespoke resolver for each controller;
- no silent admin/owner superuser exception without explicit policy trace;
- no denial implementation as ad-hoc string subtraction.

## Migration

1. characterize current authority sources and copied projections;
2. define resolver input adapter over current rows;
3. run resolver in shadow/compare on selected guarded operations;
4. surface decision traces in tests/log-only non-sensitive diagnostics;
5. reconcile disagreements and legacy data;
6. move selected gates to resolver;
7. stop stale copied fields from independently expanding authority;
8. withdraw legacy checks by capability family.

## Acceptance proof

- role assignment/revocation affects next decision;
- expired delegation is rejected;
- grant cannot exceed grantor;
- explicit deny narrows otherwise granted capability;
- multiple positions compose without accidental escalation;
- approval tier and execution permission remain distinct;
- wrong Business relationship rejects;
- authority result explains all contributing sources;
- concurrent revoke vs action admission cannot consume stale authority after the chosen commit boundary;
- legacy/shadow compare records mismatches before cutover.

## Non-goals

KEY autonomy, exact action Clearance and universal route cutover are later packets.
