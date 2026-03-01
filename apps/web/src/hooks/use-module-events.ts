"use client";

import { useEffect, useRef, useCallback } from "react";
import { moduleEvents, type ModuleEventType, type ModuleEvent } from "@/lib/module-events";

export function useModuleEvent<T = unknown>(
  eventType: ModuleEventType | "*",
  handler: (event: ModuleEvent<T>) => void,
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return moduleEvents.on(eventType, (e) => handlerRef.current(e as ModuleEvent<T>));
  }, [eventType]);
}

export function useModuleEmit() {
  return useCallback(
    <T = unknown>(type: ModuleEventType, moduleId: string, data: T) => {
      moduleEvents.emit(type, moduleId, data);
    },
    [],
  );
}

export { moduleEvents };
