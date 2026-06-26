'use client';

/**
 * CortexPersonalitySelector — 8-persona picker with animated dropdown
 * Each personality shows: color dot, name, tagline, voice mapping.
 */

import { useState, useRef, useEffect } from 'react';
import { PERSONALITY_CONFIGS, CortexPersona } from './cortex-types';

interface PersonalitySelectorProps {
  currentPersona: CortexPersona;
  onSwitch: (persona: CortexPersona) => void;
  disabled?: boolean;
}

export function CortexPersonalitySelector({ currentPersona, onSwitch, disabled }: PersonalitySelectorProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const current = PERSONALITY_CONFIGS[currentPersona];

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const personas = Object.entries(PERSONALITY_CONFIGS) as [CortexPersona, typeof PERSONALITY_CONFIGS['jarvis']][];

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Current Selection Button */}
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--kf-border)] 
                   bg-[var(--kf-surface)] hover:bg-[var(--kf-surface-hover)] transition-colors
                   disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="Switch personality"
        aria-expanded={open}
      >
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
          style={{ backgroundColor: current.color }}
        >
          {current.name[0]}
        </div>
        <span className="text-sm text-[var(--kf-text)] font-medium">{current.name}</span>
        <svg
          className={`w-4 h-4 text-[var(--kf-text-muted)] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1.5 w-72 rounded-xl border border-[var(--kf-border)] 
                        bg-[var(--kf-surface-elevated)] shadow-lg overflow-hidden
                        animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="px-3 py-2 border-b border-[var(--kf-border)]">
            <span className="text-xs font-semibold text-[var(--kf-text-muted)] uppercase tracking-wide">
              Choose Your AI
            </span>
          </div>

          <div className="py-1 max-h-80 overflow-y-auto">
            {personas.map(([key, config]) => {
              const isActive = key === currentPersona;
              return (
                <button
                  key={key}
                  onClick={() => {
                    onSwitch(key);
                    setOpen(false);
                  }}
                  className={`w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors
                    ${isActive ? 'bg-[var(--kf-primary)]/10' : 'hover:bg-[var(--kf-surface-hover)]'}`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold 
                      flex-shrink-0 mt-0.5 ${isActive ? 'ring-2 ring-offset-1' : ''}`}
                    style={{
                      backgroundColor: config.color,
                      ['--tw-ring-color' as string]: config.color,
                    }}
                  >
                    {config.name[0]}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-semibold ${isActive ? 'text-[var(--kf-primary)]' : 'text-[var(--kf-text)]'}`}>
                        {config.name}
                      </span>
                      {isActive && (
                        <svg className="w-4 h-4 text-[var(--kf-primary)]" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                    <div className="text-xs text-[var(--kf-text-muted)] truncate">{config.tagline}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--kf-surface)] text-[var(--kf-text-muted)] border border-[var(--kf-border)]">
                        {config.responseFormat}
                      </span>
                      <span className="text-[10px] text-[var(--kf-text-muted)]">
                        {config.temperature > 0.8 ? 'Creative' : config.temperature > 0.6 ? 'Balanced' : 'Precise'}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
