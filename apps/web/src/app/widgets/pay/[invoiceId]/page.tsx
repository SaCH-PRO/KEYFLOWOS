'use client';

import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { apiGet, apiPost } from '@/lib/api';

interface Invoice {
  id: string;
  invoiceNumber: string;
  total: number;
  currency: string;
  status: string;
  items?: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
  business?: { name: string };
}

export default function PayWidgetPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const invoiceId = params.invoiceId as string;
  const theme = searchParams.get('theme') || 'dark';
  const primary = searchParams.get('primary') || '#f97316';

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [step, setStep] = useState<'loading' | 'ready' | 'processing' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'stripe' | 'paypal' | 'wipay'>('stripe');

  useEffect(() => {
    apiGet<Invoice>(`/commerce/invoices/${encodeURIComponent(invoiceId)}`)
      .then(({ data, error }) => {
        if (error || !data) {
          setStep('error');
          setErrorMsg(error || 'Invoice not found.');
        } else {
          setInvoice(data);
          setStep(data.status === 'PAID' ? 'success' : 'ready');
        }
      })
      .catch(() => {
        setStep('error');
        setErrorMsg('Unable to load invoice.');
      });
  }, [invoiceId]);

  useEffect(() => {
    if (step !== 'loading') {
      const h = document.body.scrollHeight;
      window.parent.postMessage({ type: 'KEYFLOW_WIDGET_RESIZE', height: h }, '*');
    }
  }, [step]);

  const pay = async () => {
    setStep('processing');
    const { data, error } = await apiPost<{ redirectUrl?: string; paymentId?: string }>({
      path: `/payments/create-checkout`,
      body: { invoiceId, method: paymentMethod.toUpperCase(), returnUrl: window.location.href },
    });
    if (error || !data?.redirectUrl) {
      setStep('error');
      setErrorMsg(error || 'Payment initialization failed.');
    } else {
      window.location.href = data.redirectUrl;
    }
  };

  const _notifyParent = (eventName: string, payload: Record<string, unknown>) => {
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'KEYFLOW_WIDGET_EVENT', eventName, payload }, '*');
    }
  };

  const isDark = theme === 'dark';
  const bg = isDark ? 'bg-slate-950 text-white' : 'bg-white text-slate-900';
  const card = isDark ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200';

  return (
    <div className={`min-h-screen w-full ${bg} px-4 py-6`}>
      <style>{`::selection { background: ${primary}; color: white; }`}</style>

      <div className="mx-auto max-w-sm space-y-4">
        <div className="text-center">
          <h1 className="text-lg font-semibold">Pay Invoice</h1>
          <p className="text-xs opacity-60 mt-1">Powered by KeyflowOS</p>
        </div>

        {step === 'loading' && (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" style={{ color: primary }} />
          </div>
        )}

        {step === 'error' && (
          <div className={`rounded-xl border px-4 py-3 text-sm ${card}`}>
            <p className="text-red-400">{errorMsg}</p>
          </div>
        )}

        {step === 'success' && (
          <div className={`rounded-xl border px-4 py-4 text-center space-y-2 ${card}`}>
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: `${primary}20` }}>
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke={primary} strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="font-medium">This invoice is already paid.</p>
            <p className="text-xs opacity-60">Thank you!</p>
          </div>
        )}

        {step === 'ready' && invoice && (
          <div className="space-y-3">
            <div className={`rounded-xl border p-4 ${card}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs opacity-60">Invoice</span>
                <span className="text-xs font-mono">{invoice.invoiceNumber || invoice.id}</span>
              </div>
              <div className="mt-3 text-center">
                <span className="text-3xl font-bold">{invoice.currency === 'USD' ? '$' : 'TTD'}</span>
                <span className="text-3xl font-bold">{invoice.total.toFixed(2)}</span>
              </div>
              {invoice.business?.name && (
                <p className="text-center text-xs opacity-60 mt-1">{invoice.business.name}</p>
              )}
            </div>

            {invoice.items && invoice.items.length > 0 && (
              <div className={`rounded-xl border p-3 space-y-2 ${card}`}>
                {invoice.items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="truncate">{item.description} × {item.quantity}</span>
                    <span className="font-medium">{invoice.currency} {item.total.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}

            <div className={`rounded-xl border p-3 ${card}`}>
              <label className="block text-xs font-medium opacity-70 mb-2">Payment Method</label>
              <div className="grid grid-cols-3 gap-2">
                {(['stripe', 'paypal', 'wipay'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPaymentMethod(m)}
                    className={`rounded-lg border px-2 py-2 text-xs font-medium capitalize transition-colors ${
                      paymentMethod === m
                        ? 'text-white border-transparent'
                        : isDark
                        ? 'border-white/10 hover:bg-white/5'
                        : 'border-slate-200 hover:bg-slate-100'
                    }`}
                    style={paymentMethod === m ? { backgroundColor: primary } : undefined}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={pay}
              className="w-full rounded-lg py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: primary }}
            >
              Pay {invoice.currency} {invoice.total.toFixed(2)}
            </button>
          </div>
        )}

        {step === 'processing' && (
          <div className="flex flex-col items-center py-8 space-y-3">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" style={{ color: primary }} />
            <p className="text-sm opacity-60">Redirecting to payment...</p>
          </div>
        )}
      </div>
    </div>
  );
}
