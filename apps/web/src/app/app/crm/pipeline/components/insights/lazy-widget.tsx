"use client";

import React from "react";

interface LazyWidgetProps {
  children: React.ReactNode;
  height?: number;
  className?: string;
}

export function LazyWidget({ children, className }: LazyWidgetProps) {
  return <div className={className}>{children}</div>;
}
