"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
  useMemo,
} from "react";
import { TtsEngine, TtsState } from "./tts-engine";

interface TtsContextValue {
  engine: TtsEngine;
  state: TtsState;
}

const TtsContext = createContext<TtsContextValue | null>(null);

export function TtsProvider({ children }: { children: ReactNode }) {
  const engine = useMemo(() => new TtsEngine(), []);
  const [state, setState] = useState<TtsState>(() => engine.getState());

  useEffect(() => {
    const unsubscribe = engine.subscribe(() => setState(engine.getState()));
    return () => {
      unsubscribe();
    };
  }, [engine]);

  return <TtsContext.Provider value={{ engine, state }}>{children}</TtsContext.Provider>;
}

export function useTts(): TtsContextValue {
  const ctx = useContext(TtsContext);
  if (!ctx) {
    throw new Error("useTts must be used within <TtsProvider>");
  }
  return ctx;
}

export function useTtsOptional(): TtsContextValue | null {
  return useContext(TtsContext);
}
