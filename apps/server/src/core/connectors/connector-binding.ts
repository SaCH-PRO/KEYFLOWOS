/**
 * SWEEP-P0-SCOPES round 2 class repair (CLASS B; finding CW-4): the connectors whose provider check
 * records a binding. For these a passed smoke test is Connect: WhatsApp's check writes the connected
 * verification record (WhatsAppConnector.recordConnected), which lifts the explicit disconnect only
 * settings admin may write (POST disconnect/whatsapp). So POST smoke/:type needs what Connect needs
 * (ConnectorController.assertConnectorBindingAuthority) for them; every other connector's smoke test
 * writes a status after a check and binds nothing, and stays open to members (R0-CMF6-K05).
 *
 * The census spec pins it (CEN-10f): every connector class whose smokeTest reaches a credential or
 * binding write on the call graph must be named here.
 *
 * SWEEP-P0-FOLLOWUP, whatsappsmoke ruling (recommended option): the WhatsApp test only reports its result and never
 * switches WhatsApp back on (WhatsAppConnector.smokeTest records nothing; smokeReportsOnly), so it binds nothing
 * and is open to members again. No connector binds on its check today; the set stays for the next one.
 */
export const CONNECTORS_BINDING_ON_CHECK: ReadonlySet<string> = new Set([]);
