"use client";

/**
 * Tracks whether the user is in a hands-free voice conversation with KEY.
 * Started when a message is sent by voice; the TTS-finished hook in KeyAgent
 * re-opens the mic while this is active. Stopped by mute, closing the chat,
 * Escape, or a no-speech timeout.
 */
let active = false;

export const VoiceConversation = {
  isActive: () => active,
  start: () => {
    active = true;
  },
  stop: () => {
    active = false;
  },
};
