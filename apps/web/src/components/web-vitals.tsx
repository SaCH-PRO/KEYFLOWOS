"use client";

import { useEffect } from "react";
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals";
import * as Sentry from "@sentry/nextjs";

function sendToSentry(metric: Metric) {
  Sentry.captureMessage(`Web Vital: ${metric.name}`, {
    level: "info",
    tags: {
      web_vital: metric.name,
    },
    extra: {
      value: metric.value,
      rating: metric.rating,
      delta: metric.delta,
      id: metric.id,
      navigationType: metric.navigationType,
    },
  });
}

export function WebVitals() {
  useEffect(() => {
    onCLS(sendToSentry);
    onFCP(sendToSentry);
    onINP(sendToSentry);
    onLCP(sendToSentry);
    onTTFB(sendToSentry);
  }, []);

  return null;
}
