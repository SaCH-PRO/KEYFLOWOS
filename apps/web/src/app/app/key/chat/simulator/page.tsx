"use client";

import { useState, useCallback, useRef } from "react";
import { KeyChatProvider, useKeyChat } from "@/components/key/chat";
import type { OnboardingCardData } from "@/components/key/chat/types";
import type { FlowPendingConfirmation } from "@/lib/client";
import { KeyFullChatShell } from "@/components/key/chat/key-full-chat-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Play, Pause, FastForward, RotateCcw, Bug, 
  Terminal, Activity, MessageSquare, Dna, Zap, XCircle, AlertTriangle, Radio
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Virtual Simulator Engine ───────────────────────────────────────────────

interface SimulatedChunk {
  type: string;
  delay: number;
  content?: string;
  pendingConfirmations?: Array<{
    toolCallId: string;
    name: string;
    description: string;
    arguments: Record<string, unknown>;
    riskLevel: string;
  }>;
  sessionId?: string;
  card?: {
    type: string;
    title?: string;
    step?: string;
    data?: Record<string, unknown>;
  };
  error?: string;
}

const SIMULATION_SCENARIOS: Record<string, SimulatedChunk[]> = {
  "simple-greeting": [
    { type: "content_delta", delay: 200, content: "Hello" },
    { type: "content_delta", delay: 100, content: "!" },
    { type: "content_delta", delay: 150, content: " How" },
    { type: "content_delta", delay: 100, content: " can" },
    { type: "content_delta", delay: 150, content: " I" },
    { type: "content_delta", delay: 100, content: " help" },
    { type: "content_delta", delay: 100, content: " you" },
    { type: "content_delta", delay: 100, content: " today" },
    { type: "content_delta", delay: 100, content: "?" },
    { type: "done", delay: 100, sessionId: "sim_sess_1" },
  ],
  "with-confirmation": [
    { type: "content_delta", delay: 300, content: "I" },
    { type: "content_delta", delay: 150, content: " can" },
    { type: "content_delta", delay: 150, content: " create" },
    { type: "content_delta", delay: 150, content: " an" },
    { type: "content_delta", delay: 150, content: " invoice" },
    { type: "content_delta", delay: 200, content: " for" },
    { type: "content_delta", delay: 150, content: " $500" },
    { type: "content_delta", delay: 200, content: " to" },
    { type: "content_delta", delay: 150, content: " ABC" },
    { type: "content_delta", delay: 150, content: " Corp." },
    { type: "content_delta", delay: 300, content: "\n\nPlease" },
    { type: "content_delta", delay: 150, content: " confirm" },
    { type: "content_delta", delay: 200, content: " to" },
    { type: "content_delta", delay: 150, content: " proceed." },
    {
      type: "confirmation_required",
      delay: 500,
      pendingConfirmations: [
        {
          toolCallId: "sim_tc_1",
          name: "commerce_create_invoice",
          description: "Create invoice for $500 to ABC Corp",
          arguments: { amount: 500, client: "ABC Corp", items: [{ description: "Consulting", quantity: 1, price: 500 }] },
          riskLevel: "medium",
        },
      ],
    },
    { type: "done", delay: 100, sessionId: "sim_sess_2" },
  ],
  "with-tool-results": [
    { type: "content_delta", delay: 300, content: "Creating" },
    { type: "content_delta", delay: 150, content: " the" },
    { type: "content_delta", delay: 150, content: " invoice" },
    { type: "content_delta", delay: 200, content: "..." },
    { type: "tool_calls", delay: 500 },
    { type: "tool_results", delay: 800 },
    { type: "content_delta", delay: 300, content: "\n\nDone!" },
    { type: "content_delta", delay: 200, content: " Invoice" },
    { type: "content_delta", delay: 150, content: " INV-2024-001" },
    { type: "content_delta", delay: 150, content: " has" },
    { type: "content_delta", delay: 150, content: " been" },
    { type: "content_delta", delay: 150, content: " created" },
    { type: "content_delta", delay: 100, content: " for" },
    { type: "content_delta", delay: 150, content: " $500." },
    { type: "done", delay: 100, sessionId: "sim_sess_3" },
  ],
  "with-error": [
    { type: "content_delta", delay: 300, content: "Let" },
    { type: "content_delta", delay: 150, content: " me" },
    { type: "content_delta", delay: 150, content: " check" },
    { type: "content_delta", delay: 200, content: "..." },
    { type: "error", delay: 1000, error: "Rate limit exceeded. Please try again in 30 seconds." },
  ],
  "genome-proposal": [
    { type: "content_delta", delay: 300, content: "Based" },
    { type: "content_delta", delay: 150, content: " on" },
    { type: "content_delta", delay: 150, content: " your" },
    { type: "content_delta", delay: 150, content: " input," },
    { type: "content_delta", delay: 200, content: " I" },
    { type: "content_delta", delay: 150, content: " propose" },
    { type: "content_delta", delay: 150, content: " updating" },
    { type: "content_delta", delay: 150, content: " your" },
    { type: "content_delta", delay: 150, content: " financial" },
    { type: "content_delta", delay: 150, content: " DNA." },
    {
      type: "card",
      delay: 500,
      card: {
        type: "ownership-legal",
        title: "Proposed: financial",
        step: "financial",
        data: { monthlyRevenue: 10000, _proposedSummary: "Setting monthly revenue to $10,000" },
      },
    },
    { type: "done", delay: 100, sessionId: "sim_sess_4" },
  ],
  "long-response": (Array.from({ length: 50 }, (_, i) => ({
    type: "content_delta",
    delay: 50 + Math.random() * 100,
    content: ["This", "is", "a", "long", "streaming", "response", "to", "test", "performance", "and", "accumulation", "of", "delta", "chunks", "."][i % 15] + " ",
  })) as SimulatedChunk[]).concat([{ type: "done", delay: 100, sessionId: "sim_sess_5" }]),
};

// ─── Simulator Hook ─────────────────────────────────────────────────────────

function useVirtualSimulator() {
  const chat = useKeyChat();
  const [isSimulating, setIsSimulating] = useState(false);
  const [currentScenario, setCurrentScenario] = useState<string>("simple-greeting");
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const abortRef = useRef(false);
  const logsRef = useRef<string[]>([]);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = useCallback((msg: string) => {
    const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
    const entry = `[${timestamp}] ${msg}`;
    logsRef.current = [...logsRef.current.slice(-50), entry];
    setLogs(logsRef.current);
  }, []);

  const simulateStream = useCallback(async (scenario: string) => {
    if (isSimulating) return;
    setIsSimulating(true);
    abortRef.current = false;
    
    const chunks = SIMULATION_SCENARIOS[scenario];
    if (!chunks) {
      addLog(`ERROR: Unknown scenario "${scenario}"`);
      setIsSimulating(false);
      return;
    }

    addLog(`Starting simulation: ${scenario} (${chunks.length} chunks)`);

    // Create assistant placeholder
    const assistantId = `sim_${Date.now()}`;
    chat.appendMessage({
      id: assistantId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
    });
    chat.setStatus("streaming");

    let accumulatedContent = "";

    for (const chunk of chunks) {
      if (abortRef.current) {
        addLog("Simulation aborted");
        chat.setStatus("idle");
        setIsSimulating(false);
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, chunk.delay / playbackSpeed));

      switch (chunk.type) {
        case "content_delta":
          if (chunk.content) {
            accumulatedContent += chunk.content;
            chat.updateMessage(assistantId, { content: accumulatedContent });
            addLog(`δ: "${chunk.content}"`);
          }
          break;

        case "confirmation_required":
          if (chunk.pendingConfirmations) {
            chat.updateMessage(assistantId, {
              pendingConfirmations: chunk.pendingConfirmations as FlowPendingConfirmation[],
              requiresConfirmation: true,
              plan: chunk.pendingConfirmations.map((pc) => ({
                toolCallId: pc.toolCallId,
                name: pc.name,
                description: pc.description,
                arguments: pc.arguments,
                riskLevel: pc.riskLevel as "low" | "medium" | "high",
                status: "pending",
              })),
            });
            addLog(`⚠️ Confirmation required: ${chunk.pendingConfirmations[0].name}`);
          }
          break;

        case "card":
          if (chunk.card) {
            chat.updateMessage(assistantId, { card: chunk.card as OnboardingCardData });
            addLog(`📋 Card: ${chunk.card.type}`);
          }
          break;

        case "error":
          chat.updateMessage(assistantId, {
            content: accumulatedContent + `\n\n**Error:** ${chunk.error}`,
          });
          chat.setStatus("error");
          chat.setError(chunk.error);
          addLog(`❌ Error: ${chunk.error}`);
          setIsSimulating(false);
          return;

        case "done":
          chat.setStatus("idle");
          if (chunk.sessionId) {
            chat.setActiveSessionId(chunk.sessionId);
          }
          addLog(`✅ Done (session: ${chunk.sessionId || "n/a"})`);
          break;
      }
    }

    chat.setStatus("idle");
    setIsSimulating(false);
  }, [chat, isSimulating, playbackSpeed, addLog]);

  const abortSimulation = useCallback(() => {
    abortRef.current = true;
    chat.setStatus("idle");
    setIsSimulating(false);
    addLog("Simulation aborted by user");
  }, [chat, addLog]);

  const resetSimulation = useCallback(() => {
    chat.setMessages([]);
    chat.setActiveSessionId(null);
    chat.setStatus("idle");
    chat.setError(undefined);
    chat.setInput("");
    logsRef.current = [];
    setLogs([]);
    addLog("Simulation reset");
  }, [chat, addLog]);

  return {
    isSimulating,
    currentScenario,
    setCurrentScenario,
    playbackSpeed,
    setPlaybackSpeed,
    simulateStream,
    abortSimulation,
    resetSimulation,
    logs,
  };
}

// ─── Simulator UI ───────────────────────────────────────────────────────────

function SimulatorPanel() {
  const {
    isSimulating,
    currentScenario,
    setCurrentScenario,
    playbackSpeed,
    setPlaybackSpeed,
    simulateStream,
    abortSimulation,
    resetSimulation,
    logs,
  } = useVirtualSimulator();

  const scenarios = [
    { id: "simple-greeting", label: "Simple Greeting", icon: MessageSquare, color: "bg-blue-500" },
    { id: "with-confirmation", label: "With Confirmation", icon: AlertTriangle, color: "bg-amber-500" },
    { id: "with-tool-results", label: "Tool Execution", icon: Zap, color: "bg-emerald-500" },
    { id: "with-error", label: "Error Handling", icon: XCircle, color: "bg-red-500" },
    { id: "genome-proposal", label: "Genome Proposal", icon: Dna, color: "bg-violet-500" },
    { id: "long-response", label: "Long Response", icon: FastForward, color: "bg-cyan-500" },
  ];

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <Bug className="h-4 w-4 text-orange-500" />
        <h2 className="text-sm font-semibold">Virtual Simulator</h2>
        {isSimulating && (
          <Badge variant="outline" className="animate-pulse text-orange-500 border-orange-500">
            <Radio className="h-3 w-3 mr-1" />
            Simulating
          </Badge>
        )}
      </div>

      {/* Scenario Selector */}
      <div className="grid grid-cols-2 gap-2">
        {scenarios.map((scenario) => (
          <button
            key={scenario.id}
            onClick={() => setCurrentScenario(scenario.id)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors",
              currentScenario === scenario.id
                ? "bg-muted text-foreground ring-1 ring-border"
                : "text-muted-foreground hover:bg-muted/60"
            )}
          >
            <scenario.icon className={cn("h-3.5 w-3.5", scenario.color.replace("bg-", "text-"))} />
            {scenario.label}
          </button>
        ))}
      </div>

      {/* Playback Controls */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Speed:</span>
        {[0.5, 1, 2, 5].map((speed) => (
          <button
            key={speed}
            onClick={() => setPlaybackSpeed(speed)}
            className={cn(
              "rounded px-2 py-0.5 text-xs transition-colors",
              playbackSpeed === speed
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            {speed}x
          </button>
        ))}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1"
          disabled={isSimulating}
          onClick={() => simulateStream(currentScenario)}
        >
          {isSimulating ? (
            <>
              <Pause className="h-3.5 w-3.5 mr-1" />
              Running...
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5 mr-1" />
              Run Scenario
            </>
          )}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!isSimulating}
          onClick={abortSimulation}
        >
          <XCircle className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={resetSimulation}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Event Log */}
      <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">Event Log</span>
          <Badge variant="secondary" className="text-[10px]">{logs.length}</Badge>
        </div>
        <div className="h-48 overflow-y-auto space-y-1 font-mono text-[10px]">
          {logs.length === 0 ? (
            <span className="text-muted-foreground italic">No events yet. Run a scenario to see the simulation.</span>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="text-muted-foreground">
                {log}
              </div>
            ))
          )}
        </div>
      </div>

      {/* State Inspector */}
      <StateInspector />
    </div>
  );
}

function StateInspector() {
  const chat = useKeyChat();
  const [showInspector, setShowInspector] = useState(false);

  if (!showInspector) {
    return (
      <button
        onClick={() => setShowInspector(true)}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        Show State Inspector →
      </button>
    );
  }

  return (
      <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">State Inspector</span>
        </div>
        <button
          onClick={() => setShowInspector(false)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Hide
        </button>
      </div>
      <div className="space-y-2 text-[10px] font-mono">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Status:</span>
          <Badge variant={chat.status === "streaming" ? "default" : "secondary"} className="text-[10px]">
            {chat.status}
          </Badge>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Mode:</span>
          <span>{chat.chatMode || "general"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Messages:</span>
          <span>{chat.messages.length}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Sessions:</span>
          <span>{chat.sessions.length}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Active Session:</span>
          <span className="truncate max-w-[120px]">{chat.activeSessionId || "none"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Error:</span>
          <span className={chat.error ? "text-red-400" : "text-muted-foreground"}>
            {chat.error ? "Yes" : "No"}
          </span>
        </div>
        <div className="border-t border-border pt-2">
          <span className="text-muted-foreground">Last Message:</span>
          <div className="mt-1 p-1.5 rounded bg-muted/50 max-h-20 overflow-y-auto">
            {chat.messages.length > 0 ? (
              <span className="text-[10px]">
                [{chat.messages[chat.messages.length - 1].role}] {chat.messages[chat.messages.length - 1].content.slice(0, 100)}
                {chat.messages[chat.messages.length - 1].content.length > 100 ? "..." : ""}
              </span>
            ) : (
              <span className="text-muted-foreground italic">No messages</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Simulator Page ──────────────────────────────────────────────────────

export default function KeyChatSimulatorPage() {
  return (
    <div className="h-screen flex flex-col">
      <div className="border-b border-border px-4 py-2 flex items-center gap-2">
        <Bug className="h-4 w-4 text-orange-500" />
        <h1 className="text-sm font-semibold">KEY Chat Virtual Simulator</h1>
        <Badge variant="outline" className="text-[10px]">Development Tool</Badge>
      </div>
      
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Chat Shell */}
        <div className="flex-1 min-w-0">
          <KeyChatProvider>
            <KeyFullChatShell />
          </KeyChatProvider>
        </div>
        
        {/* Right: Simulator Panel */}
        <div className="w-80 shrink-0 border-l border-border bg-muted/20 overflow-y-auto">
          <KeyChatProvider>
            <SimulatorPanel />
          </KeyChatProvider>
        </div>
      </div>
    </div>
  );
}
