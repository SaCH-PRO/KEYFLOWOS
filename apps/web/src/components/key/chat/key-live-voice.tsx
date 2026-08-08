"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, PhoneOff, Loader2 } from "lucide-react";
import {
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteTrack,
} from "livekit-client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { getStoredBusinessId } from "@/lib/workspace";
import { createVoiceSession, endVoiceSession } from "@/lib/api/livekit";

type AgentState = "initializing" | "listening" | "thinking" | "speaking" | "unknown";
type SessionPhase = "idle" | "connecting" | "live" | "ending";

const AGENT_STATE_ATTRIBUTE = "lk.agent.state";

const STATE_LABEL: Record<AgentState, string> = {
  initializing: "KEY is joining…",
  listening: "Listening — talk to KEY",
  thinking: "KEY is thinking…",
  speaking: "KEY is speaking…",
  unknown: "Live with KEY",
};

const STATE_DOT: Record<AgentState, string> = {
  initializing: "bg-amber-400",
  listening: "bg-emerald-400",
  thinking: "bg-violet animate-pulse",
  speaking: "bg-sky-400 animate-pulse",
  unknown: "bg-muted-foreground",
};

function readAgentState(participants: Participant[]): AgentState {
  const agent = participants.find((p) => p.identity.startsWith("agent-"));
  if (!agent) return "initializing";
  const raw = agent.attributes?.[AGENT_STATE_ATTRIBUTE];
  if (raw === "listening" || raw === "thinking" || raw === "speaking" || raw === "initializing") return raw;
  return agent ? "unknown" : "initializing";
}

/**
 * Live full-duplex voice with KEY (LiveKit). One click starts a room with the
 * KEY voice agent; the orb mirrors the agent's real state
 * (listening/thinking/speaking) via the lk.agent.state participant attribute.
 */
export function KeyLiveVoice() {
  const businessId = getStoredBusinessId();
  const [phase, setPhase] = useState<SessionPhase>("idle");
  const [agentState, setAgentState] = useState<AgentState>("initializing");
  const roomRef = useRef<Room | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const audioElsRef = useRef<HTMLAudioElement[]>([]);

  const teardown = useCallback(() => {
    for (const el of audioElsRef.current) el.remove();
    audioElsRef.current = [];
    roomRef.current?.disconnect();
    roomRef.current = null;
    setAgentState("initializing");
  }, []);

  // Safety: hang up if the page unmounts mid-call.
  useEffect(() => teardown, [teardown]);

  const stop = useCallback(async () => {
    setPhase("ending");
    const biz = businessId;
    const sid = sessionIdRef.current;
    teardown();
    sessionIdRef.current = null;
    setPhase("idle");
    if (biz && sid) await endVoiceSession(biz, sid);
  }, [businessId, teardown]);

  const start = useCallback(async () => {
    if (!businessId) {
      toast.error("No business selected");
      return;
    }
    setPhase("connecting");
    const { data, error } = await createVoiceSession(businessId);
    if (error || !data) {
      toast.error(error ?? "Could not start voice session");
      setPhase("idle");
      return;
    }

    const room = new Room();
    roomRef.current = room;
    sessionIdRef.current = data.sessionId;

    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach();
        audioElsRef.current.push(el);
        document.body.appendChild(el);
      }
    });
    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) {
        for (const el of track.detach()) {
          audioElsRef.current = audioElsRef.current.filter((e) => e !== el);
          el.remove();
        }
      }
    });
    room.on(RoomEvent.ParticipantAttributesChanged, () => {
      setAgentState(readAgentState([...room.remoteParticipants.values()]));
    });
    room.on(RoomEvent.ParticipantConnected, () => {
      setAgentState(readAgentState([...room.remoteParticipants.values()]));
    });
    room.on(RoomEvent.Disconnected, () => {
      // Server-side room close or network drop — reset UI.
      teardown();
      sessionIdRef.current = null;
      setPhase("idle");
    });

    try {
      await room.connect(data.wsUrl, data.token);
      await room.localParticipant.setMicrophoneEnabled(true);
      setAgentState(readAgentState([...room.remoteParticipants.values()]));
      setPhase("live");
    } catch (err) {
      toast.error(`Voice connection failed: ${(err as Error).message}`);
      teardown();
      sessionIdRef.current = null;
      setPhase("idle");
    }
  }, [businessId, teardown]);

  if (phase === "idle") {
    return (
      <Button
        type="button"
        variant="icon"
        onClick={() => void start()}
        aria-label="Talk to KEY live"
        title="Talk to KEY live (full-duplex voice)"
        className="h-8 w-8 text-emerald-500 hover:bg-emerald-500/10"
      >
        <Mic className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 rounded-full border border-border/60 bg-surface-muted px-2 py-1">
      {phase === "connecting" || phase === "ending" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      ) : (
        <span className={cn("h-2.5 w-2.5 rounded-full", STATE_DOT[agentState])} />
      )}
      <span className="max-w-[140px] truncate text-[10px] text-muted-foreground">
        {phase === "connecting" ? "Connecting…" : phase === "ending" ? "Ending…" : STATE_LABEL[agentState]}
      </span>
      <Button
        type="button"
        variant="icon"
        onClick={() => void stop()}
        aria-label="End voice session"
        title="End voice session"
        className="h-6 w-6 text-rose-500 hover:bg-rose-500/10"
      >
        <PhoneOff className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
