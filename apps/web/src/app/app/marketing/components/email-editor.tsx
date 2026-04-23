"use client";

import React, { useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Link as LinkIcon,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Minus,
  Undo,
  Redo,
  Eye,
  Code,
  FileText,
} from "lucide-react";

interface EmailEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

const STARTER_TEMPLATES: { key: string; label: string; icon: React.ElementType; content: string }[] = [
  {
    key: "newsletter",
    label: "Newsletter",
    icon: FileText,
    content: `<h2>Monthly Newsletter</h2><p>Hi there,</p><p>Here's what's new this month:</p><h3>Highlight #1</h3><p>Share your latest update or achievement here.</p><h3>Highlight #2</h3><p>Another piece of news your audience will love.</p><hr><p>Thanks for reading!</p><p>— Your Team</p>`,
  },
  {
    key: "announcement",
    label: "Announcement",
    icon: FileText,
    content: `<h2>Exciting Announcement!</h2><p>We have some big news to share with you.</p><p><strong>What's happening:</strong> Describe your announcement in detail here.</p><p><strong>When:</strong> Add relevant dates and times.</p><p><strong>What it means for you:</strong> Explain the benefit to your audience.</p><p>Stay tuned for more updates!</p>`,
  },
  {
    key: "promotion",
    label: "Promotion",
    icon: FileText,
    content: `<h2>Special Offer Just For You</h2><p>For a limited time, we're offering an exclusive deal:</p><p><strong>Get 20% off</strong> on all services this month.</p><p>Use code: <strong>SAVE20</strong></p><p>Don't miss out — this offer expires soon!</p><p>Book now or reply to this email to learn more.</p>`,
  },
];

export const EmailEditor = React.memo(function EmailEditor({
  value,
  onChange,
  placeholder = "Write your email content here...",
}: EmailEditorProps) {
  const [showPreview, setShowPreview] = React.useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { style: "color: hsl(35, 100%, 55%); text-decoration: underline;" },
      }),
      Placeholder.configure({ placeholder }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: value || "",
    onUpdate: ({ editor: e }) => {
      onChange(e.getHTML());
    },
    editorProps: {
      attributes: {
        class: "prose prose-invert prose-sm max-w-none min-h-[200px] focus:outline-none px-3 py-2",
      },
    },
  });

  const setLink = useCallback(() => {
    if (!editor) return;
    const previous = editor.getAttributes("link").href;
    const url = window.prompt("Enter URL", previous || "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  }, [editor]);

  const insertTemplate = useCallback((content: string) => {
    if (!editor) return;
    editor.commands.setContent(content);
    onChange(content);
  }, [editor, onChange]);

  if (!editor) return null;

  const ToolButton = ({ active, onClick, children, title }: { active?: boolean; onClick: () => void; children: React.ReactNode; title: string }) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`p-1.5 rounded transition-colors ${
        active
          ? "bg-[hsl(var(--kf-accent1))]/20 text-[hsl(var(--kf-accent1))]"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 mb-1">
        {STARTER_TEMPLATES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => insertTemplate(t.content)}
            className="text-[10px] px-2 py-1 rounded-lg bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="border border-border/40 rounded-lg overflow-hidden bg-muted/30">
        <div className="flex items-center gap-0.5 flex-wrap px-2 py-1.5 border-b border-border/30 bg-muted/20">
          <ToolButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
            <Bold className="w-3.5 h-3.5" />
          </ToolButton>
          <ToolButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
            <Italic className="w-3.5 h-3.5" />
          </ToolButton>
          <ToolButton active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline">
            <UnderlineIcon className="w-3.5 h-3.5" />
          </ToolButton>
          <ToolButton active={editor.isActive("link")} onClick={setLink} title="Link">
            <LinkIcon className="w-3.5 h-3.5" />
          </ToolButton>

          <div className="w-px h-4 bg-border/40 mx-1" />

          <ToolButton active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1">
            <Heading1 className="w-3.5 h-3.5" />
          </ToolButton>
          <ToolButton active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">
            <Heading2 className="w-3.5 h-3.5" />
          </ToolButton>
          <ToolButton active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3">
            <Heading3 className="w-3.5 h-3.5" />
          </ToolButton>

          <div className="w-px h-4 bg-border/40 mx-1" />

          <ToolButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet List">
            <List className="w-3.5 h-3.5" />
          </ToolButton>
          <ToolButton active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Ordered List">
            <ListOrdered className="w-3.5 h-3.5" />
          </ToolButton>

          <div className="w-px h-4 bg-border/40 mx-1" />

          <ToolButton active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} title="Align Left">
            <AlignLeft className="w-3.5 h-3.5" />
          </ToolButton>
          <ToolButton active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} title="Align Center">
            <AlignCenter className="w-3.5 h-3.5" />
          </ToolButton>
          <ToolButton active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} title="Align Right">
            <AlignRight className="w-3.5 h-3.5" />
          </ToolButton>

          <div className="w-px h-4 bg-border/40 mx-1" />

          <ToolButton onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Divider">
            <Minus className="w-3.5 h-3.5" />
          </ToolButton>

          <div className="flex-1" />

          <ToolButton onClick={() => editor.chain().focus().undo().run()} title="Undo">
            <Undo className="w-3.5 h-3.5" />
          </ToolButton>
          <ToolButton onClick={() => editor.chain().focus().redo().run()} title="Redo">
            <Redo className="w-3.5 h-3.5" />
          </ToolButton>

          <div className="w-px h-4 bg-border/40 mx-1" />

          <ToolButton active={showPreview} onClick={() => setShowPreview(!showPreview)} title={showPreview ? "Edit" : "Preview HTML"}>
            {showPreview ? <Code className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </ToolButton>
        </div>

        {showPreview ? (
          <div className="p-4 min-h-[200px] bg-white text-black rounded-b-lg">
            <div dangerouslySetInnerHTML={{ __html: editor.getHTML() }} className="prose prose-sm max-w-none" />
          </div>
        ) : (
          <EditorContent editor={editor} className="text-sm" />
        )}
      </div>
    </div>
  );
});
