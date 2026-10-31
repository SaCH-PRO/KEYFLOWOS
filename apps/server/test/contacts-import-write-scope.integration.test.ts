/**
 * HANDED OFF from R0-13-CT-PERSISTENCE-PROOF (review findings ST-1, ST-2,
 * CR-1). Placeholders only: nothing here runs yet.
 *
 * R0-13 refuses contact creation for a STAFF member whose crm_edit is 'none',
 * and bounds the holder a duplicate-identity 409 may name to the actor's
 * visibility. Both checks live in CrmService.createContact and run only when
 * the caller passes actorUserId. POST /crm/businesses/:businessId/contacts
 * passes it (proven in test/contacts-persistence.integration.test.ts). The
 * import routes do not:
 *   POST import/image/ocr -> CrmImportService.createContactFromOcr
 *   POST import/file      -> CrmImportService.createFileImport
 *   POST import/link      -> CrmImportService.createLinkImport
 * Each reaches CrmService.findOrCreateContact(businessId, input), which calls
 * createContact with no actor. The routes are guarded only by
 * ModuleScopeGuard('crm', 'write'), which a crm_edit 'none' member passes.
 *
 * Reviewer repro (review of R0-13, real database, real CrmImportService):
 *   - staffNoEdit POST import/image/ocr -> 201, one live contact, 2
 *     contact_events and 1 audit entry written; POST /contacts by the same
 *     member -> 403.
 *   - staffNoEdit POST import/file?type=csv with 2 rows -> 201 COMPLETED, 2
 *     contacts created.
 *   - A PRIVATE holder the member cannot open: POST /contacts -> 409
 *     {existingContactId: null}; POST import/image/ocr -> 409
 *     {existingContactId: '<the holder id>'}; GET detail of that id -> 404.
 *
 * The fix plumbs the request's actor from crm.controller.ts through
 * crm-import.service.ts into findOrCreateContact and createContact. Both files
 * are outside R0-13's write set (crm.service.ts, this packet's two proof
 * files), so the cases stay it.todo for a follow-up packet. That packet should
 * replace each todo with a real-database case built on the
 * contacts-persistence harness, with a real CrmImportService.
 */
import { describe, it } from 'vitest';

describe('HANDED OFF (R0-13 review ST-1/ST-2/CR-1): contact import routes obey the importing member\'s CRM permissions', () => {
  it.todo(
    'POST import/image/ocr by STAFF with crm write but crm_edit none answers 403 and writes no contact, event or audit entry '
    + '(today 201: the route passes no actor, so createContact skips the edit-scope check; needs crm.controller.ts and crm-import.service.ts, outside R0-13)',
  );

  it.todo(
    'POST import/file (csv) by STAFF with crm write but crm_edit none is refused and creates no contact '
    + '(today 201 COMPLETED with every row created; same cause, same files)',
  );

  it.todo(
    'POST import/link by STAFF with crm write but crm_edit none is refused and creates no contact '
    + '(same findOrCreateContact path with no actor; read in review, not run)',
  );

  it.todo(
    'a 409 from an import route names the existing holder only when the importing member can open it '
    + '(today it names a PRIVATE holder the member gets 404 on; needs the same actor plumbing)',
  );

  it.todo(
    'an import whose row matches an existing contact merges fields into it only when the importing member may edit that contact '
    + '(read while repairing R0-13, not run: findOrCreateContact -> mergeContactDetails applies no edit scope or visibility)',
  );
});
