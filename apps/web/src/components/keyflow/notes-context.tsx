"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { getStoredBusinessId } from "@/lib/workspace";
import { resolvePageNoteByPath, type PageNote } from "@/lib/notes-catalog";

export type NotesScope =
  | { kind: "page"; pageKey: string }
  | { kind: "contact"; id: string; label: string }
  | { kind: "project"; id: string; label: string }
  | { kind: "business"; id: string; label: string };

export type NotesTabKey = "page" | "contact" | "project" | "business";

export interface OpenNotesOptions {
  scope?: NotesScope;
  tab?: NotesTabKey;
  pageKey?: string;
  /** Anchor to a specific section of the page note: "briefing" | "walkthrough" | "terms". */
  section?: "briefing" | "walkthrough" | "terms";
}

interface NotesContextValue {
  open: boolean;
  scope: NotesScope | null;
  activeTab: NotesTabKey;
  section: OpenNotesOptions["section"] | null;
  pageNote: PageNote | undefined;
  registerPage: (pageKey: string) => void;
  unregisterPage: (pageKey: string) => void;
  openNotes: (opts?: OpenNotesOptions) => void;
  closeNotes: () => void;
  setActiveTab: (t: NotesTabKey) => void;
  registerContact: (c: { id: string; label: string } | null) => void;
  registerProject: (p: { id: string; label: string } | null) => void;
  businessId: string | null;
  businessLabel: string | null;
}

const Ctx = createContext<NotesContextValue | null>(null);

const NOTES_OPEN_EVENT = "kf-notes-open";
const NOTES_CLOSE_EVENT = "kf-notes-close";

export function dispatchOpenNotes(opts?: OpenNotesOptions) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<OpenNotesOptions>(NOTES_OPEN_EVENT, { detail: opts }));
}

export function dispatchCloseNotes() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(NOTES_CLOSE_EVENT));
}

export function NotesProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<NotesScope | null>(null);
  const [activeTab, setActiveTab] = useState<NotesTabKey>("page");
  const [section, setSection] = useState<OpenNotesOptions["section"] | null>(null);
  const [registeredPage, setRegisteredPage] = useState<string | null>(null);
  const [contact, setContact] = useState<{ id: string; label: string } | null>(null);
  const [project, setProject] = useState<{ id: string; label: string } | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const stack = useRef<string[]>([]);

  useEffect(() => {
    const bid = getStoredBusinessId();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs businessId from storage on path changes
    if (bid) setBusinessId(bid);
  }, [pathname]);

  const pageNote = useMemo(() => {
    if (registeredPage) return resolvePageNoteByPath(`/app/${registeredPage}`) ?? undefined;
    return resolvePageNoteByPath(pathname);
  }, [pathname, registeredPage]);

  const registerPage = useCallback((pageKey: string) => {
    if (!stack.current.includes(pageKey)) stack.current.push(pageKey);
    setRegisteredPage(pageKey);
  }, []);

  const unregisterPage = useCallback((pageKey: string) => {
    stack.current = stack.current.filter((p) => p !== pageKey);
    setRegisteredPage(stack.current[stack.current.length - 1] ?? null);
  }, []);

  const registerContact = useCallback(
    (c: { id: string; label: string } | null) => setContact(c),
    [],
  );
  const registerProject = useCallback(
    (p: { id: string; label: string } | null) => setProject(p),
    [],
  );

  const openNotes = useCallback(
    (opts?: OpenNotesOptions) => {
      const nextScope: NotesScope | null = (() => {
        if (opts?.scope) return opts.scope;
        if (opts?.pageKey) return { kind: "page", pageKey: opts.pageKey };
        const fallback = registeredPage ?? pageNote?.key;
        if (fallback) return { kind: "page", pageKey: fallback };
        return null;
      })();
      setScope(nextScope);
      setActiveTab(opts?.tab ?? (nextScope?.kind ?? "page") as NotesTabKey);
      setSection(opts?.section ?? null);
      setOpen(true);
    },
    [pageNote?.key, registeredPage],
  );

  const closeNotes = useCallback(() => {
    setOpen(false);
    setSection(null);
  }, []);

  // Wire up window-level events so anywhere in the app can trigger.
  useEffect(() => {
    const onOpen = (e: Event) => openNotes((e as CustomEvent<OpenNotesOptions>).detail ?? undefined);
    const onClose = () => closeNotes();
    window.addEventListener(NOTES_OPEN_EVENT, onOpen);
    window.addEventListener(NOTES_CLOSE_EVENT, onClose);
    return () => {
      window.removeEventListener(NOTES_OPEN_EVENT, onOpen);
      window.removeEventListener(NOTES_CLOSE_EVENT, onClose);
    };
  }, [openNotes, closeNotes]);

  // Global "?" keyboard shortcut.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "?" && !(e.key === "/" && e.shiftKey)) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      openNotes();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openNotes]);

  const value = useMemo<NotesContextValue>(
    () => ({
      open,
      scope,
      activeTab,
      section,
      pageNote,
      registerPage,
      unregisterPage,
      openNotes,
      closeNotes,
      setActiveTab,
      registerContact,
      registerProject,
      businessId,
      businessLabel: null,
    }),
    [
      open,
      scope,
      activeTab,
      section,
      pageNote,
      registerPage,
      unregisterPage,
      openNotes,
      closeNotes,
      registerContact,
      registerProject,
      businessId,
    ],
  );

  // Expose contact/project to scope when present.
  useEffect(() => {
    if (!open) return;
    // Refresh scope when context entities change while drawer is open.
    if (activeTab === "contact" && contact) {
      setScope({ kind: "contact", id: contact.id, label: contact.label });
    } else if (activeTab === "project" && project) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reflects active project registration into scope
      setScope({ kind: "project", id: project.id, label: project.label });
    }
  }, [activeTab, contact, project, open]);

  return <Ctx.Provider value={{ ...value, registerContact, registerProject }}>{children}</Ctx.Provider>;
}

export function useNotes(): NotesContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNotes must be used inside <NotesProvider>");
  return v;
}

/** Lightweight optional accessor for places that may render outside the provider. */
export function useOptionalNotes(): NotesContextValue | null {
  return useContext(Ctx);
}
