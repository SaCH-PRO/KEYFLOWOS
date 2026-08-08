import { apiGet as apiGetSimple, apiPostSimple, apiPatch, apiDelete } from "../api";

export interface OrgUnit {
  id: string;
  businessId: string;
  name: string;
  type: string;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  managerId?: string | null;
  parentId?: string | null;
  children?: OrgUnit[];
  createdAt: string;
  updatedAt: string;
}

export interface JobRole {
  id: string;
  businessId: string;
  name: string;
  description?: string | null;
  level: number;
  permissions?: Record<string, string> | null;
  defaultApprovalTier: number;
  color?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrgAssignment {
  id: string;
  businessId: string;
  // Membership path (full logged-in team member) — one of these two paths
  // is populated, never both. See isContactOnly.
  membershipId?: string | null;
  userId?: string | null;
  // Contact-only path — a staff position filled by someone who won't log
  // into the app but still needs to receive delegated work/approvals over
  // WhatsApp/SMS/email (e.g. front-desk, floor staff).
  isContactOnly?: boolean;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  preferredChannel?: string;
  autoApprovalViaReply?: boolean;
  orgUnitId: string;
  orgUnit?: OrgUnit;
  jobRoleId?: string | null;
  jobRole?: JobRole | null;
  reportsToId?: string | null;
  reportsTo?: OrgAssignment | null;
  membership?: {
    user: {
      id: string;
      email: string;
      name?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      avatarUrl?: string | null;
    };
  };
  isPrimary: boolean;
  startedAt: string;
  endedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DelegationRule {
  id: string;
  businessId: string;
  delegatorId: string;
  delegateId: string;
  scope: string;
  maxTier: number;
  activeFrom: string;
  activeUntil?: string | null;
  reason?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StructureStats {
  unitCount: number;
  roleCount: number;
  assignmentCount: number;
  delegationCount: number;
}

export async function fetchOrgUnits(businessId: string) {
  return apiGetSimple<OrgUnit[]>(`/structure/businesses/${encodeURIComponent(businessId)}/org-units`);
}

export async function createOrgUnit(businessId: string, data: Omit<OrgUnit, "id" | "businessId" | "createdAt" | "updatedAt" | "children">) {
  return apiPostSimple<OrgUnit>(`/structure/businesses/${encodeURIComponent(businessId)}/org-units`, data);
}

export async function updateOrgUnit(businessId: string, id: string, data: Partial<Omit<OrgUnit, "id" | "businessId" | "createdAt" | "updatedAt" | "children">>) {
  return apiPatch<OrgUnit>(`/structure/businesses/${encodeURIComponent(businessId)}/org-units/${encodeURIComponent(id)}`, data);
}

export async function deleteOrgUnit(businessId: string, id: string) {
  return apiDelete<OrgUnit>(`/structure/businesses/${encodeURIComponent(businessId)}/org-units/${encodeURIComponent(id)}`);
}

export async function fetchJobRoles(businessId: string) {
  return apiGetSimple<JobRole[]>(`/structure/businesses/${encodeURIComponent(businessId)}/job-roles`);
}

export async function createJobRole(businessId: string, data: Omit<JobRole, "id" | "businessId" | "createdAt" | "updatedAt">) {
  return apiPostSimple<JobRole>(`/structure/businesses/${encodeURIComponent(businessId)}/job-roles`, data);
}

export async function updateJobRole(businessId: string, id: string, data: Partial<Omit<JobRole, "id" | "businessId" | "createdAt" | "updatedAt">>) {
  return apiPatch<JobRole>(`/structure/businesses/${encodeURIComponent(businessId)}/job-roles/${encodeURIComponent(id)}`, data);
}

export async function deleteJobRole(businessId: string, id: string) {
  return apiDelete<JobRole>(`/structure/businesses/${encodeURIComponent(businessId)}/job-roles/${encodeURIComponent(id)}`);
}

export async function fetchAssignments(businessId: string) {
  return apiGetSimple<OrgAssignment[]>(`/structure/businesses/${encodeURIComponent(businessId)}/assignments`);
}

export async function createAssignment(businessId: string, data: Omit<OrgAssignment, "id" | "businessId" | "createdAt" | "updatedAt" | "startedAt" | "orgUnit" | "jobRole" | "reportsTo">) {
  return apiPostSimple<OrgAssignment>(`/structure/businesses/${encodeURIComponent(businessId)}/assignments`, data);
}

export async function updateAssignment(businessId: string, id: string, data: Partial<Omit<OrgAssignment, "id" | "businessId" | "createdAt" | "updatedAt" | "orgUnit" | "jobRole" | "reportsTo">>) {
  return apiPatch<OrgAssignment>(`/structure/businesses/${encodeURIComponent(businessId)}/assignments/${encodeURIComponent(id)}`, data);
}

export async function deleteAssignment(businessId: string, id: string) {
  return apiDelete<OrgAssignment>(`/structure/businesses/${encodeURIComponent(businessId)}/assignments/${encodeURIComponent(id)}`);
}

export async function fetchDelegationRules(businessId: string) {
  return apiGetSimple<DelegationRule[]>(`/structure/businesses/${encodeURIComponent(businessId)}/delegation-rules`);
}

export async function createDelegationRule(businessId: string, data: Omit<DelegationRule, "id" | "businessId" | "createdAt" | "updatedAt">) {
  return apiPostSimple<DelegationRule>(`/structure/businesses/${encodeURIComponent(businessId)}/delegation-rules`, data);
}

export async function updateDelegationRule(businessId: string, id: string, data: Partial<Omit<DelegationRule, "id" | "businessId" | "createdAt" | "updatedAt">>) {
  return apiPatch<DelegationRule>(`/structure/businesses/${encodeURIComponent(businessId)}/delegation-rules/${encodeURIComponent(id)}`, data);
}

export async function deleteDelegationRule(businessId: string, id: string) {
  return apiDelete<DelegationRule>(`/structure/businesses/${encodeURIComponent(businessId)}/delegation-rules/${encodeURIComponent(id)}`);
}

export async function fetchOrgTree(businessId: string) {
  return apiGetSimple<{ units: OrgUnit[]; rootUnits: OrgUnit[] }>(`/structure/businesses/${encodeURIComponent(businessId)}/tree`);
}

export async function fetchStructureStats(businessId: string) {
  return apiGetSimple<StructureStats>(`/structure/businesses/${encodeURIComponent(businessId)}/stats`);
}

// ─── Content Operations ──────────────────────────────────────────────────────

