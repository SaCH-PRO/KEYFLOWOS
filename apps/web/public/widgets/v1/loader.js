/**
 * KeyflowOS Widget Loader v1.0
 *
 * Drop this script on any website to embed KeyflowOS widgets:
 *
 *   <script
 *     src="https://app.keyflowos.com/widgets/v1/loader.js"
 *     data-business="acme-salon"
 *     data-widget="booking"
 *     data-theme="dark"
 *     data-primary-color="#f97316"
 *   ></script>
 *
 * Supported widgets: booking | cart | pay
 *
 * The widget renders inside a shadow-DOM iframe so it cannot conflict
 * with the parent page's CSS or JS.
 */
(function () {
  'use strict';

  const CURRENT_SCRIPT = document.currentScript;
  if (!CURRENT_SCRIPT) {
    console.error('[KeyflowWidget] loader must be loaded via <script src="...">');
    return;
  }

  const BASE_URL = CURRENT_SCRIPT.src.replace(/\/widgets\/v1\/loader\.js$/, '');

  const CONFIG = {
    business: CURRENT_SCRIPT.getAttribute('data-business') || '',
    widget: CURRENT_SCRIPT.getAttribute('data-widget') || 'booking',
    theme: CURRENT_SCRIPT.getAttribute('data-theme') || 'dark',
    primaryColor: CURRENT_SCRIPT.getAttribute('data-primary-color') || '#f97316',
    height: CURRENT_SCRIPT.getAttribute('data-height') || '600',
    width: CURRENT_SCRIPT.getAttribute('data-width') || '100%',
    minWidth: CURRENT_SCRIPT.getAttribute('data-min-width') || '320px',
    maxWidth: CURRENT_SCRIPT.getAttribute('data-max-width') || '480px',
    borderRadius: CURRENT_SCRIPT.getAttribute('data-border-radius') || '16',
    invoiceId: CURRENT_SCRIPT.getAttribute('data-invoice-id') || '',
    productId: CURRENT_SCRIPT.getAttribute('data-product-id') || '',
  };

  if (!CONFIG.business && CONFIG.widget !== 'pay') {
    console.error('[KeyflowWidget] data-business is required');
    return;
  }

  /* ------------------------------------------------------------------ */
  /* Build the iframe src                                               */
  /* ------------------------------------------------------------------ */
  function buildSrc() {
    const params = new URLSearchParams();
    params.set('theme', CONFIG.theme);
    params.set('primary', CONFIG.primaryColor);
    if (CONFIG.productId) params.set('productId', CONFIG.productId);

    switch (CONFIG.widget) {
      case 'booking':
        return `${BASE_URL}/widgets/booking/${encodeURIComponent(CONFIG.business)}?${params.toString()}`;
      case 'cart':
        return `${BASE_URL}/widgets/cart/${encodeURIComponent(CONFIG.business)}?${params.toString()}`;
      case 'pay':
        if (!CONFIG.invoiceId) {
          console.error('[KeyflowWidget] data-invoice-id is required for pay widget');
          return null;
        }
        return `${BASE_URL}/widgets/pay/${encodeURIComponent(CONFIG.invoiceId)}?${params.toString()}`;
      default:
        console.error(`[KeyflowWidget] unknown widget type: ${CONFIG.widget}`);
        return null;
    }
  }

  const SRC = buildSrc();
  if (!SRC) return;

  /* ------------------------------------------------------------------ */
  /* Create container + iframe                                          */
  /* ------------------------------------------------------------------ */
  const containerId = `keyflow-widget-${CONFIG.widget}-${Math.random().toString(36).slice(2, 10)}`;

  const container = document.createElement('div');
  container.id = containerId;
  container.style.width = CONFIG.width;
  container.style.minWidth = CONFIG.minWidth;
  container.style.maxWidth = CONFIG.maxWidth;
  container.style.margin = '0 auto';
  container.style.position = 'relative';

  const iframe = document.createElement('iframe');
  iframe.src = SRC;
  iframe.style.width = '100%';
  iframe.style.height = `${CONFIG.height}px`;
  iframe.style.border = 'none';
  iframe.style.borderRadius = `${CONFIG.borderRadius}px`;
  iframe.style.overflow = 'hidden';
  iframe.style.display = 'block';
  iframe.setAttribute('loading', 'lazy');
  iframe.setAttribute('title', `KeyflowOS ${CONFIG.widget}`);
  iframe.setAttribute('allow', 'payment');

  container.appendChild(iframe);
  CURRENT_SCRIPT.insertAdjacentElement('afterend', container);

  /* ------------------------------------------------------------------ */
  /* postMessage: resize, close, success events                         */
  /* ------------------------------------------------------------------ */
  window.addEventListener('message', (event) => {
    // Only accept messages from our iframe
    if (event.source !== iframe.contentWindow) return;
    if (!event.data || typeof event.data !== 'object') return;

    const { type, height, eventName, payload } = event.data;

    switch (type) {
      case 'KEYFLOW_WIDGET_RESIZE':
        if (typeof height === 'number' && height > 0) {
          iframe.style.height = `${Math.min(height, 1200)}px`;
        }
        break;

      case 'KEYFLOW_WIDGET_EVENT':
        // Bubble widget events to parent page
        window.dispatchEvent(
          new CustomEvent(`keyflow:${eventName}`, {
            detail: { widget: CONFIG.widget, business: CONFIG.business, ...payload },
          }),
        );
        break;
    }
  });

  /* ------------------------------------------------------------------ */
  /* Public API on the container element                                */
  /* ------------------------------------------------------------------ */
  container.keyflowWidget = {
    resize: (h) => {
      iframe.style.height = `${h}px`;
    },
    navigate: (url) => {
      iframe.src = url;
    },
    config: CONFIG,
  };

  console.log(`[KeyflowWidget] ${CONFIG.widget} widget loaded for ${CONFIG.business}`);
})();
