# Pluggable Module AI Pattern

## How to add AI Assistant to any module

### 1. Create a module-specific hook

```typescript
// apps/web/src/app/app/[module]/hooks/use-[module]-ai-assistant.ts
import { useCallback } from "react";
import { useModuleAi, type ModuleContext, type AiSuggestion } from "@/hooks/use-module-ai";

async function generateSuggestions(context: ModuleContext): Promise<AiSuggestion[]> {
  // Call your module's AI endpoint
  // Return AiSuggestion[] array
}

export function useModuleAiAssistant() {
  return useModuleAi({
    moduleId: "your-module",
    moduleName: "Display Name",
    generateSuggestions,
  });
}
```

### 2. Wire into the page

```tsx
import { ModuleAiAssistant, AiAssistantTrigger } from "@/components/ai/module-ai-assistant";
import { useModuleAiAssistant } from "./hooks/use-module-ai-assistant";

export default function ModulePage() {
  const ai = useModuleAiAssistant();

  return (
    <>
      <AiAssistantTrigger ai={ai} moduleName="Module" />
      <AnimatePresence>
        {ai.panelOpen && (
          <ModuleAiAssistant ai={ai} moduleName="Module" onAction={handleAction} />
        )}
      </AnimatePresence>
    </>
  );
}
```
