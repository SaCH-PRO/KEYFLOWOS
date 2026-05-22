"use client";

import type { ReactNode } from "react";

const MOTION_PROPS = new Set([
  "initial",
  "animate",
  "exit",
  "transition",
  "variants",
  "whileHover",
  "whileTap",
  "whileFocus",
  "whileInView",
  "viewport",
  "drag",
  "dragConstraints",
  "layout",
  "layoutId",
]);

function stripMotionProps(props: Record<string, unknown>) {
  const result = { ...props };
  for (const key of MOTION_PROPS) {
    delete result[key];
  }
  return result;
}

export const motion = {
  div: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => (
    <div {...stripMotionProps(props)}>{children}</div>
  ),
  form: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => (
    <form {...stripMotionProps(props)}>{children}</form>
  ),
};

export function AnimatePresence({ children }: { children?: ReactNode; mode?: string }) {
  return <>{children}</>;
}
