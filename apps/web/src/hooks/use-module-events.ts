"use client";

import { useEffect, useCallback } from "react";
import { moduleEvents, type ModuleEventType, type ModuleEvent } from "@/lib/module-events";
import { useLatestRef } from "@/hooks/use-latest-ref";

export function useModuleEvent<T = unknown>(
  eventType: ModuleEventType | "*",
  handler: (event: ModuleEvent<T>) => void,
) {
  const handlerRef = useLatestRef(handler);

  useEffect(() => {
    return moduleEvents.on(eventType, (e) => handlerRef.current(e as ModuleEvent<T>));
  }, [eventType, handlerRef]);
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
