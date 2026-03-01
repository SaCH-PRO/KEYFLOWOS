"use client";

import React, { useRef, useState, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";

interface LazyWidgetProps {
  children: React.ReactNode;
  height?: number;
  className?: string;
}

export function LazyWidget({ children, height = 200, className }: LazyWidgetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!visible) {
    return (
      <div ref={ref} className={className} style={{ minHeight: height }}>
        <div className="space-y-2 p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
    );
  }

  return <div ref={ref} className={className}>{children}</div>;
}
