/**
 * KEY Universal Connector Service — Keystore Integration Edition
 * ----------------------------------------------------------------
 * The single integration backbone that routes AI-generated commands to every
 * KeyFlowOS module. Now 19 modules with 145+ actions and 85+ queries.
 * 
 * Keystore (v19) — Service marketplace for human-powered deliverables.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  ModuleName,
  ModuleCapability,
  ConnectorCommand,
  ConnectorResult,
  FullBusinessContext,
  ModuleContextSlice,
} from './key-cortex-connector.types';

// ── KeyFlowOS module services (13 injected adapters) ──────────────────────────
import { CrmService } from '../crm/crm.service';
import { CommerceService } from '../commerce/commerce.service';
import { BookingsService } from '../bookings/bookings.service';
import { ContentService } from '../content/content.service';
import { CommunicationsService } from '../communications/communications.service';
import { FlowService } from '../flow/flow.service';
import { AutopilotService } from '../autopilot/autopilot.service';
import { TemporalFlowMemoryService } from '../temporal-flow/temporal-flow-memory.service';
import { KeyInboxService } from '../key-inbox/key-inbox.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProjectsService } from '../projects/projects.service';
import { ActivityService } from '../activity/activity.service';
import { KeystoreService } from '../keystore/keystore.service';

@Injectable()
export class KeyCortexConnectorService {
  private readonly logger = new Logger(KeyCortexConnectorService.name);

  // ═══════════════════════════════════════════════════════════════════════════
  //  CONSTRUCTOR — Inject all 13 KeyFlowOS module services
  // ═══════════════════════════════════════════════════════════════════════════

  constructor(
    private readonly crm: CrmService,
    private readonly commerce: CommerceService,
    private readonly bookings: BookingsService,
    private readonly content: ContentService,
    private readonly communications: CommunicationsService,
    private readonly flow: FlowService,
    private readonly autopilot: AutopilotService,
    private readonly temporal: TemporalFlowMemoryService,
    private readonly inbox: KeyInboxService,
    private readonly notifications: NotificationsService,
    private readonly projects: ProjectsService,
    private readonly activity: ActivityService,
    private readonly keystore: KeystoreService,
  ) {}
