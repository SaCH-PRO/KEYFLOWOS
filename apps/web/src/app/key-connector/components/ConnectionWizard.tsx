'use client';

import { useState } from 'react';
import {
  Check,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Zap,
  Shield,
  Settings,
  Plug,
  X,
  Eye,
  EyeOff,
} from 'lucide-react';
import { api } from '@/trpc/react';
import { cn } from '@/lib/utils';
import type { Provider, WizardStep, ConfigSchemaField } from '../types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

interface ConnectionWizardProps {
  provider: Provider | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const stepConfig = [
  { label: 'Select', icon: Zap },
  { label: 'Authenticate', icon: Shield },
  { label: 'Configure', icon: Settings },
  { label: 'Connect', icon: Plug },
];

export function ConnectionWizard({ provider, open, onClose, onSuccess }: ConnectionWizardProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [credentials, setCredentials] = useState<Record<string, string | number | boolean>>({});
  const [scopes, setScopes] = useState<string[]>([]);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const connectMutation = api.keyConnector.connectProvider.useMutation({
    onSuccess: () => {
      onSuccess();
      handleClose();
    },
    onError: (err) => {
      setError(err.message ?? 'Connection failed. Please try again.');
    },
  });

  const reset = () => {
    setStep(1);
    setCredentials({});
    setScopes([]);
    setShowPasswords({});
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleNext = () => {
    if (step < 4) {
      setStep((prev) => (prev + 1) as WizardStep);
    } else {
      handleConnect();
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep((prev) => (prev - 1) as WizardStep);
    }
  };

  const handleConnect = () => {
    if (!provider) return;
    setError(null);
    connectMutation.mutate({
      providerKey: provider.key,
      credentials,
      scopes: scopes.length > 0 ? scopes : provider.scopes ?? [],
    });
  };

  const canProceed = () => {
    if (!provider) return false;
    if (step === 2) {
      // Validate required config fields
      return provider.configSchema
        .filter((f) => f.required)
        .every((f) => {
          const val = credentials[f.key];
          return val !== undefined && val !== '' && val !== null;
        });
    }
    return true;
  };

  const toggleScope = (scope: string) => {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  const togglePassword = (key: string) => {
    setShowPasswords((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Plug className="h-4 w-4 text-blue-500" />
            {provider ? `Connect ${provider.name}` : 'Connect Provider'}
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center justify-between px-2 py-4">
          {stepConfig.map((s, idx) => {
            const stepNum = (idx + 1) as WizardStep;
            const isActive = step === stepNum;
            const isDone = step > stepNum;
            const StepIcon = s.icon;

            return (
              <div key={idx} className="flex items-center gap-2">
                <div
                  className={cn(
                    'flex items-center justify-center h-8 w-8 rounded-full border-2 text-[11px] font-bold transition-colors',
                    isActive && 'border-blue-500 bg-blue-50 text-blue-600',
                    isDone && 'border-emerald-500 bg-emerald-50 text-emerald-600',
                    !isActive && !isDone && 'border-slate-200 text-slate-400',
                  )}
                >
                  {isDone ? <Check className="h-3.5 w-3.5" /> : <StepIcon className="h-3.5 w-3.5" />}
                </div>
                <span
                  className={cn(
                    'text-[10px] font-medium hidden sm:block',
                    isActive ? 'text-slate-800' : isDone ? 'text-emerald-600' : 'text-slate-400',
                  )}
                >
                  {s.label}
                </span>
                {idx < stepConfig.length - 1 && (
                  <ChevronRight className="h-3 w-3 text-slate-300 mx-1" />
                )}
              </div>
            );
          })}
        </div>

        {/* Error banner */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-[11px] text-red-700">
            {error}
          </div>
        )}

        {/* Step content */}
        <div className="min-h-[200px]">
          {/* Step 1: Select Provider */}
          {step === 1 && provider && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
                <div className="h-12 w-12 rounded-full bg-blue-500 flex items-center justify-center text-white text-lg font-bold">
                  {provider.name.charAt(0)}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">{provider.name}</h3>
                  <p className="text-[11px] text-slate-500">{provider.description}</p>
                  <Badge variant="outline" className="mt-1 text-[10px]">
                    {provider.category}
                  </Badge>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                You are about to connect <strong>{provider.name}</strong> to KeyFlowOS. 
                This will allow secure data sync between your account and the platform.
              </p>
            </div>
          )}

          {/* Step 2: Authentication */}
          {step === 2 && provider && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                Enter your {provider.name} credentials to authenticate.
              </p>
              {provider.configSchema.map((field) => (
                <ConfigFieldInput
                  key={field.key}
                  field={field}
                  value={credentials[field.key]}
                  showPassword={!!showPasswords[field.key]}
                  onChange={(val) =>
                    setCredentials((prev) => ({ ...prev, [field.key]: val }))
                  }
                  onTogglePassword={() => togglePassword(field.key)}
                />
              ))}
            </div>
          )}

          {/* Step 3: Configure Scopes */}
          {step === 3 && provider && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                Select the data scopes you want to enable for this connection.
              </p>
              {provider.scopes && provider.scopes.length > 0 ? (
                <div className="space-y-2">
                  {provider.scopes.map((scope) => (
                    <label
                      key={scope}
                      className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <Checkbox
                        checked={scopes.includes(scope)}
                        onCheckedChange={() => toggleScope(scope)}
                      />
                      <div>
                        <div className="text-xs font-medium text-slate-800">{scope}</div>
                        <div className="text-[10px] text-slate-400">
                          Allow access to {scope.toLowerCase().replace(/_/g, ' ')}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-slate-400 text-xs">
                  No additional scopes to configure.
                </div>
              )}
            </div>
          )}

          {/* Step 4: Confirm */}
          {step === 4 && provider && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
                <h4 className="text-xs font-semibold text-blue-800">Connection Summary</h4>
                <div className="space-y-1.5 text-[11px] text-slate-700">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Provider</span>
                    <span className="font-medium">{provider.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Category</span>
                    <span className="font-medium">{provider.category}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Scopes</span>
                    <span className="font-medium">
                      {scopes.length > 0 ? scopes.length : provider.scopes?.length ?? 0} selected
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Credentials</span>
                    <span className="font-medium text-emerald-600">
                      {provider.configSchema.filter((f) => f.required && credentials[f.key]).length} of{' '}
                      {provider.configSchema.filter((f) => f.required).length} filled
                    </span>
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 text-center">
                Click Connect to establish the integration.
              </p>
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-100">
          <Button
            variant="ghost"
            size="sm"
            className={cn('text-xs', step === 1 && 'invisible')}
            onClick={handleBack}
            disabled={connectMutation.isPending}
          >
            <ChevronLeft className="h-3.5 w-3.5 mr-1" />
            Back
          </Button>
          <Button
            size="sm"
            className="text-xs px-4 bg-blue-500 hover:bg-blue-600"
            onClick={handleNext}
            disabled={!canProceed() || connectMutation.isPending}
          >
            {connectMutation.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                Connecting...
              </>
            ) : step === 4 ? (
              <>
                <Plug className="h-3.5 w-3.5 mr-1" />
                Connect
              </>
            ) : (
              <>
                Next
                <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConfigFieldInput({
  field,
  value,
  showPassword,
  onChange,
  onTogglePassword,
}: {
  field: ConfigSchemaField;
  value: string | number | boolean | undefined;
  showPassword: boolean;
  onChange: (val: string | number | boolean) => void;
  onTogglePassword: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">
        {field.label}
        {field.required && <span className="text-red-400 ml-0.5">*</span>}
      </Label>
      {field.description && (
        <p className="text-[10px] text-slate-400">{field.description}</p>
      )}

      {field.type === 'select' ? (
        <Select
          value={String(value ?? '')}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder={field.placeholder} />
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.type === 'boolean' ? (
        <label className="flex items-center gap-2 p-2 rounded-md border border-slate-100 cursor-pointer w-fit">
          <Checkbox
            checked={!!value}
            onCheckedChange={(checked) => onChange(!!checked)}
          />
          <span className="text-xs text-slate-600">Enable</span>
        </label>
      ) : (
        <div className="relative">
          <Input
            type={field.type === 'password' && !showPassword ? 'password' : field.type === 'url' ? 'url' : 'text'}
            placeholder={field.placeholder}
            className="h-8 text-xs"
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
          />
          {field.type === 'password' && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              onClick={onTogglePassword}
            >
              {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
