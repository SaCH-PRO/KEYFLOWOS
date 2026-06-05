'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { apiGet, apiPost } from '@/lib/api';

interface Product {
  id: string;
  name: string;
  price: number;
  description?: string;
  imageUrl?: string;
}

interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

export default function CartWidgetPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const slug = params.slug as string;
  const theme = searchParams.get('theme') || 'dark';
  const primary = searchParams.get('primary') || '#f97316';
  const singleProductId = searchParams.get('productId') || '';

  const [step, setStep] = useState<'loading' | 'browse' | 'checkout' | 'success' | 'error'>('loading');
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [orderResult, setOrderResult] = useState<{ orderId?: string; payment?: { redirectUrl?: string } } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const addToCart = useCallback((product: Product) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.productId === product.id);
      if (existing) {
        return prev.map((i) => (i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [...prev, { productId: product.id, name: product.name, price: product.price, quantity: 1 }];
    });
  }, []);

  useEffect(() => {
    apiGet<{ products?: Product[] }>(`/site/storefront/public/${encodeURIComponent(slug)}`)
      .then(({ data }) => {
        const list = data?.products ?? [];
        setProducts(list);
        if (singleProductId) {
          const p = list.find((x) => x.id === singleProductId);
          if (p) addToCart(p);
        }
        setStep('browse');
      })
      .catch(() => {
        setStep('error');
        setErrorMsg('Unable to load products.');
      });
  }, [slug, singleProductId, addToCart]);

  useEffect(() => {
    if (step !== 'loading') {
      const h = document.body.scrollHeight;
      window.parent.postMessage({ type: 'KEYFLOW_WIDGET_RESIZE', height: h }, '*');
    }
  }, [step, cart.length]);

  const removeFromCart = useCallback((productId: string) => {
    setCart((prev) => prev.filter((i) => i.productId !== productId));
  }, []);

  const cartTotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const submitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) return;
    setStep('loading');
    const { data, error } = await apiPost<{
      order: { id: string };
      payment?: { redirectUrl?: string; status: string };
    }>({
      path: `/site/storefront/public/${encodeURIComponent(slug)}/checkout`,
      body: {
        items: cart.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        customerInfo: { name: customerName, email: customerEmail, phone: customerPhone },
        paymentMethod: 'STRIPE',
        returnUrl: window.location.href,
      },
    });
    if (error || !data?.order) {
      setStep('error');
      setErrorMsg(error || 'Checkout failed. Please try again.');
    } else {
      setOrderResult({ orderId: data.order.id, payment: data.payment });
      setStep('success');
      notifyParent('cart:purchase', { orderId: data.order.id, total: cartTotal });
      if (data.payment?.redirectUrl) {
        router.push(data.payment.redirectUrl);
      }
    }
  };

  const notifyParent = (eventName: string, payload: Record<string, unknown>) => {
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'KEYFLOW_WIDGET_EVENT', eventName, payload }, '*');
    }
  };

  const isDark = theme === 'dark';
  const bg = isDark ? 'bg-slate-950 text-white' : 'bg-white text-slate-900';
  const card = isDark ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200';
  const input = isDark
    ? 'bg-white/5 border-white/10 text-white placeholder:text-white/40'
    : 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400';

  return (
    <div className={`min-h-screen w-full ${bg} px-4 py-6`}>
      <style>{`::selection { background: ${primary}; color: white; }`}</style>

      <div className="mx-auto max-w-sm space-y-4">
        <div className="text-center">
          <h1 className="text-lg font-semibold">{step === 'checkout' ? 'Checkout' : 'Order Now'}</h1>
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
            <button onClick={() => setStep('browse')} className="mt-2 text-sm underline" style={{ color: primary }}>
              Try again
            </button>
          </div>
        )}

        {step === 'success' && orderResult && (
          <div className={`rounded-xl border px-4 py-4 text-center space-y-2 ${card}`}>
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: `${primary}20` }}>
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke={primary} strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="font-medium">Order placed!</p>
            <p className="text-xs opacity-60">Order ID: {orderResult.orderId}</p>
          </div>
        )}

        {step === 'browse' && (
          <>
            {cart.length > 0 && (
              <div className={`rounded-xl border p-3 ${card}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Cart ({cart.length})</span>
                  <span className="text-sm font-semibold">TTD {cartTotal.toFixed(2)}</span>
                </div>
                <button
                  onClick={() => setStep('checkout')}
                  className="mt-2 w-full rounded-lg py-2 text-sm font-medium text-white"
                  style={{ backgroundColor: primary }}
                >
                  Checkout
                </button>
              </div>
            )}

            <div className="space-y-2">
              {products.map((p) => (
                <div key={p.id} className={`flex items-center gap-3 rounded-xl border p-3 ${card}`}>
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.name} className="h-12 w-12 rounded-lg object-cover" />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-current opacity-10">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <p className="text-xs opacity-60">TTD {p.price.toFixed(2)}</p>
                  </div>
                  <button
                    onClick={() => addToCart(p)}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-white"
                    style={{ backgroundColor: primary }}
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {step === 'checkout' && (
          <form onSubmit={submitOrder} className="space-y-3">
            <div className={`rounded-xl border p-3 space-y-2 ${card}`}>
              {cart.map((item) => (
                <div key={item.productId} className="flex items-center justify-between text-sm">
                  <span className="truncate">{item.name} × {item.quantity}</span>
                  <span className="font-medium">TTD {(item.price * item.quantity).toFixed(2)}</span>
                </div>
              ))}
              <div className="border-t pt-2 flex items-center justify-between font-semibold">
                <span>Total</span>
                <span>TTD {cartTotal.toFixed(2)}</span>
              </div>
            </div>

            <div className={`rounded-xl border p-3 space-y-3 ${card}`}>
              <label className="block text-xs font-medium opacity-70">Full Name</label>
              <input
                type="text"
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-offset-0 ${input}`}
                style={{ '--tw-ring-color': primary } as React.CSSProperties}
              />
              <label className="block text-xs font-medium opacity-70">Email</label>
              <input
                type="email"
                required
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-offset-0 ${input}`}
                style={{ '--tw-ring-color': primary } as React.CSSProperties}
              />
              <label className="block text-xs font-medium opacity-70">Phone</label>
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-offset-0 ${input}`}
                style={{ '--tw-ring-color': primary } as React.CSSProperties}
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep('browse')}
                className={`flex-1 rounded-lg py-2.5 text-sm font-medium border ${card}`}
              >
                Back
              </button>
              <button
                type="submit"
                className="flex-1 rounded-lg py-2.5 text-sm font-medium text-white"
                style={{ backgroundColor: primary }}
              >
                Pay TTD {cartTotal.toFixed(2)}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
