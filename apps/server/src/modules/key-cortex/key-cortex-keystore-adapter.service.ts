/**
 * KEY Cortex — Keystore Adapter Service
 * --------------------------------------
 * Bridges the Universal Connector to the Keystore Service Marketplace.
 * Provides typed action execution for all Keystore operations via the AI.
 * 
 * This adapter is called by the Universal Connector's execute() switch
 * when routing 'keystore' module commands.
 */

import { Injectable } from '@nestjs/common';
import { KeystoreService } from '../keystore/keystore.service';
import type { ConnectorCommand, ConnectorResult } from './key-cortex-connector.types';

@Injectable()
export class KeyCortexKeystoreAdapterService {
  constructor(private readonly keystore: KeystoreService) {}

  async execute(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    try {
      switch (command.action) {
        case 'create_service_order': {
          const order = await this.keystore.createOrder(
            command.businessId,
            command.userId,
            {
              listingId: command.parameters.listingId as string,
              pricingTier: command.parameters.pricingTier as string,
              briefAnswers: command.parameters.briefAnswers as any,
              selectedAddons: command.parameters.selectedAddons as any,
              notes: command.parameters.notes as string,
              contactId: command.parameters.contactId as string,
            },
          );
          return this.ok(command, start, order);
        }
        case 'cancel_service_order': {
          const cancelled = await this.keystore.cancelOrder(
            command.businessId,
            command.parameters.orderId as string,
            command.userId,
            command.parameters.reason as string,
          );
          return this.ok(command, start, cancelled);
        }
        case 'accept_service_quote': {
          const accepted = await this.keystore.acceptQuote(
            command.businessId,
            command.parameters.orderId as string,
            command.userId,
            { notes: command.parameters.notes as string },
          );
          return this.ok(command, start, accepted);
        }
        case 'rate_service_order': {
          const rated = await this.keystore.rateOrder(
            command.businessId,
            command.parameters.orderId as string,
            command.userId,
            {
              rating: command.parameters.rating as number,
              review: command.parameters.review as string,
            },
          );
          return this.ok(command, start, rated);
        }
        case 'send_order_message': {
          const message = await this.keystore.sendMessage(
            command.businessId,
            command.parameters.orderId as string,
            command.userId,
            {
              message: command.parameters.message as string,
              attachments: command.parameters.attachments as any,
            },
          );
          return this.ok(command, start, message);
        }
        case 'list_service_listings': {
          const listings = await this.keystore.getListings(
            command.businessId,
            command.parameters.categoryId as string,
          );
          return this.ok(command, start, listings);
        }
        case 'get_service_categories': {
          const categories = await this.keystore.getCategories(command.businessId);
          return this.ok(command, start, categories);
        }
        case 'get_user_orders': {
          const orders = await this.keystore.getUserOrders(
            command.businessId,
            command.userId,
          );
          return this.ok(command, start, orders);
        }
        case 'get_order_details': {
          const order = await this.keystore.getOrder(
            command.businessId,
            command.parameters.orderId as string,
            command.userId,
          );
          return this.ok(command, start, order);
        }
        case 'get_order_stats': {
          const stats = await this.keystore.getOrderStats(command.businessId);
          return this.ok(command, start, stats);
        }
        case 'update_order_status': {
          const updated = await this.keystore.adminUpdateOrderStatus(
            command.businessId,
            command.parameters.orderId as string,
            {
              status: command.parameters.status as string,
              note: command.parameters.note as string,
              metadata: command.parameters.metadata as Record<string, unknown>,
            },
            command.userId,
          );
          return this.ok(command, start, updated);
        }
        case 'deliver_files': {
          const delivered = await this.keystore.deliverFiles(
            command.businessId,
            command.parameters.orderId as string,
            command.userId,
            {
              files: command.parameters.files as any,
              note: command.parameters.note as string,
            },
          );
          return this.ok(command, start, delivered);
        }
        default:
          return this.fail(command, start, `Unknown keystore action: ${command.action}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return this.fail(command, start, msg);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  CONTEXT BUILDER — Keystore slice for AI context window
  // ═══════════════════════════════════════════════════════════════════════════

  async buildContext(businessId: string): Promise<{
    summary: string;
    recordCount: number;
    urgentItems: string[];
    data: Record<string, unknown>;
  }> {
    try {
      const [stats, categories, recentOrders] = await Promise.all([
        this.keystore.getOrderStats(businessId),
        this.keystore.getCategories(businessId),
        this.keystore.getAllOrders(businessId, { status: 'REQUESTED' }),
      ]);

      const urgentItems: string[] = [];
      if (stats.pendingQuote > 0) urgentItems.push(`${stats.pendingQuote} orders awaiting quote`);
      if (stats.inProgress > 0) urgentItems.push(`${stats.inProgress} orders in progress`);

      return {
        summary: `${stats.totalOrders} total orders (${stats.delivered} delivered), ${categories.length} service categories`,
        recordCount: stats.totalOrders + categories.length,
        urgentItems,
        data: { stats, categories: categories.map((c: any) => c.name), pendingOrders: recentOrders.slice(0, 5) },
      };
    } catch {
      return { summary: 'Keystore data unavailable', recordCount: 0, urgentItems: [], data: {} };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private ok(command: ConnectorCommand, start: number, data: unknown): ConnectorResult {
    return { success: true, data, executionTimeMs: Date.now() - start, command };
  }

  private fail(command: ConnectorCommand, start: number, error: string): ConnectorResult {
    return { success: false, error, executionTimeMs: Date.now() - start, command };
  }
}
