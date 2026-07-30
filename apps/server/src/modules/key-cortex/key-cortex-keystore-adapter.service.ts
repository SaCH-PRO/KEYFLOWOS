/**
 * KEY Cortex — Keystore Adapter Service
 * --------------------------------------
 * Bridges the Universal Connector to the Keystore Service Marketplace.
 * Provides typed action execution for all Keystore operations via the AI.
 */

import { Injectable } from '@nestjs/common';
import { KeystoreService } from '../keystore/keystore.service';
import type { ConnectorCommand } from './key-cortex-connector.types';

interface ConnectorCommandResult {
  success: boolean;
  data?: unknown;
  error?: string;
  executionTimeMs: number;
}

@Injectable()
export class KeyCortexKeystoreAdapterService {
  constructor(private readonly keystore: KeystoreService) {}

  async execute(
    command: ConnectorCommand,
    context: { businessId: string; userId: string },
  ): Promise<ConnectorCommandResult> {
    const start = Date.now();
    try {
      switch (command.action) {
        case 'create_service_order': {
          const order = await this.keystore.createOrder(
            context.businessId,
            context.userId,
            {
              listingId: command.parameters.listingId as string,
              pricingTier: command.parameters.pricingTier as string,
              briefAnswers: command.parameters.briefAnswers as any,
              selectedAddons: command.parameters.selectedAddons as any,
              notes: command.parameters.notes as string,
              contactId: command.parameters.contactId as string,
            },
          );
          return this.ok(start, order);
        }
        case 'cancel_service_order': {
          const cancelled = await this.keystore.cancelOrder(
            context.businessId,
            command.parameters.orderId as string,
            context.userId,
            command.parameters.reason as string,
          );
          return this.ok(start, cancelled);
        }
        case 'accept_service_quote': {
          const accepted = await this.keystore.acceptQuote(
            context.businessId,
            command.parameters.orderId as string,
            context.userId,
            { notes: command.parameters.notes as string },
          );
          return this.ok(start, accepted);
        }
        case 'rate_service_order': {
          const rated = await this.keystore.rateOrder(
            context.businessId,
            command.parameters.orderId as string,
            context.userId,
            {
              rating: command.parameters.rating as number,
              review: command.parameters.review as string,
            },
          );
          return this.ok(start, rated);
        }
        case 'send_order_message': {
          const message = await this.keystore.sendMessage(
            context.businessId,
            command.parameters.orderId as string,
            context.userId,
            {
              message: command.parameters.message as string,
              attachments: command.parameters.attachments as any,
            },
          );
          return this.ok(start, message);
        }
        case 'list_service_listings': {
          const listings = await this.keystore.getListings(
            context.businessId,
            command.parameters.categoryId as string,
          );
          return this.ok(start, listings);
        }
        case 'get_service_categories': {
          const categories = await this.keystore.getCategories(context.businessId);
          return this.ok(start, categories);
        }
        default:
          return this.fail(start, `Unknown keystore action: ${command.action}`);
      }
    } catch (error: any) {
      const msg = error instanceof Error ? error.message : String(error);
      return this.fail(start, msg);
    }
  }

  async query(
    command: ConnectorCommand,
    context: { businessId: string; userId: string },
  ): Promise<ConnectorCommandResult> {
    const start = Date.now();
    try {
      switch (command.action) {
        case 'get_user_orders': {
          const orders = await this.keystore.getUserOrders(
            context.businessId,
            context.userId,
          );
          return this.ok(start, orders);
        }
        case 'get_order_details': {
          const order = await this.keystore.getOrder(
            context.businessId,
            command.parameters.orderId as string,
            context.userId,
          );
          return this.ok(start, order);
        }
        case 'get_order_stats': {
          const stats = await this.keystore.getOrderStats(context.businessId);
          return this.ok(start, stats);
        }
        case 'get_service_categories': {
          const categories = await this.keystore.getCategories(context.businessId);
          return this.ok(start, categories);
        }
        case 'list_service_listings': {
          const listings = await this.keystore.getListings(
            context.businessId,
            command.parameters.categoryId as string,
          );
          return this.ok(start, listings);
        }
        default:
          return this.fail(start, `Unknown keystore query: ${command.action}`);
      }
    } catch (error: any) {
      const msg = error instanceof Error ? error.message : String(error);
      return this.fail(start, msg);
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
      const stats = await this.keystore.getOrderStats(businessId);
      const urgentItems: string[] = [];
      if (stats.pendingQuote > 0) {
        urgentItems.push(`${stats.pendingQuote} orders awaiting quote`);
      }
      if (stats.inProgress > 0) {
        urgentItems.push(`${stats.inProgress} orders in progress`);
      }
      return {
        summary: `${stats.totalOrders} total orders (${stats.delivered} delivered, ${stats.totalRevenue} revenue)`,
        recordCount: stats.totalOrders,
        urgentItems,
        data: stats as unknown as Record<string, unknown>,
      };
    } catch {
      return {
        summary: 'Keystore data unavailable',
        recordCount: 0,
        urgentItems: [],
        data: {},
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private ok(start: number, data: unknown): ConnectorCommandResult {
    return { success: true, data, executionTimeMs: Date.now() - start };
  }

  private fail(start: number, error: string): ConnectorCommandResult {
    return { success: false, error, executionTimeMs: Date.now() - start };
  }
}
