import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import { ModelGatewayService } from '../ai/model-gateway.service';
import { AiUsageService } from '../ai/ai-usage.service';
import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DocumentUploadResult {
  documentId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  chunksIndexed: number;
  storageUrl: string;
  status: 'processing' | 'indexed' | 'failed';
  metadata?: Record<string, unknown>;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

export interface QuestionAnswer {
  answer: string;
  citations: Array<{
    documentId: string;
    documentName: string;
    chunkIndex: number;
    text: string;
    pageNumber?: number;
  }>;
  confidence: number;
  processingTimeMs: number;
}

export interface ExtractedData {
  documentId: string;
  extractedAt: Date;
  schema: Record<string, unknown>;
  data: Record<string, unknown>;
  confidence: number;
  rawFields: Array<{
    field: string;
    value: unknown;
    confidence: number;
  }>;
}

export interface DocumentComparison {
  document1: { id: string; name: string };
  document2: { id: string; name: string };
  similarities: string[];
  differences: Array<{
    category: string;
    doc1Value: string;
    doc2Value: string;
  }>;
  summary: string;
  confidence: number;
}

export interface DocumentListEntry {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  chunksIndexed: number;
  status: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// KeyCortexDocumentService
// ---------------------------------------------------------------------------

/**
 * KeyCortexDocumentService — RAG-based document intelligence for KEY.
 *
 * Responsibilities:
 * - Upload and parse documents (PDF, Word, Excel, images, text)
 * - Chunk text into overlapping segments and generate embeddings
 * - Store documents and embeddings in vector database (Redis/pgvector)
 * - Answer questions against single or multiple documents (RAG)
 * - Extract structured data from documents using AI
 * - Compare two documents and highlight similarities/differences
 * - List and delete documents with full cleanup
 *
 * This is KEY's "memory" for documents — it enables intelligent
 * Q&A over any uploaded business document with source citations.
 */
@Injectable()
export class KeyCortexDocumentService {
  private readonly logger = new Logger(KeyCortexDocumentService.name);
  private readonly openai: OpenAI;

  // Chunking configuration
  private readonly CHUNK_SIZE = 800;
  private readonly CHUNK_OVERLAP = 150;
  private readonly EMBEDDING_MODEL = 'text-embedding-3-small';
  private readonly EMBEDDING_DIMENSION = 1536;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly gateway: ModelGatewayService,
    private readonly aiUsage: AiUsageService,
  ) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      this.logger.warn(
        'OPENAI_API_KEY is not set. Document embeddings will be unavailable.',
      );
    }
    this.openai = new OpenAI({ apiKey: apiKey ?? 'sk-no-key' });
  }

  // ========================================================================
  // 1. Document Upload & Indexing
  // ========================================================================

  /**
   * Upload a document, parse it, chunk the text, generate embeddings,
   * and store in the vector database.
   *
   * Supports: PDF, Word (.docx), Excel, images (OCR), and text files.
   *
   * @param file        The uploaded file buffer
   * @param metadata    Additional metadata for the document
   * @param businessId  Tenant-scoped business identifier
   * @returns           Upload result with document ID and indexing status
   */
  async uploadDocument(
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    },
    metadata: Record<string, unknown>,
    businessId: string,
  ): Promise<DocumentUploadResult> {
    this.logger.log(
      `Uploading document: ${file.originalname} (${file.mimetype}, ${file.size} bytes) for business=${businessId}`,
    );

    // Validate file type
    const supportedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/plain',
      'text/csv',
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
    ];

    if (!supportedTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported file type: ${file.mimetype}. Supported: PDF, Word, Excel, PNG, JPEG, TXT, CSV`,
      );
    }

    // Store raw file in S3/cloud storage (simulated with a URL)
    const storageUrl = await this.storeFileInCloud(file, businessId);

    // Create document record
    const docRecord = await this.prisma.client.keyDocument.create({
      data: {
        businessId,
        fileName: file.originalname,
        fileType: file.mimetype,
        fileSize: file.size,
        storageUrl,
        status: 'processing',
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });

    // Parse document to extract text
    let extractedText: string;
    try {
      extractedText = await this.parseDocument(file);
    } catch (err) {
      this.logger.error(`Document parsing failed: ${(err as Error).message}`);
      await this.prisma.client.keyDocument.update({
        where: { id: docRecord.id },
        data: { status: 'failed' },
      });
      throw new BadRequestException(
        `Failed to parse document: ${(err as Error).message}`,
      );
    }

    // Chunk the text
    const chunks = this.chunkText(extractedText, docRecord.id);

    this.logger.debug(
      `Document chunked: ${file.originalname} -> ${chunks.length} chunks`,
    );

    // Generate embeddings for each chunk
    try {
      await this.indexChunks(docRecord.id, chunks, businessId);
    } catch (err) {
      this.logger.error(`Embedding generation failed: ${(err as Error).message}`);
      await this.prisma.client.keyDocument.update({
        where: { id: docRecord.id },
        data: { status: 'failed' },
      });
      throw new BadRequestException(
        `Failed to generate embeddings: ${(err as Error).message}`,
      );
    }

    // Update document status
    await this.prisma.client.keyDocument.update({
      where: { id: docRecord.id },
      data: {
        status: 'indexed',
        chunksIndexed: chunks.length,
      },
    });

    const result: DocumentUploadResult = {
      documentId: docRecord.id,
      fileName: file.originalname,
      fileType: file.mimetype,
      fileSize: file.size,
      chunksIndexed: chunks.length,
      storageUrl,
      status: 'indexed',
      metadata,
    };

    this.logger.log(
      `Document uploaded and indexed: ${docRecord.id} (${chunks.length} chunks)`,
    );

    return result;
  }

  // ========================================================================
  // 2. Ask Question (Single Document RAG)
  // ========================================================================

  /**
   * Ask a question about a specific document and get an AI-generated
   * answer with source citations. Uses vector similarity search to
   * find relevant chunks, then sends context + question to the AI.
   *
   * @param documentId  The document to query
   * @param question    The user's question
   * @param businessId  Tenant-scoped business identifier
   * @returns           Answer with citations from the document
   */
  async askQuestion(
    documentId: string,
    question: string,
    businessId: string,
  ): Promise<QuestionAnswer> {
    const startTime = Date.now();

    this.logger.debug(
      `Question on doc=${documentId}: "${question.substring(0, 100)}"`,
    );

    // Verify document exists and belongs to this business
    const document = await this.prisma.client.keyDocument.findFirst({
      where: { id: documentId, businessId },
    });

    if (!document) {
      throw new NotFoundException(`Document not found: ${documentId}`);
    }

    if (document.status !== 'indexed') {
      throw new BadRequestException(
        `Document is not fully indexed yet (status: ${document.status})`,
      );
    }

    // Generate embedding for the question
    const questionEmbedding = await this.generateEmbedding(question);

    // Search for similar chunks in vector store
    const relevantChunks = await this.vectorSearch(documentId, questionEmbedding, 8);

    if (relevantChunks.length === 0) {
      return {
        answer: 'I could not find relevant information in this document to answer your question.',
        citations: [],
        confidence: 0,
        processingTimeMs: Date.now() - startTime,
      };
    }

    // Build context from relevant chunks
    const context = relevantChunks
      .map((c, idx) => `[Source ${idx + 1}] ${c.text}`)
      .join('\n\n---\n\n');

    // Send to AI with question + context
    const response = await this.gateway.complete({
      businessId,
      taskCategory: 'reasoning',
      messages: [
        {
          role: 'system',
          content: `You are a document intelligence assistant. Answer the user's question based ONLY on the provided document excerpts. Cite your sources using [Source N] format. If the answer is not in the excerpts, say so clearly. Be concise and accurate.`,
        },
        {
          role: 'user',
          content: `Document excerpts:\n\n${context}\n\nQuestion: ${question}\n\nProvide a clear answer with citations.`,
        },
      ],
      maxTokens: 800,
      temperature: 0.3,
    });

    const answer = response.content?.trim() ?? 'No answer generated.';

    // Build citations
    const citations = relevantChunks.map((chunk, idx) => ({
      documentId: chunk.documentId,
      documentName: document.fileName,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text.substring(0, 300),
      pageNumber: chunk.metadata?.pageNumber as number | undefined,
    }));

    const processingTimeMs = Date.now() - startTime;

    // Track AI usage
    await this.aiUsage.trackText({
      businessId,
      type: 'document_qa',
      model: response.provider,
      inputTokens: response.usage.promptTokens,
      outputTokens: response.usage.completionTokens,
      estimatedCost: response.usage.estimatedCost,
    });

    this.logger.debug(
      `Answer generated in ${processingTimeMs}ms, ${citations.length} citations`,
    );

    return {
      answer,
      citations,
      confidence: this.estimateConfidence(answer, relevantChunks.length),
      processingTimeMs,
    };
  }

  // ========================================================================
  // 3. Ask Across Documents (Multi-Document RAG)
  // ========================================================================

  /**
   * Ask a question across ALL documents for a business.
   * Searches all indexed documents and synthesises an answer
   * with citations from multiple sources.
   *
   * @param question    The user's question
   * @param businessId  Tenant-scoped business identifier
   * @returns           Answer with citations from multiple documents
   */
  async askAcrossDocuments(
    question: string,
    businessId: string,
  ): Promise<QuestionAnswer> {
    const startTime = Date.now();

    this.logger.debug(
      `Multi-document question for business=${businessId}: "${question.substring(0, 100)}"`,
    );

    // Get all indexed documents for this business
    const documents = await this.prisma.client.keyDocument.findMany({
      where: { businessId, status: 'indexed' },
    });

    if (documents.length === 0) {
      return {
        answer: 'No indexed documents found for your business. Please upload documents first.',
        citations: [],
        confidence: 0,
        processingTimeMs: Date.now() - startTime,
      };
    }

    // Generate question embedding
    const questionEmbedding = await this.generateEmbedding(question);

    // Search across all documents
    const allChunks: Array<DocumentChunk & { fileName: string }> = [];

    for (const doc of documents) {
      const chunks = await this.vectorSearch(doc.id, questionEmbedding, 3);
      for (const chunk of chunks) {
        allChunks.push({ ...chunk, fileName: doc.fileName });
      }
    }

    // Sort by relevance (simplified: we already got top-N per doc)
    const topChunks = allChunks.slice(0, 10);

    if (topChunks.length === 0) {
      return {
        answer: 'I could not find relevant information across your documents to answer this question.',
        citations: [],
        confidence: 0,
        processingTimeMs: Date.now() - startTime,
      };
    }

    // Build multi-document context
    const context = topChunks
      .map((c, idx) => `[Source ${idx + 1} from ${c.fileName}] ${c.text}`)
      .join('\n\n---\n\n');

    const response = await this.gateway.complete({
      businessId,
      taskCategory: 'reasoning',
      messages: [
        {
          role: 'system',
          content: `You are a document intelligence assistant with access to multiple business documents. Answer the user's question by synthesising information from the provided excerpts across different documents. Cite sources using [Source N from filename] format. If documents contradict, note the discrepancy.`,
        },
        {
          role: 'user',
          content: `Document excerpts from ${documents.length} documents:\n\n${context}\n\nQuestion: ${question}\n\nProvide a comprehensive answer with citations indicating which document each source comes from.`,
        },
      ],
      maxTokens: 1000,
      temperature: 0.3,
    });

    const answer = response.content?.trim() ?? 'No answer generated.';

    // Build citations from multiple documents
    const citations = topChunks.map((chunk, idx) => ({
      documentId: chunk.documentId,
      documentName: chunk.fileName,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text.substring(0, 300),
      pageNumber: chunk.metadata?.pageNumber as number | undefined,
    }));

    const processingTimeMs = Date.now() - startTime;

    this.logger.debug(
      `Multi-doc answer generated in ${processingTimeMs}ms across ${documents.length} documents`,
    );

    return {
      answer,
      citations,
      confidence: this.estimateConfidence(answer, topChunks.length),
      processingTimeMs,
    };
  }

  // ========================================================================
  // 4. Structured Data Extraction
  // ========================================================================

  /**
   * Extract structured data from a document using AI.
   * Example: extract "invoice number, date, amount, vendor" from an invoice.
   *
   * @param documentId       The document to extract from
   * @param extractionSchema The schema defining what fields to extract
   * @param businessId       Tenant-scoped business identifier
   * @returns                Extracted data as JSON with confidence scores
   */
  async extractData(
    documentId: string,
    extractionSchema: Record<string, { type: string; description: string }>,
    businessId: string,
  ): Promise<ExtractedData> {
    this.logger.debug(
      `Extracting data from doc=${documentId}: ${Object.keys(extractionSchema).join(', ')}`,
    );

    // Verify document
    const document = await this.prisma.client.keyDocument.findFirst({
      where: { id: documentId, businessId },
    });

    if (!document) {
      throw new NotFoundException(`Document not found: ${documentId}`);
    }

    // Get all chunks for this document
    const chunks = await this.getDocumentChunks(documentId);
    const fullText = chunks.map((c) => c.text).join('\n');

    // Build the extraction prompt
    const schemaDescription = Object.entries(extractionSchema)
      .map(([field, spec]) => `- ${field}: ${spec.description} (type: ${spec.type})`)
      .join('\n');

    const response = await this.gateway.complete({
      businessId,
      taskCategory: 'extraction',
      messages: [
        {
          role: 'system',
          content: `Extract structured data from the provided document text according to the schema. Respond ONLY with valid JSON.

Schema:
${schemaDescription}

Respond in this exact shape:
{
  "data": { /* extracted fields */ },
  "confidence": 0.0-1.0,
  "rawFields": [
    { "field": "fieldName", "value": "extracted value", "confidence": 0.0-1.0 }
  ]
}`,
        },
        {
          role: 'user',
          content: `Document text:\n\n${fullText.substring(0, 8000)}\n\nExtract the structured data.`,
        },
      ],
      maxTokens: 1200,
      temperature: 0.2,
    });

    const extraction = this.safeParseJson<{
      data?: Record<string, unknown>;
      confidence?: number;
      rawFields?: Array<{ field: string; value: unknown; confidence: number }>;
    }>(response.content ?? '{}');

    const result: ExtractedData = {
      documentId,
      extractedAt: new Date(),
      schema: extractionSchema,
      data: extraction.data ?? {},
      confidence: Math.max(0, Math.min(1, extraction.confidence ?? 0.7)),
      rawFields: extraction.rawFields ?? [],
    };

    // Store extraction result
    await this.prisma.client.aiMemory.upsert({
      where: {
        businessId_category_key: {
          businessId,
          category: 'document_extraction',
          key: documentId,
        },
      },
      create: {
        businessId,
        category: 'document_extraction',
        key: documentId,
        value: JSON.stringify(result),
        source: 'key_document_service',
      },
      update: {
        value: JSON.stringify(result),
        source: 'key_document_service',
      },
    });

    this.logger.debug(
      `Data extracted from ${documentId}: ${Object.keys(result.data).length} fields`,
    );

    return result;
  }

  // ========================================================================
  // 5. Document Comparison
  // ========================================================================

  /**
   * Compare two documents and highlight similarities and differences.
   *
   * @param docId1      First document ID
   * @param docId2      Second document ID
   * @param businessId  Tenant-scoped business identifier
   * @returns           Comparison report
   */
  async compareDocuments(
    docId1: string,
    docId2: string,
    businessId: string,
  ): Promise<DocumentComparison> {
    this.logger.debug(`Comparing documents: ${docId1} vs ${docId2}`);

    // Verify both documents
    const [doc1, doc2] = await Promise.all([
      this.prisma.client.keyDocument.findFirst({
        where: { id: docId1, businessId },
      }),
      this.prisma.client.keyDocument.findFirst({
        where: { id: docId2, businessId },
      }),
    ]);

    if (!doc1) throw new NotFoundException(`Document not found: ${docId1}`);
    if (!doc2) throw new NotFoundException(`Document not found: ${docId2}`);

    // Get chunks for both documents
    const [chunks1, chunks2] = await Promise.all([
      this.getDocumentChunks(docId1),
      this.getDocumentChunks(docId2),
    ]);

    const text1 = chunks1.map((c) => c.text).join('\n').substring(0, 6000);
    const text2 = chunks2.map((c) => c.text).join('\n').substring(0, 6000);

    const response = await this.gateway.complete({
      businessId,
      taskCategory: 'analysis',
      messages: [
        {
          role: 'system',
          content: `Compare two documents and identify similarities and differences. Respond ONLY with valid JSON:
{
  "similarities": ["shared topic or theme 1", "shared topic 2"],
  "differences": [
    { "category": "category name", "doc1Value": "what doc1 says", "doc2Value": "what doc2 says" }
  ],
  "summary": "Brief overall comparison summary",
  "confidence": 0.0-1.0
}`,
        },
        {
          role: 'user',
          content: `Document 1 (${doc1.fileName}):\n${text1}\n\n---\n\nDocument 2 (${doc2.fileName}):\n${text2}\n\nCompare these two documents.`,
        },
      ],
      maxTokens: 1000,
      temperature: 0.3,
    });

    const comparison = this.safeParseJson<{
      similarities?: string[];
      differences?: Array<{ category: string; doc1Value: string; doc2Value: string }>;
      summary?: string;
      confidence?: number;
    }>(response.content ?? '{}');

    const result: DocumentComparison = {
      document1: { id: docId1, name: doc1.fileName },
      document2: { id: docId2, name: doc2.fileName },
      similarities: comparison.similarities ?? [],
      differences: comparison.differences ?? [],
      summary:
        comparison.summary ??
        `Comparison between ${doc1.fileName} and ${doc2.fileName}.`,
      confidence: Math.max(0, Math.min(1, comparison.confidence ?? 0.7)),
    };

    this.logger.debug(
      `Comparison complete: ${result.similarities.length} similarities, ${result.differences.length} differences`,
    );

    return result;
  }

  // ========================================================================
  // 6. List Documents
  // ========================================================================

  /**
   * List all uploaded documents for a business with metadata.
   *
   * @param businessId  Tenant-scoped business identifier
   * @returns           Array of document entries
   */
  async getDocuments(businessId: string): Promise<DocumentListEntry[]> {
    this.logger.debug(`Listing documents for business=${businessId}`);

    const documents = await this.prisma.client.keyDocument.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });

    return documents.map((doc) => ({
      id: doc.id,
      fileName: doc.fileName,
      fileType: doc.fileType,
      fileSize: doc.fileSize,
      chunksIndexed: doc.chunksIndexed ?? 0,
      status: doc.status,
      metadata: doc.metadata ? this.safeParseJson(doc.metadata) : undefined,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }));
  }

  // ========================================================================
  // 7. Delete Document
  // ========================================================================

  /**
   * Delete a document and all associated embeddings.
   * Removes from storage and vector database.
   *
   * @param documentId  The document to delete
   * @param businessId  Tenant-scoped business identifier
   */
  async deleteDocument(
    documentId: string,
    businessId: string,
  ): Promise<{ deleted: boolean; documentId: string }> {
    this.logger.log(`Deleting document: ${documentId} for business=${businessId}`);

    // Verify document exists and belongs to business
    const document = await this.prisma.client.keyDocument.findFirst({
      where: { id: documentId, businessId },
    });

    if (!document) {
      throw new NotFoundException(`Document not found: ${documentId}`);
    }

    // Delete all vector embeddings for this document
    await this.deleteVectorEmbeddings(documentId);

    // Delete extraction results from aiMemory
    await this.prisma.client.aiMemory.deleteMany({
      where: {
        businessId,
        category: 'document_extraction',
        key: documentId,
      },
    });

    // Delete the document record
    await this.prisma.client.keyDocument.delete({
      where: { id: documentId },
    });

    this.logger.log(`Document deleted: ${documentId}`);

    return { deleted: true, documentId };
  }

  // ========================================================================
  // Private Helpers — Document Parsing
  // ========================================================================

  /**
   * Parse a document file and extract raw text.
   * Supports PDF, Word, Excel, images (OCR), and text files.
   */
  private async parseDocument(file: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
  }): Promise<string> {
    switch (file.mimetype) {
      case 'application/pdf':
        return this.parsePdf(file.buffer);

      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      case 'application/msword':
        return this.parseWord(file.buffer);

      case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      case 'application/vnd.ms-excel':
        return this.parseExcel(file.buffer);

      case 'image/png':
      case 'image/jpeg':
      case 'image/jpg':
      case 'image/webp':
        return this.parseImage(file.buffer, file.mimetype);

      case 'text/plain':
      case 'text/csv':
        return file.buffer.toString('utf-8');

      default:
        // Try to extract as text
        return file.buffer.toString('utf-8');
    }
  }

  /**
   * Parse PDF using pdf-parse.
   */
  private async parsePdf(buffer: Buffer): Promise<string> {
    try {
      const pdfParse = await import('pdf-parse');
      const result = await pdfParse.default(buffer);
      return result.text ?? '';
    } catch (err) {
      this.logger.warn(`pdf-parse failed, falling back to AI vision: ${(err as Error).message}`);
      // Fallback: treat PDF as image and use AI vision
      return this.parseImage(buffer, 'application/pdf');
    }
  }

  /**
   * Parse Word document using mammoth.
   */
  private async parseWord(buffer: Buffer): Promise<string> {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return result.value ?? '';
    } catch (err) {
      this.logger.warn(`mammoth failed: ${(err as Error).message}`);
      return buffer.toString('utf-8');
    }
  }

  /**
   * Parse Excel spreadsheet using xlsx.
   */
  private async parseExcel(buffer: Buffer): Promise<string> {
    try {
      const xlsx = await import('xlsx');
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      let text = '';
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        text += `\n--- Sheet: ${sheetName} ---\n`;
        text += xlsx.utils.sheet_to_csv(sheet);
      }
      return text;
    } catch (err) {
      this.logger.warn(`xlsx failed: ${(err as Error).message}`);
      return buffer.toString('utf-8');
    }
  }

  /**
   * Parse image using AI vision (GPT-4o).
   */
  private async parseImage(
    buffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    const base64 = buffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const response = await this.gateway.complete({
      businessId: 'system',
      taskCategory: 'extraction',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract all the text from this image. Preserve the layout and structure as much as possible. Respond with just the extracted text, no additional commentary.',
            },
            {
              type: 'image_url',
              image_url: { url: dataUrl, detail: 'high' },
            } as any,
          ],
        },
      ],
      maxTokens: 2000,
      temperature: 0.2,
    });

    return response.content?.trim() ?? '';
  }

  // ========================================================================
  // Private Helpers — Text Chunking
  // ========================================================================

  /**
   * Split text into overlapping chunks for embedding and retrieval.
   */
  private chunkText(text: string, documentId: string): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const sentences = this.splitIntoSentences(text);

    let currentChunk = '';
    let chunkIndex = 0;

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > this.CHUNK_SIZE && currentChunk.length > 0) {
        chunks.push({
          id: `${documentId}-chunk-${chunkIndex}`,
          documentId,
          chunkIndex,
          text: currentChunk.trim(),
        });
        // Overlap: keep the last portion for context continuity
        currentChunk = currentChunk.slice(-this.CHUNK_OVERLAP) + ' ' + sentence;
        chunkIndex++;
      } else {
        currentChunk += (currentChunk ? ' ' : '') + sentence;
      }
    }

    // Don't forget the last chunk
    if (currentChunk.trim().length > 0) {
      chunks.push({
        id: `${documentId}-chunk-${chunkIndex}`,
        documentId,
        chunkIndex,
        text: currentChunk.trim(),
      });
    }

    return chunks;
  }

  /**
   * Split text into sentences for chunking.
   */
  private splitIntoSentences(text: string): string[] {
    // Simple sentence splitting on punctuation
    return text
      .replace(/([.!?])\s+/g, '$1\n')
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  // ========================================================================
  // Private Helpers — Embeddings & Vector Search
  // ========================================================================

  /**
   * Generate an embedding vector for a text string using OpenAI.
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    // Truncate to model's token limit (~8191 tokens ~> 32000 chars)
    const truncated = text.substring(0, 32000);

    const response = await this.openai.embeddings.create({
      model: this.EMBEDDING_MODEL,
      input: truncated,
      dimensions: this.EMBEDDING_DIMENSION,
    });

    return response.data[0].embedding;
  }

  /**
   * Index document chunks by generating embeddings and storing in Redis.
   * Uses Redis as a vector store with cosine similarity.
   */
  private async indexChunks(
    documentId: string,
    chunks: DocumentChunk[],
    businessId: string,
  ): Promise<void> {
    for (const chunk of chunks) {
      const embedding = await this.generateEmbedding(chunk.text);

      // Store chunk with embedding in Redis
      const chunkKey = `doc:chunk:${chunk.id}`;
      await this.redis.setJson(
        chunkKey,
        {
          id: chunk.id,
          documentId: chunk.documentId,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          embedding,
          businessId,
        },
        0, // No TTL — persist until document is deleted
      );

      // Also store in a document-specific index set
      await this.redis.setJson(
        `doc:index:${documentId}:${chunk.chunkIndex}`,
        { chunkKey, embedding },
        0,
      );
    }
  }

  /**
   * Search for chunks similar to the query embedding using cosine similarity.
   */
  private async vectorSearch(
    documentId: string,
    queryEmbedding: number[],
    topK: number,
  ): Promise<DocumentChunk[]> {
    // Get all chunk keys for this document
    const pattern = `doc:index:${documentId}:*`;
    // We need to scan for keys matching this pattern
    const chunkKeys: string[] = [];

    // Use Redis scan to find all index entries
    let cursor = '0';
    do {
      const result = await (this.redis as any).redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = result[0];
      chunkKeys.push(...result[1]);
    } while (cursor !== '0');

    if (chunkKeys.length === 0) {
      return [];
    }

    // Load all chunks and compute similarity
    const scored: Array<{ chunk: DocumentChunk; score: number }> = [];

    for (const key of chunkKeys) {
      const data = await this.redis.getJson<{
        chunkKey: string;
        embedding: number[];
      }>(key);

      if (data?.chunkKey && data.embedding) {
        const chunkData = await this.redis.getJson<{
          id: string;
          documentId: string;
          chunkIndex: number;
          text: string;
        }>(data.chunkKey);

        if (chunkData) {
          const score = this.cosineSimilarity(queryEmbedding, data.embedding);
          scored.push({
            chunk: {
              id: chunkData.id,
              documentId: chunkData.documentId,
              chunkIndex: chunkData.chunkIndex,
              text: chunkData.text,
            },
            score,
          });
        }
      }
    }

    // Sort by similarity score descending and take top-K
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, topK).map((s) => s.chunk);
  }

  /**
   * Compute cosine similarity between two vectors.
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Delete all vector embeddings for a document.
   */
  private async deleteVectorEmbeddings(documentId: string): Promise<void> {
    // Find and delete all index entries
    const pattern = `doc:index:${documentId}:*`;
    let cursor = '0';
    const keysToDelete: string[] = [];

    do {
      const result = await (this.redis as any).redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = result[0];
      keysToDelete.push(...result[1]);
    } while (cursor !== '0');

    // Also delete the actual chunk data
    const chunkPattern = `doc:chunk:${documentId}-chunk-*`;
    do {
      const result = await (this.redis as any).redis.scan(
        cursor,
        'MATCH',
        chunkPattern,
        'COUNT',
        100,
      );
      cursor = result[0];
      keysToDelete.push(...result[1]);
    } while (cursor !== '0');

    // Batch delete
    if (keysToDelete.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < keysToDelete.length; i += batchSize) {
        const batch = keysToDelete.slice(i, i + batchSize);
        await (this.redis as any).redis.del(...batch);
      }
    }

    this.logger.debug(`Deleted ${keysToDelete.length} vector entries for ${documentId}`);
  }

  // ========================================================================
  // Private Helpers — Document Retrieval
  // ========================================================================

  /**
   * Get all chunks for a document from Redis.
   */
  private async getDocumentChunks(documentId: string): Promise<DocumentChunk[]> {
    const chunks: DocumentChunk[] = [];
    const pattern = `doc:index:${documentId}:*`;

    let cursor = '0';
    const indexKeys: string[] = [];

    do {
      const result = await (this.redis as any).redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = result[0];
      indexKeys.push(...result[1]);
    } while (cursor !== '0');

    for (const key of indexKeys) {
      const data = await this.redis.getJson<{ chunkKey: string }>(key);
      if (data?.chunkKey) {
        const chunkData = await this.redis.getJson<DocumentChunk & { text: string }>(
          data.chunkKey,
        );
        if (chunkData) {
          chunks.push(chunkData);
        }
      }
    }

    // Sort by chunk index
    chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

    return chunks;
  }

  // ========================================================================
  // Private Helpers — File Storage
  // ========================================================================

  /**
   * Store a file in cloud storage (S3).
   * Returns a storage URL.
   */
  private async storeFileInCloud(
    file: { buffer: Buffer; originalname: string; mimetype: string },
    businessId: string,
  ): Promise<string> {
    // In production: upload to S3 using the object-storage module
    // For now, generate a simulated storage URL
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const path = `documents/${businessId}/${timestamp}-${safeName}`;

    this.logger.debug(`File storage placeholder: ${path} (${file.buffer.length} bytes)`);

    // TODO: Integrate with object-storage service for production
    // await this.objectStorage.upload(path, file.buffer, file.mimetype);

    return `s3://keyflowos/${path}`;
  }

  // ========================================================================
  // Private Helpers — Confidence Estimation
  // ========================================================================

  /**
   * Estimate confidence of an answer based on response quality
   * and number of source chunks.
   */
  private estimateConfidence(answer: string, sourceCount: number): number {
    let score = 0.5;

    // Boost for having sources
    score += Math.min(sourceCount * 0.05, 0.3);

    // Boost for detailed answer
    if (answer.length > 200) score += 0.1;

    // Penalise if answer indicates lack of information
    const uncertaintyPhrases = [
      'not found',
      'no information',
      'could not find',
      'not in the',
      'does not contain',
      'i cannot',
      'unable to',
    ];
    const lowerAnswer = answer.toLowerCase();
    for (const phrase of uncertaintyPhrases) {
      if (lowerAnswer.includes(phrase)) {
        score -= 0.2;
        break;
      }
    }

    return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
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
