import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ModelGatewayService } from '../ai/model-gateway.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { KeyCortexVoiceService } from './key-cortex-voice.service';
import Twilio from 'twilio';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CallSession {
  id: string;
  callSid: string;
  businessId: string;
  phoneNumber: string;
  direction: 'outbound' | 'inbound';
  status: CallStatus;
  script?: string;
  transcript: TranscriptEntry[];
  summary?: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
  outcome?: string;
  recordingUrl?: string;
  durationSeconds?: number;
  createdAt: Date;
  endedAt?: Date;
}

export type CallStatus =
  | 'initiating'
  | 'ringing'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'no_answer'
  | 'busy'
  | 'voicemail';

export interface TranscriptEntry {
  speaker: 'key' | 'human';
  text: string;
  timestamp: Date;
  confidence?: number;
}

export interface CallScript {
  purpose: string;
  greeting: string;
  talkingPoints: string[];
  questions: string[];
  closing: string;
  tone: string;
  estimatedDurationMinutes: number;
  businessContext?: Record<string, unknown>;
}

export interface CallHistoryEntry {
  id: string;
  callSid: string;
  phoneNumber: string;
  direction: string;
  status: string;
  transcript: TranscriptEntry[];
  summary?: string;
  sentiment?: string;
  outcome?: string;
  recordingUrl?: string;
  durationSeconds?: number;
  createdAt: Date;
  endedAt?: Date;
}

export interface CallAnalysis {
  sentiment: 'positive' | 'neutral' | 'negative';
  keyPoints: string[];
  actionItems: Array<{
    task: string;
    assignee?: string;
    dueDate?: string;
    priority: 'low' | 'medium' | 'high';
  }>;
  customerSatisfaction: number; // 1-10
  topics: string[];
  objections?: string[];
  nextSteps: string[];
}

export interface FollowUpTask {
  id: string;
  title: string;
  description: string;
  dueDate?: Date;
  priority: 'low' | 'medium' | 'high';
  type: string;
  entityId?: string;
}

// ---------------------------------------------------------------------------
// KeyCortexPhoneService
// ---------------------------------------------------------------------------

/**
 * KeyCortexPhoneService — KEY's voice-call agent.
 *
 * Responsibilities:
 * - Make outbound calls via Twilio with AI-generated scripts
 * - Handle incoming calls with AI-driven conversation
 * - Generate call scripts tailored to purpose and business
 * - Maintain call history with transcripts
 * - Analyse call transcripts for sentiment, action items, and insights
 * - Create follow-up CRM tasks based on call outcomes
 *
 * KEY can now talk to customers, leads, and vendors over the phone
 * using natural, context-aware conversations powered by AI TTS/STT.
 */
@Injectable()
export class KeyCortexPhoneService {
  private readonly logger = new Logger(KeyCortexPhoneService.name);
  private readonly twilio: Twilio.Twilio | null = null;
  private readonly twilioPhoneNumber: string | null = null;
  private readonly webhookBaseUrl: string;

  // In-memory call state (use Redis in production for multi-instance)
  private readonly activeCalls = new Map<string, CallSession>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ModelGatewayService,
    private readonly aiUsage: AiUsageService,
    private readonly voiceService: KeyCortexVoiceService,
  ) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    this.twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER ?? null;
    this.webhookBaseUrl =
      process.env.TWILIO_WEBHOOK_BASE_URL ?? process.env.APP_URL ?? '';

    if (accountSid && authToken) {
      this.twilio = Twilio(accountSid, authToken);
      this.logger.log('Twilio client initialized');
    } else {
      this.logger.warn(
        'TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set. Phone calls will be unavailable.',
      );
    }
  }

  // ========================================================================
  // 1. Outbound Calls
  // ========================================================================

  /**
   * Initiate an outbound phone call via Twilio.
   * Connects to a Twilio stream for real-time audio and uses
   * AI voice (TTS) for speaking and Whisper (STT) for transcription.
   *
   * @param phoneNumber   The destination phone number (E.164 format)
   * @param script        The call script or instructions for KEY
   * @param businessId    Tenant-scoped business identifier
   * @returns             The call session object
   * @throws ServiceUnavailableException if Twilio is not configured
   */
  async makeCall(
    phoneNumber: string,
    script: string,
    businessId: string,
  ): Promise<CallSession> {
    if (!this.twilio || !this.twilioPhoneNumber) {
      throw new ServiceUnavailableException(
        'Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.',
      );
    }

    this.logger.log(
      `Initiating outbound call to ${phoneNumber} for business=${businessId}`,
    );

    // Create the call session record in Prisma
    const sessionRecord = await this.prisma.client.keyCallSession.create({
      data: {
        businessId,
        phoneNumber,
        direction: 'outbound',
        status: 'initiating',
        script,
        transcript: '[]',
      },
    });

    // Build the TwiML response URL that will handle the call stream
    const statusCallbackUrl = `${this.webhookBaseUrl}/api/v1/cortex/phone/callback`;

    try {
      // Initiate the call via Twilio
      const call = await this.twilio.calls.create({
        to: phoneNumber,
        from: this.twilioPhoneNumber,
        twiml: this.buildOutboundTwiml(sessionRecord.id, script),
        statusCallback: statusCallbackUrl,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
        record: true,
        recordingStatusCallback: `${this.webhookBaseUrl}/api/v1/cortex/phone/recording-callback`,
        recordingStatusCallbackMethod: 'POST',
      });

      // Update the session with the Twilio Call SID
      await this.prisma.client.keyCallSession.update({
        where: { id: sessionRecord.id },
        data: {
          callSid: call.sid,
          status: 'ringing',
        },
      });

      const session: CallSession = {
        id: sessionRecord.id,
        callSid: call.sid,
        businessId,
        phoneNumber,
        direction: 'outbound',
        status: 'ringing',
        script,
        transcript: [],
        createdAt: new Date(),
      };

      this.activeCalls.set(call.sid, session);

      this.logger.log(
        `Outbound call initiated: callSid=${call.sid}, to=${phoneNumber}`,
      );

      return session;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown Twilio error';
      this.logger.error(`Failed to initiate outbound call: ${message}`);

      // Update the session as failed
      await this.prisma.client.keyCallSession.update({
        where: { id: sessionRecord.id },
        data: { status: 'failed', endedAt: new Date() },
      });

      throw new ServiceUnavailableException(`Call initiation failed: ${message}`);
    }
  }

  // ========================================================================
  // 2. Incoming Calls
  // ========================================================================

  /**
   * Handle an incoming Twilio call.
   * Greet the caller based on business settings and use AI to
   * conduct a natural conversation — answering questions, taking
   * messages, or scheduling callbacks.
   *
   * @param callSid   Twilio Call SID
   * @param from      Caller phone number
   * @param to        Called number (Twilio number)
   * @returns         TwiML response string for Twilio
   */
  async handleIncomingCall(
    callSid: string,
    from: string,
    to: string,
  ): Promise<string> {
    this.logger.log(`Incoming call: callSid=${callSid}, from=${from}, to=${to}`);

    // Resolve the business from the called number
    const business = await this.prisma.client.business.findFirst({
      where: { phoneNumber: to },
      select: { id: true, name: true },
    });

    const businessId = business?.id ?? 'unknown';
    const businessName = business?.name ?? 'our business';

    // Create a session record
    const sessionRecord = await this.prisma.client.keyCallSession.create({
      data: {
        businessId,
        phoneNumber: from,
        direction: 'inbound',
        status: 'in_progress',
        callSid,
        transcript: '[]',
      },
    });

    // Generate the AI greeting based on business settings
    const greeting = await this.generateIncomingGreeting(businessName, businessId);

    // Synthesize the greeting audio
    const audioBuffer = await this.voiceService.synthesize(
      { text: greeting, persona: 'jarvis', format: 'mp3' },
      businessId,
    );

    // Store audio temporarily and get URL
    const audioUrl = await this.storeCallAudio(audioBuffer, sessionRecord.id, 'greeting');

    // Build the session object
    const session: CallSession = {
      id: sessionRecord.id,
      callSid,
      businessId,
      phoneNumber: from,
      direction: 'inbound',
      status: 'in_progress',
      transcript: [
        {
          speaker: 'key',
          text: greeting,
          timestamp: new Date(),
        },
      ],
      createdAt: new Date(),
    };

    this.activeCalls.set(callSid, session);

    // Build TwiML: play greeting then connect to stream for real-time conversation
    const twiml = new Twilio.twiml.VoiceResponse();
    twiml.play(audioUrl);

    // Connect to a Media Stream for real-time bi-directional audio
    const connect = twiml.connect();
    connect.stream({
      url: `${this.webhookBaseUrl}/api/v1/cortex/phone/stream`,
      track: 'both_tracks',
    });

    this.logger.debug(`Incoming call TwiML generated for callSid=${callSid}`);

    return twiml.toString();
  }

  // ========================================================================
  // 3. Call Script Generation
  // ========================================================================

  /**
   * Use AI to generate a call script based on the purpose and
   * business context. Adapts tone and structure for different
   * scenarios: payment collection, lead follow-up, appointment
   * confirmation, etc.
   *
   * @param purpose     The purpose of the call (e.g., "Collect overdue payment")
   * @param businessId  Tenant-scoped business identifier
   * @param context     Additional context for script personalisation
   * @returns           A structured call script
   */
  async generateCallScript(
    purpose: string,
    businessId: string,
    context?: Record<string, unknown>,
  ): Promise<CallScript> {
    this.logger.debug(`Generating call script: purpose="${purpose}", business=${businessId}`);

    // Fetch business details for personalisation
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { name: true, industry: true, phoneNumber: true },
    });

    const response = await this.gateway.complete({
      businessId,
      taskCategory: 'content-generation',
      messages: [
        {
          role: 'system',
          content: `You are a professional call-script writer for an AI phone agent named KEY. Generate structured, natural-sounding call scripts.

Respond ONLY with valid JSON in this exact shape:
{
  "purpose": "script purpose",
  "greeting": "The opening line (15 words max)",
  "talkingPoints": ["point 1", "point 2", "point 3"],
  "questions": ["question 1", "question 2"],
  "closing": "The closing line",
  "tone": "e.g., polite-but-firm, consultative, friendly, professional",
  "estimatedDurationMinutes": number
}`,
        },
        {
          role: 'user',
          content: `Business: ${business?.name ?? 'Unknown'} (${business?.industry ?? 'general'})
Purpose: ${purpose}
${context ? `Additional context: ${JSON.stringify(context)}` : ''}

Generate a call script for this purpose.`,
        },
      ],
      maxTokens: 800,
      temperature: 0.6,
    });

    const scriptData = this.safeParseJson<{
      purpose?: string;
      greeting?: string;
      talkingPoints?: string[];
      questions?: string[];
      closing?: string;
      tone?: string;
      estimatedDurationMinutes?: number;
    }>(response.content ?? '{}');

    const script: CallScript = {
      purpose,
      greeting:
        scriptData.greeting ??
        `Hello, this is KEY calling on behalf of ${business?.name ?? 'our business'}.`,
      talkingPoints: scriptData.talkingPoints ?? ['Introduce yourself', 'State the purpose'],
      questions: scriptData.questions ?? ['Is now a good time to talk?'],
      closing:
        scriptData.closing ??
        `Thank you for your time. Have a great day!`,
      tone: scriptData.tone ?? 'professional',
      estimatedDurationMinutes: scriptData.estimatedDurationMinutes ?? 3,
      businessContext: {
        businessName: business?.name,
        industry: business?.industry,
        ...context,
      },
    };

    this.logger.debug(`Call script generated: ${script.talkingPoints.length} talking points`);

    return script;
  }

  // ========================================================================
  // 4. Call History
  // ========================================================================

  /**
   * Query call logs for a business with optional limit.
   *
   * @param businessId  Tenant-scoped business identifier
   * @param limit       Maximum number of calls to return (default: 50)
   * @returns           Array of call history entries
   */
  async getCallHistory(
    businessId: string,
    limit = 50,
  ): Promise<CallHistoryEntry[]> {
    this.logger.debug(`Fetching call history: business=${businessId}, limit=${limit}`);

    const sessions = await this.prisma.client.keyCallSession.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return sessions.map((s) => ({
      id: s.id,
      callSid: s.callSid,
      phoneNumber: s.phoneNumber,
      direction: s.direction,
      status: s.status,
      transcript: this.safeParseJson<TranscriptEntry[]>(s.transcript),
      summary: s.summary ?? undefined,
      sentiment: s.sentiment ?? undefined,
      outcome: s.outcome ?? undefined,
      recordingUrl: s.recordingUrl ?? undefined,
      durationSeconds: s.durationSeconds ?? undefined,
      createdAt: s.createdAt,
      endedAt: s.endedAt ?? undefined,
    }));
  }

  // ========================================================================
  // 5. Call Transcript Analysis
  // ========================================================================

  /**
   * Use AI to analyse a call transcript and extract insights:
   * sentiment, key points, action items, customer satisfaction.
   *
   * @param transcript  Array of transcript entries
   * @param businessId  Tenant-scoped business identifier
   * @returns           Structured call analysis
   */
  async analyzeCallTranscript(
    transcript: TranscriptEntry[],
    businessId: string,
  ): Promise<CallAnalysis> {
    this.logger.debug(`Analysing call transcript: ${transcript.length} entries`);

    if (transcript.length === 0) {
      return {
        sentiment: 'neutral',
        keyPoints: [],
        actionItems: [],
        customerSatisfaction: 5,
        topics: [],
        nextSteps: [],
      };
    }

    const transcriptText = transcript
      .map((t) => `${t.speaker === 'key' ? 'KEY' : 'Customer'}: ${t.text}`)
      .join('\n');

    const response = await this.gateway.complete({
      businessId,
      taskCategory: 'analysis',
      messages: [
        {
          role: 'system',
          content: `Analyse the following phone call transcript and extract insights.

Respond ONLY with valid JSON in this exact shape:
{
  "sentiment": "positive" | "neutral" | "negative",
  "keyPoints": ["key point 1", "key point 2"],
  "actionItems": [
    { "task": "task description", "assignee": "who should do it", "dueDate": "YYYY-MM-DD or null", "priority": "low" | "medium" | "high" }
  ],
  "customerSatisfaction": 1-10,
  "topics": ["topic 1", "topic 2"],
  "objections": ["objection 1" or empty],
  "nextSteps": ["next step 1", "next step 2"]
}`,
        },
        { role: 'user', content: transcriptText },
      ],
      maxTokens: 800,
      temperature: 0.3,
    });

    const analysis = this.safeParseJson<{
      sentiment?: string;
      keyPoints?: string[];
      actionItems?: Array<{
        task: string;
        assignee?: string;
        dueDate?: string;
        priority?: string;
      }>;
      customerSatisfaction?: number;
      topics?: string[];
      objections?: string[];
      nextSteps?: string[];
    }>(response.content ?? '{}');

    const validSentiments = ['positive', 'neutral', 'negative'] as const;
    const sentiment = validSentiments.includes(
      analysis.sentiment as (typeof validSentiments)[number],
    )
      ? (analysis.sentiment as (typeof validSentiments)[number])
      : 'neutral';

    const result: CallAnalysis = {
      sentiment,
      keyPoints: analysis.keyPoints ?? [],
      actionItems: (analysis.actionItems ?? []).map((item) => ({
        task: item.task,
        assignee: item.assignee,
        dueDate: item.dueDate,
        priority: (item.priority as 'low' | 'medium' | 'high') ?? 'medium',
      })),
      customerSatisfaction: Math.max(1, Math.min(10, analysis.customerSatisfaction ?? 5)),
      topics: analysis.topics ?? [],
      objections: analysis.objections,
      nextSteps: analysis.nextSteps ?? [],
    };

    this.logger.debug(
      `Transcript analysis: sentiment=${result.sentiment}, satisfaction=${result.customerSatisfaction}/10, ${result.actionItems.length} action items`,
    );

    return result;
  }

  // ========================================================================
  // 6. Follow-Up Task Creation
  // ========================================================================

  /**
   * Based on a call outcome and analysis, create follow-up tasks
   * in the CRM (e.g., "Customer wants callback tomorrow").
   *
   * @param callResult  The call session with analysis
   * @param businessId  Tenant-scoped business identifier
   * @returns           Array of created follow-up tasks
   */
  async createFollowUpTasks(
    callResult: {
      id: string;
      phoneNumber: string;
      transcript: TranscriptEntry[];
      analysis?: CallAnalysis;
      outcome?: string;
    },
    businessId: string,
  ): Promise<FollowUpTask[]> {
    this.logger.debug(
      `Creating follow-up tasks for call=${callResult.id}, business=${businessId}`,
    );

    const tasks: FollowUpTask[] = [];

    // If we have an analysis with action items, create tasks from them
    if (callResult.analysis?.actionItems) {
      for (const item of callResult.analysis.actionItems) {
        const taskRecord = await this.prisma.client.task.create({
          data: {
            businessId,
            title: `[Follow-up] ${item.task}`,
            description: `Created from phone call with ${callResult.phoneNumber}.\n\nTranscript excerpt: ${this.extractRelevantTranscript(callResult.transcript, item.task)}`,
            priority: item.priority.toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH',
            status: 'TODO',
            dueDate: item.dueDate ? new Date(item.dueDate) : this.defaultDueDate(),
            source: 'phone_call',
            metadata: JSON.stringify({
              callId: callResult.id,
              phoneNumber: callResult.phoneNumber,
              assignee: item.assignee,
            }),
          },
        });

        tasks.push({
          id: taskRecord.id,
          title: taskRecord.title,
          description: taskRecord.description,
          dueDate: taskRecord.dueDate ?? undefined,
          priority: item.priority as 'low' | 'medium' | 'high',
          type: 'follow_up',
          entityId: taskRecord.id,
        });
      }
    }

    // If the call outcome indicates a callback is needed, create one
    if (callResult.outcome?.toLowerCase().includes('callback')) {
      const callbackTask = await this.prisma.client.task.create({
        data: {
          businessId,
          title: `[Callback] ${callResult.phoneNumber}`,
          description: `Customer requested a callback. Phone: ${callResult.phoneNumber}\n\nCall ID: ${callResult.id}`,
          priority: 'HIGH',
          status: 'TODO',
          dueDate: this.tomorrow(),
          source: 'phone_call',
          metadata: JSON.stringify({
            callId: callResult.id,
            phoneNumber: callResult.phoneNumber,
            type: 'callback',
          }),
        },
      });

      tasks.push({
        id: callbackTask.id,
        title: callbackTask.title,
        description: callbackTask.description,
        dueDate: callbackTask.dueDate ?? undefined,
        priority: 'high',
        type: 'callback',
        entityId: callbackTask.id,
      });
    }

    // If sentiment is negative, create an escalation task
    if (callResult.analysis?.sentiment === 'negative') {
      const escalationTask = await this.prisma.client.task.create({
        data: {
          businessId,
          title: `[Escalation] Negative call with ${callResult.phoneNumber}`,
          description: `A negative-sentiment call was detected. Review the transcript and follow up.\n\nSatisfaction: ${callResult.analysis.customerSatisfaction}/10\nCall ID: ${callResult.id}`,
          priority: 'HIGH',
          status: 'TODO',
          dueDate: new Date(),
          source: 'phone_call',
          metadata: JSON.stringify({
            callId: callResult.id,
            phoneNumber: callResult.phoneNumber,
            sentiment: callResult.analysis.sentiment,
            satisfaction: callResult.analysis.customerSatisfaction,
            type: 'escalation',
          }),
        },
      });

      tasks.push({
        id: escalationTask.id,
        title: escalationTask.title,
        description: escalationTask.description,
        priority: 'high',
        type: 'escalation',
        entityId: escalationTask.id,
      });
    }

    this.logger.log(
      `Created ${tasks.length} follow-up tasks for call=${callResult.id}`,
    );

    return tasks;
  }

  // ========================================================================
  // Webhook Handlers
  // ========================================================================

  /**
   * Handle Twilio status callback for a call.
   * Updates the call session status in the database.
   *
   * @param callSid   Twilio Call SID
   * @param status    New call status from Twilio
   */
  async handleStatusCallback(callSid: string, status: string): Promise<void> {
    this.logger.debug(`Status callback: callSid=${callSid}, status=${status}`);

    const mappedStatus = this.mapTwilioStatus(status);

    // Update in-memory state
    const session = this.activeCalls.get(callSid);
    if (session) {
      session.status = mappedStatus;
    }

    // Update Prisma
    await this.prisma.client.keyCallSession.updateMany({
      where: { callSid },
      data: {
        status: mappedStatus,
        ...(mappedStatus === 'completed' || mappedStatus === 'failed' || mappedStatus === 'no_answer'
          ? { endedAt: new Date() }
          : {}),
      },
    });
  }

  /**
   * Handle recording callback from Twilio.
   * Stores the recording URL in the call session.
   *
   * @param callSid      Twilio Call SID
   * @param recordingUrl URL of the recorded call
   */
  async handleRecordingCallback(
    callSid: string,
    recordingUrl: string,
  ): Promise<void> {
    this.logger.debug(`Recording callback: callSid=${callSid}`);

    await this.prisma.client.keyCallSession.updateMany({
      where: { callSid },
      data: { recordingUrl },
    });

    const session = this.activeCalls.get(callSid);
    if (session) {
      session.recordingUrl = recordingUrl;
    }
  }

  /**
   * Handle real-time audio stream messages from Twilio.
   * Processes incoming audio (STT), generates AI response, and
   * synthesises outgoing audio (TTS).
   *
   * @param callSid  Twilio Call SID
   * @param audioData Base64-encoded audio chunk from Twilio
   * @returns        Base64-encoded audio response
   */
  async handleStreamMessage(
    callSid: string,
    audioData: string,
  ): Promise<string | null> {
    const session = this.activeCalls.get(callSid);
    if (!session) {
      this.logger.warn(`No active session for callSid=${callSid}`);
      return null;
    }

    try {
      // Decode incoming audio
      const audioBuffer = Buffer.from(audioData, 'base64');

      // Transcribe using Whisper STT
      const transcribedText = await this.voiceService.transcribe(
        {
          audioBuffer,
          mimeType: 'audio/mulaw',
        },
        session.businessId,
      );

      if (!transcribedText || transcribedText.trim().length === 0) {
        return null;
      }

      // Add to transcript
      const humanEntry: TranscriptEntry = {
        speaker: 'human',
        text: transcribedText,
        timestamp: new Date(),
      };
      session.transcript.push(humanEntry);

      // Generate AI response based on conversation context
      const aiResponse = await this.generateCallResponse(session);

      // Add AI response to transcript
      const keyEntry: TranscriptEntry = {
        speaker: 'key',
        text: aiResponse,
        timestamp: new Date(),
      };
      session.transcript.push(keyEntry);

      // Synthesize response to audio
      const responseAudio = await this.voiceService.synthesize(
        { text: aiResponse, persona: 'jarvis', format: 'mp3' },
        session.businessId,
      );

      // Persist transcript
      await this.persistTranscript(session);

      return responseAudio.toString('base64');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Stream processing error';
      this.logger.error(`Stream message handling failed: ${message}`);
      return null;
    }
  }

  /**
   * Finalise a call session when the call ends.
   * Runs transcript analysis and creates follow-up tasks.
   *
   * @param callSid  Twilio Call SID
   */
  async finalizeCall(callSid: string): Promise<void> {
    const session = this.activeCalls.get(callSid);
    if (!session) return;

    this.logger.log(`Finalizing call: callSid=${callSid}`);

    session.status = 'completed';
    session.endedAt = new Date();

    // Calculate duration
    if (session.createdAt) {
      session.durationSeconds = Math.round(
        (Date.now() - session.createdAt.getTime()) / 1000,
      );
    }

    // Analyse transcript if we have one
    if (session.transcript.length > 0) {
      try {
        const analysis = await this.analyzeCallTranscript(
          session.transcript,
          session.businessId,
        );
        session.sentiment = analysis.sentiment;
        session.summary = analysis.keyPoints.join('; ');
        session.outcome = analysis.nextSteps.join('; ');

        // Create follow-up tasks
        await this.createFollowUpTasks(
          {
            id: session.id,
            phoneNumber: session.phoneNumber,
            transcript: session.transcript,
            analysis,
            outcome: session.outcome,
          },
          session.businessId,
        );
      } catch (err) {
        this.logger.warn(`Call analysis failed: ${(err as Error).message}`);
      }
    }

    // Persist final state
    await this.prisma.client.keyCallSession.update({
      where: { id: session.id },
      data: {
        status: session.status,
        transcript: JSON.stringify(session.transcript),
        summary: session.summary,
        sentiment: session.sentiment,
        outcome: session.outcome,
        durationSeconds: session.durationSeconds,
        endedAt: session.endedAt,
      },
    });

    // Clean up in-memory state
    this.activeCalls.delete(callSid);

    this.logger.log(
      `Call finalized: callSid=${callSid}, duration=${session.durationSeconds}s, sentiment=${session.sentiment}`,
    );
  }

  // ========================================================================
  // Private Helpers
  // ========================================================================

  /**
   * Build TwiML for an outbound call.
   */
  private buildOutboundTwiml(sessionId: string, _script: string): string {
    const twiml = new Twilio.twiml.VoiceResponse();

    // Connect to the media stream for real-time audio
    const connect = twiml.connect();
    connect.stream({
      url: `${this.webhookBaseUrl}/api/v1/cortex/phone/stream`,
      track: 'both_tracks',
    });

    // Fallback: say something if the stream fails
    twiml.say(
      { voice: 'Polly.Joanna' },
      'Hello, this is KEY calling. Let me connect you.',
    );

    return twiml.toString();
  }

  /**
   * Generate an AI greeting for incoming calls based on business settings.
   */
  private async generateIncomingGreeting(
    businessName: string,
    businessId: string,
  ): Promise<string> {
    // Check if business has a custom greeting configured
    const customGreeting = await this.prisma.client.aiMemory.findUnique({
      where: {
        businessId_category_key: {
          businessId,
          category: 'phone_settings',
          key: 'incoming_greeting',
        },
      },
    });

    if (customGreeting?.value) {
      return customGreeting.value;
    }

    // Generate a default greeting
    return `Thank you for calling ${businessName}. This is KEY, your AI assistant. How can I help you today?`;
  }

  /**
   * Generate an AI response during an active call based on conversation history.
   */
  private async generateCallResponse(session: CallSession): Promise<string> {
    // Build conversation context
    const recentEntries = session.transcript.slice(-10);
    const conversationHistory = recentEntries
      .map((t) => `${t.speaker === 'key' ? 'KEY' : 'Customer'}: ${t.text}`)
      .join('\n');

    const isInbound = session.direction === 'inbound';

    const response = await this.gateway.complete({
      businessId: session.businessId,
      taskCategory: 'reasoning',
      messages: [
        {
          role: 'system',
          content: `You are KEY, an AI phone assistant for a business. You are on an active phone call.

Guidelines:
- Keep responses concise (2-3 sentences max)
- Be natural, warm, and professional
- Ask clarifying questions when needed
- For inbound calls: answer questions, take messages, schedule callbacks
- For outbound calls: follow the script and be respectful of time
- If the customer wants to end the call, wrap up politely
- Never make up facts about the business — offer to find out and call back

${session.script ? `Script/context: ${session.script}` : ''}`,
        },
        { role: 'user', content: conversationHistory },
      ],
      maxTokens: 200,
      temperature: 0.7,
    });

    return (
      response.content?.trim() ??
      (isInbound
        ? 'I understand. Let me help you with that.'
        : 'Thank you for your time.')
    );
  }

  /**
   * Persist the current transcript to Prisma.
   */
  private async persistTranscript(session: CallSession): Promise<void> {
    await this.prisma.client.keyCallSession.update({
      where: { id: session.id },
      data: {
        transcript: JSON.stringify(session.transcript),
      },
    });
  }

  /**
   * Store call audio temporarily and return a URL.
   */
  private async storeCallAudio(
    audioBuffer: Buffer,
    sessionId: string,
    label: string,
  ): Promise<string> {
    // In production, upload to S3/CloudFront
    // For now, store in a temporary location
    this.logger.debug(
      `Audio storage placeholder: ${audioBuffer.length} bytes for session=${sessionId}, label=${label}`,
    );
    return `/api/v1/cortex/phone/audio/${sessionId}/${label}.mp3`;
  }

  /**
   * Map Twilio call status to our internal status.
   */
  private mapTwilioStatus(twilioStatus: string): CallStatus {
    const statusMap: Record<string, CallStatus> = {
      queued: 'initiating',
      ringing: 'ringing',
      'in-progress': 'in_progress',
      completed: 'completed',
      busy: 'busy',
      failed: 'failed',
      'no-answer': 'no_answer',
      canceled: 'failed',
    };
    return statusMap[twilioStatus.toLowerCase()] ?? 'in_progress';
  }

  /**
   * Extract the most relevant part of the transcript for a task.
   */
  private extractRelevantTranscript(
    transcript: TranscriptEntry[],
    _taskDescription: string,
  ): string {
    // Get the last few entries as the most relevant context
    return transcript
      .slice(-5)
      .map((t) => `${t.speaker === 'key' ? 'KEY' : 'Cust'}: ${t.text}`)
      .join('\n');
  }

  /**
   * Get tomorrow's date.
   */
  private tomorrow(): Date {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }

  /**
   * Get default due date (next business day).
   */
  private defaultDueDate(): Date {
    return this.tomorrow();
  }

  /**
   * Safely parse JSON with a fallback value.
   */
  private safeParseJson<T>(json: string): T {
    try {
      return JSON.parse(json) as T;
    } catch {
      return {} as T;
    }
  }
}
