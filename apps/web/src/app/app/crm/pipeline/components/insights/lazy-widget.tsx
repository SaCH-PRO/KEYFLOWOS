"use client";

import React, { useRef, useState, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";

interface LazyWidgetProps {
  children: React.ReactNode;
  height?: number;
  className?: string;
}

export function LazyWidget({ children, height = 120, className }: LazyWidgetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!visible) {
    return (
      <div ref={ref} className={className} style={{ minHeight: height }}>
        <div className="flex items-center justify-center h-full">
          <Skeleton className="w-full h-full rounded-xl" style={{ minHeight: height }} />
        </div>
      </div>
    );
  }

  return <div ref={ref} className={className}>{children}</div>;
}
