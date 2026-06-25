export { KeyAgent, openKey, KEY_OPEN_EVENT } from "./key-agent";
export type { KeyMode, OpenKeyDetail } from "./key-agent";
export { AskKeyButton } from "./ask-key-button";
export { KeyNoticedStream } from "./key-noticed-stream";

// KEY Command Dashboard (Omnipotent UI)
export { KeyCommandCenter } from "./KeyCommandCenter";
export type { KeyCommandCenterProps, KeyMessage, KeyStatus, MessageSender } from "./KeyCommandCenter";

export { KeyActivityFeed } from "./KeyActivityFeed";
export type { KeyActivityFeedProps, ActivityItem, ActivityStatus, ActivityType } from "./KeyActivityFeed";

export { KeySuggestionCards } from "./KeySuggestionCards";
export type { KeySuggestionCardsProps, KeySuggestion, SuggestionCategory } from "./KeySuggestionCards";

export { KeyBusinessHealth } from "./KeyBusinessHealth";
export type { KeyBusinessHealthProps, HealthMetric, HealthAlert, BusinessContext } from "./KeyBusinessHealth";

export { KeyVoiceButton, speakText } from "./KeyVoiceButton";
export type { KeyVoiceButtonProps, VoiceState } from "./KeyVoiceButton";

// ── Flow Studio (Visual Automation Builder) ──────────────────────────
export { KeyFlowStudio } from "./KeyFlowStudio";
export type { KeyFlowStudioProps } from "./KeyFlowStudio";

export { KeyFlowNode } from "./KeyFlowNode";
export type { KeyFlowNodeProps } from "./KeyFlowNode";

export { KeyFlowProperties } from "./KeyFlowProperties";
export type { KeyFlowPropertiesProps } from "./KeyFlowProperties";

export { KeyFlowToolbar } from "./KeyFlowToolbar";
export type { KeyFlowToolbarProps } from "./KeyFlowToolbar";

export { KeyFlowNodePalette } from "./KeyFlowNodePalette";
export type { KeyFlowNodePaletteProps } from "./KeyFlowNodePalette";

export type {
  FlowNodeUI,
  FlowEdgeUI,
  FlowNodeType,
  FlowTemplate,
  ViewportState,
  FlowStudioState,
  Port,
} from "./flow-studio-types";
