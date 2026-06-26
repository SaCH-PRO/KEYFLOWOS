// ============================================================
// KEY Cortex — Code Sandbox Service
// Lets KEY generate and execute custom code safely to solve
// any business problem. Supports SQL, JavaScript, Python, and
// HTML with sandboxed execution, timeout handling, and
// comprehensive security measures.
// ============================================================

import {
  Injectable,
  Logger,
  Inject,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { spawn } from 'child_process';
import { runInNewContext } from 'vm';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import { ModelGatewayService } from '../ai/model-gateway.service';
import { AiUsageService } from '../ai/ai-usage.service';
import {
  SandboxLanguage,
  SandboxExecutionRequest,
  SandboxGenerationRequest,
  SandboxExecutionResult,
  SandboxGenerationResult,
  CodeTemplate,
  CodeTemplateLibrary,
  TemplateApplyParams,
  CodeExplanationResult,
  SandboxSecurityAudit,
} from './key-cortex-sandbox.types';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MEMORY_LIMIT_MB = 128;
const JS_MAX_OUTPUT_LENGTH = 100_000;
const SQL_MAX_ROWS = 10_000;
const CODE_GENERATION_FEATURE = 'sandbox_code_generation';
const CODE_EXPLANATION_FEATURE = 'sandbox_code_explanation';

/** Blocked SQL keywords that require explicit confirmation */
const BLOCKED_SQL_PATTERNS = [
  { pattern: /\bDROP\s+(TABLE|DATABASE|SCHEMA|INDEX|VIEW)\b/i, message: 'DROP statements are not allowed' },
  { pattern: /\bTRUNCATE\s+TABLE\b/i, message: 'TRUNCATE statements are not allowed' },
  { pattern: /\bDELETE\s+FROM\b(?![\s\S]*?\bWHERE\b)/i, message: 'DELETE without WHERE is not allowed' },
  { pattern: /\bALTER\s+TABLE\s+.*\bDROP\b/i, message: 'ALTER TABLE DROP is not allowed' },
  { pattern: /\bEXEC\s*\(/i, message: 'EXEC statements are not allowed' },
  { pattern: /\bEXECUTE\s*\(/i, message: 'EXECUTE statements are not allowed' },
  { pattern: /xp_cmdshell/i, message: 'xp_cmdshell is not allowed' },
  { pattern: /\bINTO\s+OUTFILE\b/i, message: 'INTO OUTFILE is not allowed' },
  { pattern: /\bLOAD_FILE\b/i, message: 'LOAD_FILE is not allowed' },
  { pattern: /information_schema/i, message: 'information_schema access is not allowed' },
];

/** Blocked JavaScript patterns for security */
const BLOCKED_JS_PATTERNS = [
  { pattern: /\brequire\s*\(/, message: 'require() is not allowed' },
  { pattern: /\bimport\b.*\bfrom\b/, message: 'ES module imports are not allowed' },
  { pattern: /process\s*\.\s*(env|exit|kill|abort)/, message: 'process manipulation is not allowed' },
  { pattern: /child_process/, message: 'child_process is not allowed' },
  { pattern: /fs\s*\.\s*(readFile|writeFile|appendFile|unlink|rmdir|mkdir)/, message: 'fs operations are not allowed' },
  { pattern: /eval\s*\(/, message: 'eval() is not allowed' },
  { pattern: /Function\s*\(\s*['"`]/, message: 'Function constructor is not allowed' },
  { pattern: /setTimeout\s*\(\s*['"`]/, message: 'Delayed code execution is not allowed' },
  { pattern: /setInterval\s*\(\s*['"`]/, message: 'Delayed code execution is not allowed' },
  { pattern: /globalThis/, message: 'globalThis access is not allowed' },
  { pattern: /constructor\s*\.\s*constructor/, message: 'Constructor access is not allowed' },
  { pattern: /__proto__/, message: 'Prototype manipulation is not allowed' },
  { pattern: /Worker\s*\(/, message: 'Web Workers are not allowed' },
  { pattern: /Atomics\s*\.\s*wait/, message: 'SharedArrayBuffer attacks are not allowed' },
  { pattern: /fetch\s*\(/, message: 'Network requests are not allowed' },
  { pattern: /XMLHttpRequest/, message: 'Network requests are not allowed' },
  { pattern: /WebSocket/, message: 'Network requests are not allowed' },
];

/** Blocked Python imports and patterns */
const BLOCKED_PYTHON_PATTERNS = [
  { pattern: /\bimport\s+os\b/, message: 'os module is not allowed' },
  { pattern: /\bimport\s+sys\b/, message: 'sys module is not allowed' },
  { pattern: /\bimport\s+subprocess\b/, message: 'subprocess module is not allowed' },
  { pattern: /\bimport\s+socket\b/, message: 'socket module is not allowed' },
  { pattern: /\bimport\s+urllib\b/, message: 'urllib module is not allowed' },
  { pattern: /\bimport\s+requests\b/, message: 'requests module is not allowed' },
  { pattern: /\bimport\s+ftplib\b/, message: 'ftplib module is not allowed' },
  { pattern: /\bimport\s+smtplib\b/, message: 'smtplib module is not allowed' },
  { pattern: /\bimport\s+http\b/, message: 'http module is not allowed' },
  { pattern: /\bimport\s+webbrowser\b/, message: 'webbrowser module is not allowed' },
  { pattern: /\b__import__\s*\(/, message: 'Dynamic imports are not allowed' },
  { pattern: /\bopen\s*\(/, message: 'File operations are not allowed' },
  { pattern: /\bexec\s*\(/, message: 'exec() is not allowed' },
  { pattern: /\bcompile\s*\(/, message: 'compile() is not allowed' },
  { pattern: /\beval\s*\(/, message: 'eval() is not allowed' },
];

// ─────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────

@Injectable()
export class KeyCortexSandboxService {
  private readonly logger = new Logger(KeyCortexSandboxService.name);

  constructor(
    @Inject(ModelGatewayService)
    private readonly modelGateway: ModelGatewayService,
    @Inject(AiUsageService)
    private readonly aiUsage: AiUsageService,
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(RedisService)
    private readonly redis: RedisService,
  ) {}

  // ──────────────────────────────────────────────────────────
  // 1. Code Generation
  // ──────────────────────────────────────────────────────────

  /**
   * Generate code from a natural language description using AI.
   * Builds a structured prompt, calls gpt-4o, validates the output,
   * and tracks AI usage.
   */
  async generateCode(
    request: SandboxGenerationRequest,
  ): Promise<SandboxGenerationResult> {
    const { description, language, context, examples } = request;
    const businessId = context?.businessId;

    if (!businessId) {
      throw new BadRequestException('businessId is required in context');
    }

    this.logger.log(`Generating ${language} code for business ${businessId}`);

    // Build the generation prompt
    const systemPrompt = this.buildGenerationSystemPrompt(language);
    const userPrompt = this.buildGenerationUserPrompt(
      description,
      language,
      context?.availableTables,
      context?.availableApis,
      examples,
    );

    try {
      const result = await this.aiUsage.callAi({
        businessId,
        feature: CODE_GENERATION_FEATURE,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        maxTokens: 4000,
        temperature: 0.2,
        model: 'gpt-4o',
        taskCategory: 'tool-calling',
        responseMode: 'structured_json',
      });

      const parsed = this.parseGeneratedCode(result.content);
      const syntaxValid = this.validateSyntax(parsed.code, language);
      const complexity = this.estimateComplexity(parsed.code, language);

      this.logger.log(
        `Generated ${language} code (${parsed.code.length} chars, syntaxValid=${syntaxValid}, complexity=${complexity})`,
      );

      return {
        code: parsed.code,
        explanation: parsed.explanation,
        language,
        syntaxValid,
        complexity,
      };
    } catch (error) {
      this.logger.error(`Code generation failed: ${(error as Error).message}`);
      throw new BadRequestException(
        `Failed to generate code: ${(error as Error).message}`,
      );
    }
  }

  // ──────────────────────────────────────────────────────────
  // 2. Code Execution
  // ──────────────────────────────────────────────────────────

  /**
   * Execute code in a sandboxed environment based on language.
   * SQL runs via Prisma $queryRaw, JavaScript in an isolated VM,
   * Python via child process with timeout, and HTML is returned as-is.
   */
  async executeCode(
    request: SandboxExecutionRequest,
  ): Promise<SandboxExecutionResult> {
    const {
      code,
      language,
      context,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      memoryLimitMb = DEFAULT_MEMORY_LIMIT_MB,
    } = request;

    const businessId = context?.businessId;
    if (!businessId) {
      throw new BadRequestException('businessId is required in context');
    }

    const startTime = Date.now();
    let executionTimeMs = 0;

    try {
      // Security audit before execution
      const audit = this.auditCode(code, language);
      if (!audit.passed) {
        executionTimeMs = Date.now() - startTime;
        await this.logExecution(businessId, context?.userId, code, language, false, 'security', executionTimeMs);
        return {
          success: false,
          error: `Security check failed: ${audit.violations.join('; ')}`,
          errorType: 'security',
          executionTimeMs,
          language,
          code,
        };
      }

      let result: SandboxExecutionResult;

      switch (language) {
        case 'sql':
          result = await this.executeSql(code, businessId, context?.databaseAccess ?? false, timeoutMs);
          break;
        case 'javascript':
          result = await this.executeJavaScript(code, context?.variables ?? {}, timeoutMs, memoryLimitMb);
          break;
        case 'python':
          result = await this.executePython(code, timeoutMs, memoryLimitMb);
          break;
        case 'html':
          result = this.executeHtml(code);
          break;
        default:
          throw new BadRequestException(`Unsupported language: ${language}`);
      }

      executionTimeMs = Date.now() - startTime;

      await this.logExecution(
        businessId,
        context?.userId,
        code,
        language,
        result.success,
        result.errorType,
        executionTimeMs,
      );

      return {
        ...result,
        executionTimeMs,
        language,
        code,
      };
    } catch (error) {
      executionTimeMs = Date.now() - startTime;
      const errorMsg = (error as Error).message;

      this.logger.error(`Execution failed: ${errorMsg}`);
      await this.logExecution(businessId, context?.userId, code, language, false, 'runtime', executionTimeMs);

      return {
        success: false,
        error: errorMsg,
        errorType: 'runtime',
        executionTimeMs,
        language,
        code,
      };
    }
  }

  // ──────────────────────────────────────────────────────────
  // 3. Execute Generated Code (convenience)
  // ──────────────────────────────────────────────────────────

  /**
   * Convenience method: generate code from a description, then execute it.
   * Returns both the generated code and the execution result.
   */
  async executeGeneratedCode(
    description: string,
    language: SandboxLanguage,
    context?: SandboxGenerationRequest['context'],
    timeoutMs?: number,
    memoryLimitMb?: number,
  ): Promise<{ generation: SandboxGenerationResult; execution: SandboxExecutionResult }> {
    const generation = await this.generateCode({
      description,
      language,
      context,
    });

    const execution = await this.executeCode({
      code: generation.code,
      language,
      context: {
        businessId: context?.businessId || '',
        userId: '',
        databaseAccess: true,
        apiAccess: false,
      },
      timeoutMs,
      memoryLimitMb,
    });

    return { generation, execution };
  }

  // ──────────────────────────────────────────────────────────
  // 4. Get Templates
  // ──────────────────────────────────────────────────────────

  /**
   * Return the pre-built code template library.
   */
  getTemplates(): CodeTemplateLibrary {
    const templates: CodeTemplate[] = [
      {
        id: 'revenue-by-customer-month',
        name: 'Revenue by Customer This Month',
        description: 'Query total revenue grouped by customer for the current month.',
        language: 'sql',
        code: `SELECT\n  c.id AS customer_id,\n  c.name AS customer_name,\n  COALESCE(SUM(i.total_amount), 0) AS total_revenue,\n  COUNT(i.id) AS invoice_count\nFROM customers c\nLEFT JOIN invoices i ON i.customer_id = c.id\n  AND i.created_at >= DATE_TRUNC('month', CURRENT_DATE)\n  AND i.created_at < DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month')\nWHERE c.business_id = '{{businessId}}'\nGROUP BY c.id, c.name\nORDER BY total_revenue DESC\nLIMIT 100;`,
        parameters: [
          { name: 'businessId', type: 'string', description: 'Business UUID for row-level filtering', required: true },
        ],
        category: 'report',
        tags: ['revenue', 'customers', 'monthly', 'reporting'],
      },
      {
        id: 'find-duplicate-contacts',
        name: 'Find Duplicate Contacts',
        description: 'Identify potential duplicate contacts by email or phone.',
        language: 'sql',
        code: `SELECT\n  email,\n  phone,\n  COUNT(*) AS duplicate_count,\n  STRING_AGG(name, ', ') AS names\nFROM contacts\nWHERE business_id = '{{businessId}}'\n  AND (email IS NOT NULL OR phone IS NOT NULL)\nGROUP BY email, phone\nHAVING COUNT(*) > 1\nORDER BY duplicate_count DESC\nLIMIT 100;`,
        parameters: [
          { name: 'businessId', type: 'string', description: 'Business UUID for row-level filtering', required: true },
        ],
        category: 'analysis',
        tags: ['contacts', 'duplicates', 'data-quality'],
      },
      {
        id: 'customer-lifetime-value',
        name: 'Calculate Customer Lifetime Value',
        description: 'Calculate lifetime revenue and average order value per customer.',
        language: 'sql',
        code: `SELECT\n  c.id AS customer_id,\n  c.name AS customer_name,\n  COALESCE(SUM(o.total_amount), 0) AS lifetime_value,\n  COUNT(o.id) AS total_orders,\n  ROUND(COALESCE(AVG(o.total_amount), 0), 2) AS avg_order_value,\n  MAX(o.created_at) AS last_order_date\nFROM customers c\nLEFT JOIN orders o ON o.customer_id = c.id\nWHERE c.business_id = '{{businessId}}'\nGROUP BY c.id, c.name\nORDER BY lifetime_value DESC\nLIMIT 100;`,
        parameters: [
          { name: 'businessId', type: 'string', description: 'Business UUID for row-level filtering', required: true },
        ],
        category: 'analysis',
        tags: ['clv', 'revenue', 'customers', 'analytics'],
      },
      {
        id: 'bulk-personalized-emails',
        name: 'Send Bulk Personalized Emails',
        description: 'Generate personalized email content for a list of contacts.',
        language: 'javascript',
        code: `const contacts = JSON.parse('{{contacts}}');\nconst subjectTemplate = '{{subject}}';\nconst bodyTemplate = '{{body}}';\n\nconst results = contacts.map(contact => {\n  const personalizedSubject = subjectTemplate\n    .replace(/{{firstName}}/g, contact.firstName || 'Valued Customer')\n    .replace(/{{company}}/g, contact.company || 'Your Company');\n  const personalizedBody = bodyTemplate\n    .replace(/{{firstName}}/g, contact.firstName || 'Valued Customer')\n    .replace(/{{company}}/g, contact.company || 'Your Company')\n    .replace(/{{lastName}}/g, contact.lastName || '');\n\n  return {\n    to: contact.email,\n    subject: personalizedSubject,\n    body: personalizedBody,\n    preview: personalizedBody.substring(0, 200) + '...',\n  };\n});\n\nconsole.log(JSON.stringify({ count: results.length, emails: results }, null, 2));`,
        parameters: [
          { name: 'contacts', type: 'json', description: 'JSON array of contact objects', required: true },
          { name: 'subject', type: 'string', description: 'Email subject template with {{placeholders}}', required: true },
          { name: 'body', type: 'string', description: 'Email body template with {{placeholders}}', required: true },
        ],
        category: 'automation',
        tags: ['email', 'bulk', 'personalization', 'marketing'],
      },
      {
        id: 'weekly-report',
        name: 'Generate Weekly Report',
        description: 'Generate a summary report of key business metrics for the week.',
        language: 'javascript',
        code: `const reportData = JSON.parse('{{reportData}}');\nconst { newCustomers, totalRevenue, newOrders, topProducts } = reportData;\n\nconst startDate = new Date();\nstartDate.setDate(startDate.getDate() - 7);\nconst endDate = new Date();\n\nconst report = {\n  period: { start: startDate.toISOString().split('T')[0], end: endDate.toISOString().split('T')[0] },\n  summary: {\n    newCustomers: newCustomers || 0,\n    totalRevenue: totalRevenue || 0,\n    newOrders: newOrders || 0,\n    avgOrderValue: newOrders > 0 ? (totalRevenue / newOrders).toFixed(2) : '0.00',\n  },\n  highlights: [\n    \\`\${newCustomers || 0} new customers acquired\\`,\n    \\`\\$\\${(totalRevenue || 0).toFixed(2)} in total revenue\\`,\n    \\`\${newOrders || 0} orders placed\\`,\n  ],\n  topProducts: (topProducts || []).slice(0, 5),\n  generatedAt: new Date().toISOString(),\n};\n\nconsole.log(JSON.stringify(report, null, 2));`,
        parameters: [
          { name: 'reportData', type: 'json', description: 'JSON object with newCustomers, totalRevenue, newOrders, topProducts', required: true },
        ],
        category: 'report',
        tags: ['report', 'weekly', 'metrics', 'summary'],
      },
      {
        id: 'cleanup-old-data',
        name: 'Clean Up Old Data',
        description: 'Generate a cleanup script for archiving or removing old records.',
        language: 'javascript',
        code: `const config = JSON.parse('{{config}}');\nconst { tableName, dateField, daysOld, dryRun = true } = config;\n\nif (!tableName || !dateField || !daysOld) {\n  throw new Error('tableName, dateField, and daysOld are required');\n}\n\nconst cutoffDate = new Date();\ncutoffDate.setDate(cutoffDate.getDate() - daysOld);\nconst cutoffIso = cutoffDate.toISOString();\n\nconst plan = {\n  action: dryRun ? 'DRY_RUN' : 'EXECUTE',\n  table: tableName,\n  dateField: dateField,\n  cutoffDate: cutoffIso,\n  daysOld: daysOld,\n  query: \\`SELECT COUNT(*) FROM \\${tableName} WHERE \\${dateField} < '\\${cutoffIso}'\\`,\n  deleteQuery: \\`DELETE FROM \\${tableName} WHERE \\${dateField} < '\\${cutoffIso}'\\`,\n  warning: 'Review the dry run results before executing.',\n  generatedAt: new Date().toISOString(),\n};\n\nconsole.log(JSON.stringify(plan, null, 2));`,
        parameters: [
          { name: 'config', type: 'json', description: 'JSON with tableName, dateField, daysOld, dryRun', required: true },
        ],
        category: 'utility',
        tags: ['cleanup', 'maintenance', 'data-management'],
      },
      {
        id: 'custom-email-template',
        name: 'Custom Email Template',
        description: 'A customizable HTML email template with business branding.',
        language: 'html',
        code: `<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="UTF-8">\n  <title>{{title}}</title>\n  <style>\n    body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }\n    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }\n    .header { background: {{headerColor}}; color: white; padding: 24px; text-align: center; }\n    .content { padding: 24px; color: #333; line-height: 1.6; }\n    .footer { background: #fafafa; padding: 16px; text-align: center; font-size: 12px; color: #888; }\n    .btn { display: inline-block; padding: 12px 24px; background: {{headerColor}}; color: white; text-decoration: none; border-radius: 4px; margin-top: 16px; }\n  </style>\n</head>\n<body>\n  <div class="container">\n    <div class="header">\n      <h1>{{companyName}}</h1>\n    </div>\n    <div class="content">\n      <h2>{{title}}</h2>\n      <p>{{message}}</p>\n      <a href="{{ctaUrl}}" class="btn">{{ctaText}}</a>\n    </div>\n    <div class="footer">\n      <p>&copy; {{year}} {{companyName}}. All rights reserved.</p>\n      <p>{{companyAddress}}</p>\n    </div>\n  </div>\n</body>\n</html>`,
        parameters: [
          { name: 'companyName', type: 'string', description: 'Business name for header and footer', required: true },
          { name: 'title', type: 'string', description: 'Email subject/title', required: true },
          { name: 'message', type: 'string', description: 'Main email body content (HTML allowed)', required: true },
          { name: 'headerColor', type: 'string', description: 'Brand color hex code', required: false },
          { name: 'ctaUrl', type: 'string', description: 'Call-to-action button URL', required: false },
          { name: 'ctaText', type: 'string', description: 'Call-to-action button text', required: false },
          { name: 'year', type: 'string', description: 'Copyright year', required: false },
          { name: 'companyAddress', type: 'string', description: 'Business address for footer', required: false },
        ],
        category: 'integration',
        tags: ['email', 'template', 'html', 'branding'],
      },
      {
        id: 'invoice-pdf-template',
        name: 'Invoice PDF Template',
        description: 'A styled HTML template for generating invoice PDFs.',
        language: 'html',
        code: `<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="UTF-8">\n  <title>Invoice {{invoiceNumber}}</title>\n  <style>\n    body { font-family: 'Segoe UI', Arial, sans-serif; margin: 40px; color: #333; }\n    .invoice-header { display: flex; justify-content: space-between; border-bottom: 3px solid {{accentColor}}; padding-bottom: 20px; margin-bottom: 30px; }\n    .company-info h1 { margin: 0; color: {{accentColor}}; }\n    .invoice-meta { text-align: right; }\n    .invoice-meta h2 { margin: 0; color: {{accentColor}}; }\n    .client-section { margin-bottom: 30px; }\n    table { width: 100%; border-collapse: collapse; margin: 20px 0; }\n    th { background: {{accentColor}}; color: white; padding: 12px; text-align: left; }\n    td { padding: 12px; border-bottom: 1px solid #eee; }\n    .totals { text-align: right; margin-top: 20px; }\n    .totals .grand { font-size: 1.3em; font-weight: bold; color: {{accentColor}}; }\n    .notes { margin-top: 30px; padding: 15px; background: #f9f9f9; border-radius: 4px; }\n    .status { display: inline-block; padding: 6px 16px; border-radius: 20px; font-weight: bold; text-transform: uppercase; font-size: 0.85em; }\n    .status-paid { background: #d4edda; color: #155724; }\n    .status-pending { background: #fff3cd; color: #856404; }\n    .status-overdue { background: #f8d7da; color: #721c24; }\n  </style>\n</head>\n<body>\n  <div class="invoice-header">\n    <div class="company-info">\n      <h1>{{companyName}}</h1>\n      <p>{{companyAddress}}<br>{{companyEmail}}<br>{{companyPhone}}</p>\n    </div>\n    <div class="invoice-meta">\n      <h2>INVOICE</h2>\n      <p><strong>#{{invoiceNumber}}</strong></p>\n      <p>Date: {{invoiceDate}}</p>\n      <p>Due: {{dueDate}}</p>\n      <span class="status status-{{status}}">{{status}}</span>\n    </div>\n  </div>\n  <div class="client-section">\n    <strong>Bill To:</strong><br>\n    {{clientName}}<br>\n    {{clientAddress}}\n  </div>\n  <table>\n    <thead>\n      <tr><th>Item</th><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>\n    </thead>\n    <tbody>\n      {{#each lineItems}}\n      <tr>\n        <td>{{name}}</td>\n        <td>{{description}}</td>\n        <td>{{quantity}}</td>\n        <td>${{rate}}</td>\n        <td>${{amount}}</td>\n      </tr>\n      {{/each}}\n    </tbody>\n  </table>\n  <div class="totals">\n    <p>Subtotal: ${{subtotal}}</p>\n    <p>Tax ({{taxRate}}%): ${{taxAmount}}</p>\n    <p class="grand">Total: ${{total}}</p>\n  </div>\n  <div class="notes">\n    <strong>Notes:</strong> {{notes}}\n  </div>\n</body>\n</html>`,
        parameters: [
          { name: 'companyName', type: 'string', description: 'Business name', required: true },
          { name: 'companyAddress', type: 'string', description: 'Business address', required: true },
          { name: 'companyEmail', type: 'string', description: 'Business email', required: true },
          { name: 'companyPhone', type: 'string', description: 'Business phone', required: false },
          { name: 'invoiceNumber', type: 'string', description: 'Invoice number', required: true },
          { name: 'invoiceDate', type: 'string', description: 'Invoice date', required: true },
          { name: 'dueDate', type: 'string', description: 'Due date', required: true },
          { name: 'status', type: 'string', description: 'Invoice status (paid/pending/overdue)', required: true },
          { name: 'clientName', type: 'string', description: 'Client name', required: true },
          { name: 'clientAddress', type: 'string', description: 'Client address', required: false },
          { name: 'lineItems', type: 'json', description: 'Array of {name, description, quantity, rate, amount}', required: true },
          { name: 'subtotal', type: 'string', description: 'Subtotal amount', required: true },
          { name: 'taxRate', type: 'string', description: 'Tax rate percentage', required: false },
          { name: 'taxAmount', type: 'string', description: 'Tax amount', required: false },
          { name: 'total', type: 'string', description: 'Total amount', required: true },
          { name: 'accentColor', type: 'string', description: 'Brand accent color hex', required: false },
          { name: 'notes', type: 'string', description: 'Invoice notes', required: false },
        ],
        category: 'report',
        tags: ['invoice', 'pdf', 'template', 'billing'],
      },
    ];

    const categories = [...new Set(templates.map(t => t.category))];

    return { templates, categories };
  }

  // ──────────────────────────────────────────────────────────
  // 5. Apply Template
  // ──────────────────────────────────────────────────────────

  /**
   * Get a template by ID, substitute parameters, and execute.
   */
  async applyTemplate(
    templateId: string,
    parameters: Record<string, string | number | boolean>,
    context?: TemplateApplyParams['context'],
    timeoutMs?: number,
    memoryLimitMb?: number,
  ): Promise<SandboxExecutionResult> {
    const library = this.getTemplates();
    const template = library.templates.find(t => t.id === templateId);

    if (!template) {
      throw new NotFoundException(`Template '${templateId}' not found`);
    }

    // Validate required parameters
    for (const param of template.parameters) {
      if (param.required && !(param.name in parameters)) {
        throw new BadRequestException(
          `Missing required parameter: ${param.name} (${param.description})`,
        );
      }
    }

    // Substitute parameters into template code
    let substitutedCode = template.code;
    for (const [key, value] of Object.entries(parameters)) {
      const placeholder = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
      const stringValue = typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
      // Escape for safe template substitution
      const escapedValue = stringValue
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\n/g, '\\n');
      substitutedCode = substitutedCode.replace(placeholder, escapedValue);
    }

    // Clean up any remaining optional placeholders
    substitutedCode = substitutedCode.replace(
      /\{\{\s*[#\/]?if\s+\w+\s*\}\}/g,
      '',
    );
    substitutedCode = substitutedCode.replace(
      /\{\{\s*each\s+\w+\s*\}\}[\s\S]*?\{\{\s*\/each\s*\}\}/g,
      '',
    );
    substitutedCode = substitutedCode.replace(
      /\{\{\s*\w+\s*\}\}/g,
      '',
    );

    // Execute the substituted code
    return this.executeCode({
      code: substitutedCode,
      language: template.language,
      context: {
        businessId: context?.businessId || '',
        userId: context?.userId || '',
        databaseAccess: context?.databaseAccess ?? true,
        apiAccess: context?.apiAccess ?? false,
      },
      timeoutMs: timeoutMs || DEFAULT_TIMEOUT_MS,
      memoryLimitMb: memoryLimitMb || DEFAULT_MEMORY_LIMIT_MB,
    });
  }

  // ──────────────────────────────────────────────────────────
  // 6. Explain Code
  // ──────────────────────────────────────────────────────────

  /**
   * Send code to AI for a human-readable explanation.
   */
  async explainCode(
    code: string,
    language: SandboxLanguage,
    businessId?: string,
  ): Promise<CodeExplanationResult> {
    const effectiveBusinessId = businessId || 'sandbox';

    this.logger.log(`Explaining ${language} code (${code.length} chars)`);

    const systemPrompt = `You are a code explanation assistant. Provide clear, human-readable explanations of code snippets. Identify what the code does, its inputs/outputs, and any potential risks. Respond in JSON format with fields: explanation (string), warnings (string[]), suggestions (string[]).`;

    const userPrompt = `Explain this ${language} code:\n\n\`\`\`${language}\n${code}\n\`\`\``;

    try {
      const result = await this.aiUsage.callAi({
        businessId: effectiveBusinessId,
        feature: CODE_EXPLANATION_FEATURE,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        maxTokens: 2000,
        temperature: 0.3,
        model: 'gpt-4o-mini',
        responseMode: 'structured_json',
      });

      const parsed = this.parseExplanation(result.content);

      return {
        explanation: parsed.explanation,
        language,
        warnings: parsed.warnings,
        suggestions: parsed.suggestions,
      };
    } catch (error) {
      this.logger.error(`Code explanation failed: ${(error as Error).message}`);

      // Fallback: return basic explanation
      return {
        explanation: `This is a ${language} code snippet (${code.length} characters). AI explanation is temporarily unavailable.`,
        language,
        warnings: ['Could not perform AI-powered security analysis.'],
        suggestions: ['Review the code manually before executing.'],
      };
    }
  }

  // Controller-facing aliases (the controller uses shorter method names)
  async generate(dto: {
    prompt: string;
    language?: SandboxLanguage;
    businessId?: string;
  }): Promise<SandboxExecutionResult> {
    return this.generateCode(dto.prompt, dto.language ?? 'javascript', dto.businessId);
  }

  async execute(dto: {
    code: string;
    language?: SandboxLanguage;
    businessId?: string;
    parameters?: Record<string, unknown>;
  }): Promise<SandboxExecutionResult> {
    return this.executeCode(dto.code, dto.language ?? 'javascript', dto.businessId, {
      parameters: dto.parameters,
    });
  }

  async auto(dto: {
    prompt: string;
    language?: SandboxLanguage;
    businessId?: string;
  }): Promise<SandboxExecutionResult> {
    const generated = await this.generateCode(
      dto.prompt,
      dto.language ?? 'javascript',
      dto.businessId,
    );
    if (!generated.success || !generated.output) {
      return generated;
    }
    return this.executeCode(
      generated.output,
      dto.language ?? 'javascript',
      dto.businessId,
    );
  }

  listTemplates(): CodeTemplateLibrary {
    return this.getTemplates();
  }

  async explain(dto: {
    code: string;
    language?: SandboxLanguage;
    businessId?: string;
  }): Promise<CodeExplanationResult> {
    return this.explainCode(dto.code, dto.language ?? 'javascript', dto.businessId);
  }

  // ══════════════════════════════════════════════════════════
  // SQL Execution
  // ══════════════════════════════════════════════════════════

  private async executeSql(
    code: string,
    businessId: string,
    databaseAccess: boolean,
    timeoutMs: number,
  ): Promise<Pick<SandboxExecutionResult, 'success' | 'output' | 'error' | 'errorType'>> {
    if (!databaseAccess) {
      return {
        success: false,
        error: 'Database access is disabled for this execution context',
        errorType: 'security',
      };
    }

    // Validate the SQL is read-only (SELECT or CTE). INSERT/UPDATE/DELETE are
    // disabled in this build until we have a real query parser, allowlisted
    // tables, and row-level policy enforcement.
    const trimmed = code.trim().toUpperCase();
    const isReadOnlyQuery =
      trimmed.startsWith('SELECT') || trimmed.startsWith('WITH');

    if (!isReadOnlyQuery) {
      return {
        success: false,
        error: 'Only read-only SELECT / WITH queries are allowed in the sandbox',
        errorType: 'security',
      };
    }

    // Ensure business_id filter is present for INSERT/UPDATE
    if (trimmed.startsWith('INSERT') || trimmed.startsWith('UPDATE')) {
      const hasBusinessFilter = code.toLowerCase().includes('business_id');
      if (!hasBusinessFilter) {
        return {
          success: false,
          error: 'INSERT/UPDATE queries must include a business_id filter for row-level security',
          errorType: 'security',
        };
      }
    }

    // Whitelist validation for SQL injection prevention
    const ALLOWED_TABLES = ['Invoice', 'Contact', 'Booking', 'Product', 'Order', 'Task', 'Campaign'];
    const isSafe = /^(\s*SELECT\s+.*\s+FROM\s*"?(\w+)"?.*)$/i.test(code);
    if (!isSafe) throw new Error('Only SELECT queries are allowed');
    const tableMatch = code.match(/FROM\s*"?(\w+)"?/i);
    const table = tableMatch?.[1];
    if (table && !ALLOWED_TABLES.includes(table)) throw new Error(`Table ${table} not in whitelist`);
    // Execute via Prisma with timeout
    try {
      const result = await Promise.race([
        this.prisma.client.$queryRawUnsafe(code),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('SQL execution timeout')), timeoutMs),
        ),
      ]);

      const rows = Array.isArray(result) ? result : [result];
      const limited = rows.slice(0, SQL_MAX_ROWS);

      return {
        success: true,
        output: JSON.stringify(limited, null, 2),
      };
    } catch (error) {
      const msg = (error as Error).message;
      if (msg.includes('timeout')) {
        return { success: false, error: msg, errorType: 'timeout' };
      }
      return { success: false, error: msg, errorType: 'runtime' };
    }
  }

  // ══════════════════════════════════════════════════════════
  // JavaScript Execution (Sandboxed VM)
  // ══════════════════════════════════════════════════════════

  private async executeJavaScript(
    code: string,
    variables: Record<string, unknown>,
    timeoutMs: number,
    _memoryLimitMb: number,
  ): Promise<Pick<SandboxExecutionResult, 'success' | 'output' | 'error' | 'errorType'>> {
    const logs: string[] = [];
    const errors: string[] = [];

    // Create a sandboxed context with only safe globals
    const sandbox = {
      console: {
        log: (...args: unknown[]) => {
          const line = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
          logs.push(line);
        },
        error: (...args: unknown[]) => {
          const line = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
          errors.push(line);
        },
        warn: (...args: unknown[]) => {
          const line = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
          logs.push(`[WARN] ${line}`);
        },
        info: (...args: unknown[]) => {
          const line = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
          logs.push(`[INFO] ${line}`);
        },
      },
      Math,
      Date,
      JSON,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Error,
      // DENY: require, process, fs, http, child_process, etc.
      // Inject user-provided variables
      ...variables,
    };

    try {
      // Wrap code to capture return value and handle async
      const wrappedCode = `
        (async function() {
          "use strict";
          ${code}
        })()
      `;

      const result = runInNewContext(wrappedCode, sandbox, {
        timeout: Math.min(timeoutMs, 10000),
        displayErrors: true,
        breakOnSigint: true,
      });

      // Handle async results
      let output: string;
      if (result && typeof result.then === 'function') {
        const asyncResult = await Promise.race([
          result,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Async execution timeout')), timeoutMs),
          ),
        ]);
        output = asyncResult !== undefined ? String(asyncResult) : logs.join('\n');
      } else {
        output = result !== undefined ? String(result) : logs.join('\n');
      }

      // Cap output length
      if (output.length > JS_MAX_OUTPUT_LENGTH) {
        output = output.substring(0, JS_MAX_OUTPUT_LENGTH) +
          `\n... [output truncated at ${JS_MAX_OUTPUT_LENGTH} chars]`;
      }

      if (errors.length > 0) {
        return {
          success: false,
          output: logs.join('\n') || undefined,
          error: errors.join('\n'),
          errorType: 'runtime',
        };
      }

      return {
        success: true,
        output: output || '(no output)',
      };
    } catch (error) {
      const msg = (error as Error).message;
      if (msg.includes('Script execution timed out')) {
        return { success: false, error: 'Execution timed out', errorType: 'timeout' };
      }
      return { success: false, error: msg, errorType: 'runtime' };
    }
  }

  // ══════════════════════════════════════════════════════════
  // Python Execution (Child Process)
  // ══════════════════════════════════════════════════════════

  private async executePython(
    code: string,
    timeoutMs: number,
    _memoryLimitMb: number,
  ): Promise<Pick<SandboxExecutionResult, 'success' | 'output' | 'error' | 'errorType'>> {
    // Python execution is disabled outside of development until it can run in a
    // hardened container / firecracker-style worker with filesystem, network,
    // and resource isolation.
    if (process.env.NODE_ENV === 'production') {
      return {
        success: false,
        error: 'Python sandbox execution is disabled in production.',
        errorType: 'security',
      };
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        resolve({ success: false, error: 'Execution timed out', errorType: 'timeout' });
      }, timeoutMs);

      // Wrap user code with output capture and restricted imports
      const wrappedCode = [
        'import sys',
        'import json',
        'import math',
        'import datetime',
        'import re',
        'import collections',
        'import itertools',
        'import statistics',
        'import random',
        'import string',
        'import hashlib',
        '',
        '# Restricted builtins',
        '_original_import = __builtins__.__import__ if hasattr(__builtins__, "__import__") else __builtins__["__import__"]',
        '',
        'def _safe_import(name, *args, **kwargs):',
        '    blocked = {"os", "sys", "subprocess", "socket", "urllib", "requests",',
        '               "ftplib", "smtplib", "http", "webbrowser", "ctypes", "mmap",',
        '               "multiprocessing", "threading", "platform", "pwd", "grp",',
        '               "shutil", "pathlib", "tempfile", "glob", "pickle"}',
        '    if name.split(".")[0] in blocked:',
        '        raise ImportError(f"Module \'{name}\' is not allowed in the sandbox")',
        '    return _original_import(name, *args, **kwargs)',
        '',
        '__builtins__["__import__"] = _safe_import',
        '',
        'class _RestrictedExecution:',
        '    def run(self):',
        '        try:',
        ...code.split('\n').map(line => '            ' + line),
        '        except Exception as e:',
        '            print(f"ERROR: {type(e).__name__}: {e}", file=sys.stderr)',
        '            sys.exit(1)',
        '',
        '_restricted = _RestrictedExecution()',
        '_restricted.run()',
      ].join('\n');

      const child = spawn('python3', ['-c', wrappedCode], {
        timeout: Math.min(timeoutMs, 10000),
        killSignal: 'SIGKILL',
        env: { PYTHONDONTWRITEBYTECODE: '1', PATH: '/usr/bin:/bin' },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
        // Kill if output exceeds 100KB
        if (stdout.length > 100_000) {
          child.kill('SIGKILL');
          stdout = stdout.substring(0, 100_000) + '\n[output truncated]';
        }
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('error', (err: Error) => {
        clearTimeout(timeout);
        resolve({
          success: false,
          error: `Failed to start Python: ${err.message}`,
          errorType: 'runtime',
        });
      });

      child.on('close', (exitCode: number | null) => {
        clearTimeout(timeout);

        // Trim stdout to cap
        if (stdout.length > JS_MAX_OUTPUT_LENGTH) {
          stdout = stdout.substring(0, JS_MAX_OUTPUT_LENGTH) +
            `\n... [output truncated at ${JS_MAX_OUTPUT_LENGTH} chars]`;
        }

        if (exitCode === 0) {
          resolve({ success: true, output: stdout || '(no output)' });
        } else {
          resolve({
            success: false,
            output: stdout || undefined,
            error: stderr || `Process exited with code ${exitCode}`,
            errorType: 'runtime',
          });
        }
      });
    });
  }

  // ══════════════════════════════════════════════════════════
  // HTML Execution (Render)
  // ══════════════════════════════════════════════════════════

  private executeHtml(
    code: string,
  ): Pick<SandboxExecutionResult, 'success' | 'output' | 'error' | 'errorType'> {
    // For HTML, just return the markup — no execution needed
    // Sanitize script tags for security
    const sanitized = code
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '<!-- script removed for security -->')
      .replace(/javascript:/gi, '#disabled-javascript:');

    return {
      success: true,
      output: sanitized,
    };
  }

  // ══════════════════════════════════════════════════════════
  // Security Audit
  // ══════════════════════════════════════════════════════════

  /**
   * Audit code for security violations based on language.
   */
  auditCode(code: string, language: SandboxLanguage): SandboxSecurityAudit {
    const violations: string[] = [];

    switch (language) {
      case 'sql':
        for (const { pattern, message } of BLOCKED_SQL_PATTERNS) {
          if (pattern.test(code)) {
            violations.push(message);
          }
        }
        break;

      case 'javascript':
        for (const { pattern, message } of BLOCKED_JS_PATTERNS) {
          if (pattern.test(code)) {
            violations.push(message);
          }
        }
        break;

      case 'python':
        for (const { pattern, message } of BLOCKED_PYTHON_PATTERNS) {
          if (pattern.test(code)) {
            violations.push(message);
          }
        }
        break;

      case 'html':
        // HTML is validated during execution (script tags removed)
        break;
    }

    return {
      passed: violations.length === 0,
      violations,
    };
  }

  // ══════════════════════════════════════════════════════════
  // Prompt Builders
  // ══════════════════════════════════════════════════════════

  private buildGenerationSystemPrompt(language: SandboxLanguage): string {
    return `You are an expert code generator. Generate clean, well-commented ${language} code based on the user's description.\n\nRules:\n1. Output ONLY valid ${language} code wrapped in triple backticks with the language tag.\n2. After the code block, provide a brief explanation of what the code does.\n3. For SQL: always include WHERE business_id = '{{businessId}}' for row-level security.\n4. For JavaScript: use only console.log() for output. No require(), no imports, no network calls.\n5. For Python: use only standard library. No os, sys, subprocess, or network modules.\n6. Include comments explaining the logic.\n\nRespond in this format:\n\`\`\`${language}\n<your code here>\n\`\`\`\n\nExplanation: <brief explanation>`;
  }

  private buildGenerationUserPrompt(
    description: string,
    language: SandboxLanguage,
    availableTables?: string[],
    availableApis?: string[],
    examples?: string[],
  ): string {
    let prompt = `Generate ${language} code that does the following:\n\n${description}`;

    if (availableTables && availableTables.length > 0) {
      prompt += `\n\nAvailable database tables:\n${availableTables.map(t => `- ${t}`).join('\n')}`;
    }

    if (availableApis && availableApis.length > 0) {
      prompt += `\n\nAvailable APIs:\n${availableApis.map(a => `- ${a}`).join('\n')}`;
    }

    if (examples && examples.length > 0) {
      prompt += `\n\nExamples:\n${examples.map((e, i) => `Example ${i + 1}: ${e}`).join('\n')}`;
    }

    return prompt;
  }

  // ══════════════════════════════════════════════════════════
  // Response Parsers
  // ══════════════════════════════════════════════════════════

  private parseGeneratedCode(content: string): { code: string; explanation: string } {
    // Extract code from triple backticks
    const codeMatch = content.match(/```(?:\w+)?\n([\s\S]*?)```/);
    const code = codeMatch ? codeMatch[1].trim() : content.trim();

    // Extract explanation
    const explanationMatch = content.match(/Explanation:\s*(.+?)(?:\n|$)/is);
    const explanation = explanationMatch
      ? explanationMatch[1].trim()
      : 'Code generated successfully';

    return { code, explanation };
  }

  private parseExplanation(content: string): { explanation: string; warnings: string[]; suggestions: string[] } {
    try {
      const parsed = JSON.parse(content);
      return {
        explanation: parsed.explanation || 'No explanation provided',
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      };
    } catch {
      // Fallback: treat the whole content as explanation
      return {
        explanation: content,
        warnings: [],
        suggestions: [],
      };
    }
  }

  // ══════════════════════════════════════════════════════════
  // Syntax Validation
  // ══════════════════════════════════════════════════════════

  private validateSyntax(code: string, language: SandboxLanguage): boolean {
    switch (language) {
      case 'javascript': {
        try {
          // eslint-disable-next-line no-new-func
          new Function(code);
          return true;
        } catch {
          return false;
        }
      }
      case 'sql': {
        // Basic SQL validation: check for balanced parentheses and quotes
        let parenCount = 0;
        let inString = false;
        let stringChar = '';
        for (let i = 0; i < code.length; i++) {
          const ch = code[i];
          const prev = code[i - 1];
          if (!inString && (ch === "'" || ch === '"')) {
            inString = true;
            stringChar = ch;
          } else if (inString && ch === stringChar && prev !== '\\') {
            inString = false;
          } else if (!inString) {
            if (ch === '(') parenCount++;
            if (ch === ')') parenCount--;
            if (parenCount < 0) return false;
          }
        }
        return parenCount === 0 && !inString;
      }
      case 'python': {
        // Basic Python: check indentation consistency
        const lines = code.split('\n');
        let indentStack: number[] = [0];
        for (const line of lines) {
          if (!line.trim() || line.trim().startsWith('#')) continue;
          const leading = line.match(/^(\s*)/)?.[1].length ?? 0;
          if (leading > indentStack[indentStack.length - 1]) {
            indentStack.push(leading);
          } else {
            while (indentStack.length > 1 && leading < indentStack[indentStack.length - 1]) {
              indentStack.pop();
            }
            if (leading !== indentStack[indentStack.length - 1]) {
              return false;
            }
          }
        }
        return true;
      }
      case 'html': {
        // Basic HTML: check for DOCTYPE and html tag
        return code.toLowerCase().includes('<html') && code.toLowerCase().includes('</html>');
      }
      default:
        return true;
    }
  }

  // ══════════════════════════════════════════════════════════
  // Complexity Estimation
  // ══════════════════════════════════════════════════════════

  private estimateComplexity(code: string, language: SandboxLanguage): string {
    const lines = code.split('\n').filter(l => l.trim());
    const loops = (code.match(/\b(for|while)\b/g) || []).length;
    const conditions = (code.match(/\b(if|switch|case)\b/g) || []).length;
    const functions = (code.match(/\b(function|def|=>)\b/g) || []).length;

    const score = lines.length + loops * 2 + conditions + functions * 2;

    if (language === 'sql') {
      const joins = (code.match(/\bJOIN\b/gi) || []).length;
      const subqueries = (code.match(/\bSELECT\b/gi) || []).length - 1;
      const sqlScore = score + joins * 2 + subqueries * 3;

      if (sqlScore > 30) return 'high';
      if (sqlScore > 12) return 'medium';
      return 'low';
    }

    if (score > 50) return 'high';
    if (score > 20) return 'medium';
    return 'low';
  }

  // ══════════════════════════════════════════════════════════
  // Execution Logging
  // ══════════════════════════════════════════════════════════

  private async logExecution(
    businessId: string,
    userId: string | undefined,
    code: string,
    language: SandboxLanguage,
    success: boolean,
    errorType: string | undefined,
    executionTimeMs: number,
  ): Promise<void> {
    try {
      const codeHash = await this.hashCode(code);

      // Log to Prisma
      await this.prisma.client.sandboxExecutionLog.create({
        data: {
          businessId,
          userId: userId || null,
          language,
          codeHash,
          codePreview: code.substring(0, 500),
          success,
          errorType: errorType || null,
          executionTimeMs,
        } as any,
      }).catch(() => {
        // Silent catch — logging failures should not break execution
      });

      // Also cache recent execution result in Redis for quick lookup
      const cacheKey = `sandbox:result:${businessId}:${codeHash}`;
      await this.redis.setJson(
        cacheKey,
        { success, errorType, executionTimeMs, timestamp: Date.now() },
        3600, // 1 hour TTL
      ).catch(() => {
        // Silent catch — cache failures should not break execution
      });
    } catch {
      // Silent catch — logging failures should not break execution
    }
  }

  private async hashCode(code: string): Promise<string> {
    // Simple hash for logging/identification
    const crypto = await import('crypto');
    return crypto.createHash('sha256').update(code).digest('hex').substring(0, 16);
  }
}
