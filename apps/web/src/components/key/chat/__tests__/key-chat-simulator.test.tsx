import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { KeyChatProvider, useKeyChat } from '../key-chat-store';
import { KeyActionChips } from '../key-action-chips';
import { KeyGenomePreview } from '../key-genome-preview';
import { KeyMessageRenderer } from '../key-message-renderer';
import type { KeyChatMessage } from '../types';

// ─── Mock react-syntax-highlighter (ESM/CJS compatibility issue) ─────────────

vi.mock('react-syntax-highlighter', () => ({
  Prism: ({ children }: { children: React.ReactNode }) => <pre>{children}</pre>,
}));

vi.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({
  vscDarkPlus: {},
}));

// ─── Mock TTS Engine ──────────────────────────────────────────────────────────

vi.mock('@/components/tts', () => ({
  useTts: () => ({
    engine: {
      speak: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn(),
      toggleMuted: vi.fn(),
      playAudioBlob: vi.fn().mockResolvedValue(undefined),
    },
    state: {
      muted: false,
      speed: 1,
      playing: false,
      paused: false,
      currentText: '',
      currentSentence: '',
      queue: [],
      availableProviders: [],
    },
  }),
  TtsProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ─── Mock Workspace ─────────────────────────────────────────────────────────

vi.mock('@/lib/workspace', () => ({
  getStoredBusinessId: () => 'biz_test_123',
  getStoredWorkspaceId: () => 'ws_test_123',
}));

// ─── Mock API Client ─────────────────────────────────────────────────────────

vi.mock('@/lib/client', () => ({
  sendFlowChat: vi.fn().mockResolvedValue({
    data: {
      reply: 'Mock REST response',
      sessionId: 'sess_1',
      pendingConfirmations: [],
      toolResults: [],
    },
  }),
  confirmFlowAction: vi.fn().mockResolvedValue({ data: { success: true } }),
  fetchFlowSessions: vi.fn().mockResolvedValue({
    data: [
      { id: 'sess_1', title: 'Invoice help', updatedAt: '2024-01-15T10:00:00Z', createdAt: '2024-01-15T10:00:00Z' },
      { id: 'sess_2', title: 'Genome onboarding', updatedAt: '2024-01-14T14:30:00Z', createdAt: '2024-01-14T14:30:00Z' },
    ],
  }),
  deleteFlowSession: vi.fn().mockResolvedValue({ data: { success: true } }),
}));

// ─── Mock Business Genome API ──────────────────────────────────────────────────

vi.mock('@/lib/api/business-genome', () => ({
  sendGenomeMessage: vi.fn().mockResolvedValue({
    data: {
      message: {
        id: 'gen_msg_1',
        role: 'assistant',
        content: 'Genome update proposed!',
        createdAt: new Date().toISOString(),
      },
      proposedUpdates: {
        section: 'financial',
        data: { monthlyRevenue: 10000 },
        summary: 'Setting monthly revenue to $10,000 based on your input',
      },
    },
  }),
  getGenome: vi.fn().mockResolvedValue({
    data: {
      genomeIntegrity: 65,
      genomeDnaScores: {
        founder: 80, vision: 70, business: 60, market: 50,
        financial: 40, legal: 30, operations: 20, sales: 10,
        marketing: 15, growth: 5, technology: 25, risk: 10,
      },
      genomeDnaConfidence: {
        founder: 80, vision: 70, business: 60, market: 50,
        financial: 40, legal: 30, operations: 20, sales: 10,
        marketing: 15, growth: 5, technology: 25, risk: 10,
      },
      genomeStage: 'VALIDATED_CONCEPT',
      threePillarMinimumMet: true,
      executiveReadinessScore: 45,
      readinessBreakdown: { legal: 30, financial: 40, market: 50, operations: 20, sales: 10, marketing: 15, risk: 10 },
      dnaSections: [
        { key: 'founder', label: 'Founder DNA', integrity: 80, confidence: 80, summary: 'Strong founder profile', fieldsCaptured: 8, fieldsTotal: 10, missingFields: [], recommendation: '' },
        { key: 'vision', label: 'Vision DNA', integrity: 70, confidence: 70, summary: 'Clear vision', fieldsCaptured: 5, fieldsTotal: 8, missingFields: [], recommendation: '' },
        { key: 'market', label: 'Market DNA', integrity: 50, confidence: 50, summary: 'Market research needed', fieldsCaptured: 3, fieldsTotal: 10, missingFields: ['targetAudience', 'competitors'], recommendation: 'Research competitors' },
      ],
    },
  }),
}));

// ─── Mock Upload Hook ────────────────────────────────────────────────────────

vi.mock('@/hooks/use-upload', () => ({
  useUpload: () => ({
    uploadFile: vi.fn().mockResolvedValue({ url: 'https://mock-upload.com/file.pdf', objectPath: 'uploads/file.pdf' }),
    isUploading: false,
  }),
}));

// ─── Mock Voice Input ────────────────────────────────────────────────────────

vi.mock('../use-voice-input', () => ({
  useVoiceInput: () => ({
    isRecording: false,
    isProcessing: false,
    toggle: vi.fn(),
  }),
}));

// ─── Mock Copy Hook ──────────────────────────────────────────────────────────

vi.mock('@/hooks/use-copy-to-clipboard', () => ({
  useCopyToClipboard: () => ({
    copied: false,
    copy: vi.fn(),
  }),
}));

// ─── Mock API Base ───────────────────────────────────────────────────────────

vi.mock('@/lib/api-base', () => ({
  getApiBase: () => 'http://localhost:3001',
}));

vi.mock('@/lib/api', () => ({
  getAuthHeaders: () => ({ Authorization: 'Bearer mock-token' }),
  API_BASE: 'http://localhost:3001',
}));

// ─── Test Utilities ───────────────────────────────────────────────────────────

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <KeyChatProvider>
      {ui}
    </KeyChatProvider>
  );
}

function setupMockFetch() {
  vi.stubGlobal('fetch', vi.fn(async () => {
    return new Response(JSON.stringify({ data: { reply: 'Mock response' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }));
}

function setupMockLocalStorage() {
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Key Chat Command Center', () => {
  beforeEach(() => {
    setupMockFetch();
    setupMockLocalStorage();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('KeyChatProvider', () => {
    it('provides initial state', () => {
      let chatState: ReturnType<typeof useKeyChat> | undefined;

      function TestConsumer() {
        const chat = useKeyChat();
        // Assign in an effect, not during render: writing to a variable declared
        // outside the component is a render side effect and trips
        // react-hooks/purity.
        useEffect(() => {
          chatState = chat;
        }, [chat]);
        return null;
      }
      
      renderWithProviders(<TestConsumer />);
      
      // Narrows the union for the assertions below; also fails loudly if the
      // effect never ran.
      if (!chatState) throw new Error('chat state was never captured');
      expect(chatState.chatMode).toBe('general');
      expect(chatState.messages).toEqual([]);
      expect(chatState.sessions).toEqual([]);
    });
  });

  describe('KeyMessageRenderer', () => {
    it('renders user message with gradient bubble', () => {
      const message: KeyChatMessage = {
        id: 'msg_1',
        role: 'user',
        content: 'Hello KEY!',
        timestamp: Date.now(),
      };
      
      render(<KeyMessageRenderer message={message} />);
      
      expect(screen.getByText('Hello KEY!')).toBeInTheDocument();
    });

    it('renders assistant message with markdown', () => {
      const message: KeyChatMessage = {
        id: 'msg_2',
        role: 'assistant',
        content: '**Bold** and *italic* text',
        timestamp: Date.now(),
      };
      
      render(<KeyMessageRenderer message={message} />);
      
      expect(screen.getByText(/Bold/)).toBeInTheDocument();
    });

    it('renders plan steps with confirmation buttons', () => {
      const message: KeyChatMessage = {
        id: 'msg_3',
        role: 'assistant',
        content: 'I need your approval:',
        timestamp: Date.now(),
        plan: [
          {
            toolCallId: 'tc_1',
            name: 'commerce_create_invoice',
            description: 'Create $500 invoice',
            arguments: { amount: 500 },
            riskLevel: 'medium',
            status: 'pending',
          },
        ],
        requiresConfirmation: true,
      };
      
      const onConfirm = vi.fn();
      render(<KeyMessageRenderer message={message} onConfirm={onConfirm} />);
      
      expect(screen.getByText(/Create \$500 invoice/)).toBeInTheDocument();
    });
  });

  describe('KeyActionChips', () => {
    it('renders mode-aware chips for general mode', () => {
      renderWithProviders(<KeyActionChips />);
      
      expect(screen.getByText('Create Task')).toBeInTheDocument();
      expect(screen.getByText('Draft Email')).toBeInTheDocument();
      expect(screen.getByText('Schedule')).toBeInTheDocument();
      expect(screen.getByText('Analytics')).toBeInTheDocument();
    });
  });

  describe('KeyGenomePreview', () => {
    it('renders genome integrity score', async () => {
      render(<KeyGenomePreview />);
      
      await waitFor(() => {
        expect(screen.getByText(/65%/)).toBeInTheDocument();
      });
    });

    it('renders stage badge', async () => {
      render(<KeyGenomePreview />);
      
      await waitFor(() => {
        expect(screen.getByText('Validated')).toBeInTheDocument();
      });
    });
  });
});

// ─── Virtual Simulator Export ───────────────────────────────────────────────

export {
  setupMockFetch,
  setupMockLocalStorage,
  renderWithProviders,
};
