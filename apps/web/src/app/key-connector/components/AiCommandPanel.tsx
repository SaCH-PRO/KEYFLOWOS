'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Send,
  Bot,
  User,
  Sparkles,
  Loader2,
  Zap,
} from 'lucide-react';
import { api } from '@/trpc/react';
import { cn } from '@/lib/utils';
import type { AiCommandMessage } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

const EXAMPLE_COMMANDS = [
  'Connect my Google account',
  'Sync all contacts',
  'Show my Stripe connection health',
  'Order a blog post from KeyStore',
];

export function AiCommandPanel() {
  const [messages, setMessages] = useState<AiCommandMessage[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const aiMutation = api.keyConnector.processAiCommand.useMutation({
    onSuccess: (data) => {
      if (data && typeof data === 'object' && 'response' in data) {
        const assistantMsg: AiCommandMessage = {
          role: 'assistant',
          content: String((data as { response: unknown }).response ?? 'Done.'),
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }
    },
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, aiMutation.isPending]);

  const handleSend = () => {
    if (!input.trim() || aiMutation.isPending) return;

    const userMsg: AiCommandMessage = {
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');

    aiMutation.mutate({ command: userMsg.content });
  };

  const handleExampleClick = (cmd: string) => {
    const userMsg: AiCommandMessage = {
      role: 'user',
      content: cmd,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    aiMutation.mutate({ command: cmd });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Bot className="h-4 w-4 text-violet-500" />
          AI Gateway
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Chat area */}
        <div className="flex flex-col h-72">
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto space-y-3 pr-1"
          >
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Sparkles className="h-8 w-8 text-violet-300 mb-3" />
                <p className="text-xs text-slate-500 mb-4">
                  Ask me to manage your integrations
                </p>
                {/* Example chips */}
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {EXAMPLE_COMMANDS.map((cmd) => (
                    <button
                      key={cmd}
                      onClick={() => handleExampleClick(cmd)}
                      className={cn(
                        'text-[10px] px-2 py-1 rounded-full border transition-colors',
                        'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100',
                        aiMutation.isPending && 'opacity-50 cursor-not-allowed',
                      )}
                      disabled={aiMutation.isPending}
                    >
                      {cmd}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={cn(
                  'flex gap-2',
                  msg.role === 'user' ? 'flex-row-reverse' : 'flex-row',
                )}
              >
                <div
                  className={cn(
                    'flex-shrink-0 h-6 w-6 rounded-full flex items-center justify-center',
                    msg.role === 'user'
                      ? 'bg-blue-100 text-blue-600'
                      : 'bg-violet-100 text-violet-600',
                  )}
                >
                  {msg.role === 'user' ? (
                    <User className="h-3 w-3" />
                  ) : (
                    <Bot className="h-3 w-3" />
                  )}
                </div>
                <div
                  className={cn(
                    'rounded-lg px-3 py-2 max-w-[85%] text-xs leading-relaxed',
                    msg.role === 'user'
                      ? 'bg-blue-500 text-white'
                      : 'bg-slate-100 text-slate-800',
                  )}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {aiMutation.isPending && (
              <div className="flex gap-2">
                <div className="h-6 w-6 rounded-full bg-violet-100 flex items-center justify-center">
                  <Bot className="h-3 w-3 text-violet-600" />
                </div>
                <div className="bg-slate-100 rounded-lg px-3 py-2">
                  <Loader2 className="h-3.5 w-3.5 text-violet-500 animate-spin" />
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="flex items-center gap-2 mt-3 pt-2 border-t border-slate-100">
            <Input
              placeholder="Type a command..."
              className="flex-1 h-8 text-xs"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={aiMutation.isPending}
            />
            <Button
              size="sm"
              className="h-8 w-8 p-0 bg-violet-500 hover:bg-violet-600"
              onClick={handleSend}
              disabled={aiMutation.isPending || !input.trim()}
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
