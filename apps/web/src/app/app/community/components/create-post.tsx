"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { POST_TYPE_CONFIG } from "./post-card";

interface CreatePostProps {
  isOpen: boolean;
  title: string;
  content: string;
  postType: string;
  tags: string;
  posting: boolean;
  onTitleChange: (v: string) => void;
  onContentChange: (v: string) => void;
  onTypeChange: (v: string) => void;
  onTagsChange: (v: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export function CreatePost({
  isOpen,
  title,
  content,
  postType,
  tags,
  posting,
  onTitleChange,
  onContentChange,
  onTypeChange,
  onTagsChange,
  onClose,
  onSubmit,
}: CreatePostProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
          <div className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">New Post</h3>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              placeholder="Title (optional)"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              className="w-full bg-transparent border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-white/20"
            />
            <textarea
              placeholder="What's on your mind?"
              value={content}
              onChange={(e) => onContentChange(e.target.value)}
              rows={4}
              className="w-full bg-transparent border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-white/20 resize-none"
            />
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">Type:</span>
                {Object.entries(POST_TYPE_CONFIG).map(([key, config]) => (
                  <button
                    key={key}
                    onClick={() => onTypeChange(key)}
                    className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                      postType === key ? `${config.bg} ${config.color}` : "bg-white/5 text-muted-foreground"
                    }`}
                  >
                    {config.label}
                  </button>
                ))}
              </div>
            </div>
            <input
              placeholder="Tags (comma separated)"
              value={tags}
              onChange={(e) => onTagsChange(e.target.value)}
              className="w-full bg-transparent border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-white/20"
            />
            <div className="flex justify-end">
              <button
                onClick={onSubmit}
                disabled={posting || !content.trim()}
                className="kf-btn-primary px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {posting ? "Posting..." : "Post"}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
