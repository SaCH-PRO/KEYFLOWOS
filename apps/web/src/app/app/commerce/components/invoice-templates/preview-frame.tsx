"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import { buildPrintHtml } from "./print-document";

interface PreviewFrameProps {
  html: string;
  width: number;
  title?: string;
  className?: string;
}

export function PreviewFrame({ html, width, title = "Preview", className }: PreviewFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(1);
  const [contentHeight, setContentHeight] = useState(800);

  const computeScale = useCallback(() => {
    if (!containerRef.current) return;
    const containerWidth = containerRef.current.clientWidth;
    const newScale = Math.min(1, containerWidth / width);
    setScale(newScale);
  }, [width]);

  useEffect(() => {
    computeScale();
    const observer = new ResizeObserver(computeScale);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [computeScale]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const srcdoc = buildPrintHtml(html, title);
    iframe.srcdoc = srcdoc;

    const onLoad = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;
        const measure = () => {
          const h = doc.documentElement?.scrollHeight || doc.body?.scrollHeight || 800;
          setContentHeight(h);
        };
        measure();
        setTimeout(measure, 200);
        setTimeout(measure, 700);
      } catch {}
    };

    iframe.addEventListener("load", onLoad);
    return () => iframe.removeEventListener("load", onLoad);
  }, [html, title]);

  return (
    <div ref={containerRef} className={className} style={{ width: "100%" }}>
      <div
        style={{
          width: `${width}px`,
          height: `${contentHeight}px`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <iframe
          ref={iframeRef}
          title={title}
          style={{
            width: `${width}px`,
            height: `${contentHeight}px`,
            border: "none",
            display: "block",
            background: "transparent",
          }}
          sandbox="allow-same-origin allow-scripts"
        />
      </div>
      <div style={{ height: `${contentHeight * scale - contentHeight}px` }} />
    </div>
  );
}
