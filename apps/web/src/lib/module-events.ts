"use client";

export type ModuleEventType =
  | "contact:created"
  | "contact:updated"
  | "contact:deleted"
  | "contact:selected"
  | "contact:favorited"
  | "contact:merged"
  | "contact:status_changed"
  | "contact:note_added"
  | "contact:task_added"
  | "contact:imported"
  | "contact:quick_created"
  | "commerce:invoice_created"
  | "commerce:invoice_paid"
  | "commerce:product_created"
  | "commerce:product_updated"
  | "commerce:product_deleted"
  | "commerce:quote_created"
  | "commerce:quote_converted"
  | "commerce:product_selected"
  | "commerce:view_client_intel"
  | "commerce:create_quote_for_contact"
  | "commerce:create_invoice_for_contact"
  | "booking:created"
  | "booking:confirmed"
  | "booking:cancelled"
  | "booking:view_contact"
  | "booking:create_invoice"
  | "marketing:campaign_created"
  | "marketing:campaign_sent"
  | "marketing:campaign_scheduled"
  | "marketing:campaign_deleted"
  | "marketing:lead_captured"
  | "marketing:view_contact"
  | "marketing:create_campaign_for_segment"
  | "marketing:form_created"
  | "marketing:form_submitted"
  | "marketing:form_deleted"
  | "marketing:social_post_created"
  | "marketing:social_post_published"
  | "marketing:strategy_generated"
  | "marketing:brief_submitted"
  | "billing:schedule_created"
  | "billing:schedule_toggled"
  | "store:status_changed"
  | "store:hours_updated"
  | "store:item_added"
  | "store:config_updated"
  | "module:tab_changed"
  | "module:view_changed";

export type ModuleEvent<T = unknown> = {
  type: ModuleEventType;
  moduleId: string;
  data: T;
  timestamp: number;
};

type Listener<T = unknown> = (event: ModuleEvent<T>) => void;

class ModuleEventBus {
  private listeners = new Map<string, Set<Listener>>();

  emit<T = unknown>(type: ModuleEventType, moduleId: string, data: T) {
    const event: ModuleEvent<T> = {
      type,
      moduleId,
      data,
      timestamp: Date.now(),
    };

    const typeListeners = this.listeners.get(type);
    if (typeListeners) {
      typeListeners.forEach(fn => {
        try { fn(event as ModuleEvent); } catch {}
      });
    }

    const wildcardListeners = this.listeners.get("*");
    if (wildcardListeners) {
      wildcardListeners.forEach(fn => {
        try { fn(event as ModuleEvent); } catch {}
      });
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(`kf:${type}`, { detail: event }),
      );
    }
  }

  on<T = unknown>(type: ModuleEventType | "*", listener: Listener<T>): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener as Listener);
    return () => this.off(type, listener as Listener);
  }

  off(type: ModuleEventType | "*", listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  once<T = unknown>(type: ModuleEventType, listener: Listener<T>) {
    const wrapper: Listener = (event) => {
      this.off(type, wrapper);
      listener(event as ModuleEvent<T>);
    };
    return this.on(type, wrapper);
  }
}

export const moduleEvents = new ModuleEventBus();
