export interface VoiceInfo {
  key: string;
  name: string;
  language?: string;
  gender?: string;
}

export interface VoiceSynthesisRequest {
  text: string;
  voice?: string;
  format?: 'mp3' | 'opus' | 'aac' | 'flac';
  speed?: number;
}

export interface VoiceProvider {
  readonly name: string;
  readonly displayName: string;
  readonly defaultVoice: string;
  readonly voices: VoiceInfo[];
  synthesize(businessId: string, text: string, voice?: string, opts?: { format?: string }): Promise<Buffer>;
}
