# Pluggable Module AI Pattern

## Architecture Overview

Each module has two layers of AI integration:

1. **AI Command Hub** — A unified floating panel with Tools (AI capabilities) + Insights (proactive suggestions)
2. **Module-specific hook** — Registers tools and suggestion logic for that module

The CRM module is the gold standard implementation.

## How to add the AI Hub to any module

### Step 1: Create a module-specific hook

```typescript
// apps/web/src/app/app/[module]/hooks/use-[module]-ai-hub.ts
import { useCallback, useMemo } from "react";
import { useModuleAi, type ModuleContext, type AiSuggestion, type AiTool } from "@/hooks/use-module-ai";

async function generateSuggestions(context: ModuleContext): Promise<AiSuggestion[]> {
  // Call your module's AI endpoint
  // Return AiSuggestion[] array
}

function buildTools(): AiTool[] {
  return [
    {
      id: "my-tool",
      name: "Tool Name",
      description: "What this tool does",
      icon: "analysis",        // Key from TOOL_ICON_MAP in ai-command-hub.tsx
      category: "analyze",     // "analyze" | "generate" | "detect" | "optimize" | "automate"
      requiresSelection: true, // true if needs a selected item
      creditCost: 1,
      execute: async (ctx) => {
        // Call your API, return result data
        const result = await myApiCall(ctx.selectedItemId);
        return result;
      },
    },
  ];
}

export function useModuleAiHub() {
  const tools = useMemo(() => buildTools(), []);

  const ai = useModuleAi({
    moduleId: "my-module",
    moduleName: "Display Name",
    generateSuggestions,
    tools,
  });

  // Add module-specific helpers
  const updateModuleContext = useCallback((params: { businessId: string }) => {
    ai.updateContext({ businessId: params.businessId });
  }, [ai.updateContext]);

  return { ...ai, updateModuleContext };
}
```

### Step 2: Create a tool result renderer (optional but recommended)

```tsx
// apps/web/src/app/app/[module]/components/tool-results.tsx
export function renderToolResult(toolId: string, result: unknown): React.ReactNode {
  switch (toolId) {
    case "my-tool":
      return <MyToolResult data={result} />;
    default:
      return <pre>{JSON.stringify(result, null, 2)}</pre>;
  }
}
```

### Step 3: Wire into the page

```tsx
import { AiCommandHub, AiHubTrigger } from "@/components/ai/ai-command-hub";
import { useModuleAiHub } from "./hooks/use-module-ai-hub";
import { renderToolResult } from "./components/tool-results";

export default function ModulePage() {
  const ai = useModuleAiHub();

  return (
    <>
      {/* Hub panel — renders when open */}
      <AnimatePresence>
        {ai.panelOpen && (
          <AiCommandHub
            ai={ai}
            moduleName="Module"
            onAction={handleAction}
            toolResultRenderer={renderToolResult}
          />
        )}
      </AnimatePresence>

      {/* Floating trigger button — always visible */}
      <AiHubTrigger ai={ai} moduleName="Module" />
    </>
  );
}
```

## Backward Compatibility

The original `ModuleAiAssistant` and `AiAssistantTrigger` still work for simpler modules that only need the suggestions panel without the full tools system.

```tsx
import { ModuleAiAssistant, AiAssistantTrigger } from "@/components/ai/module-ai-assistant";
```

## Key Types

- `AiTool`: Defines an AI capability with execute function, category, credit cost
- `AiToolCategory`: "analyze" | "generate" | "detect" | "optimize" | "automate"
- `AiSuggestion`: Proactive insight with type, priority, optional action
- `HubMode`: "tools" | "suggestions" | "tool-result"
- `ModuleContext`: Shared context (businessId, selectedItemId, activeView, etc.)

## File Structure

```
components/ai/
  ai-command-hub.tsx          — Universal hub panel + trigger
  module-ai-assistant.tsx     — Legacy simple panel (backward compat)
  README-PATTERN.md           — This file

hooks/
  use-module-ai.ts            — Core hook with tools + suggestions

app/app/crm/pipeline/
  hooks/use-crm-ai-hub.ts    — CRM-specific hub implementation
  components/crm-tool-results.tsx — CRM tool result renderers
```
