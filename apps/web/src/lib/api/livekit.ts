import { apiGet, apiPost } from "@/lib/api";

export interface KeyVoiceSession {
  token: string;
  wsUrl: string;
  roomName: string;
  sessionId: string;
}

export interface LivekitRoomSummary {
  name: string;
  numParticipants: number;
  creationTime: number;
}

export async function createVoiceSession(
  businessId: string,
): Promise<{ data: KeyVoiceSession | null; error: string | null }> {
  return apiPost<KeyVoiceSession>({
    path: `/livekit/businesses/${encodeURIComponent(businessId)}/voice-session`,
    body: {},
  });
}

export async function endVoiceSession(
  businessId: string,
  sessionId: string,
): Promise<{ data: { ended: boolean } | null; error: string | null }> {
  return apiPost<{ ended: boolean }>({
    path: `/livekit/businesses/${encodeURIComponent(businessId)}/voice-session/${encodeURIComponent(sessionId)}/end`,
    body: {},
  });
}

export async function listVoiceRooms(
  businessId: string,
): Promise<{ data: LivekitRoomSummary[] | null; error: string | null }> {
  return apiGet<LivekitRoomSummary[]>(`/livekit/businesses/${encodeURIComponent(businessId)}/rooms`);
}
