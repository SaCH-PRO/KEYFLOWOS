// ============================================================
// KEY Cortex — Code Sandbox Type Definitions
// Types for the code generation and execution sandbox system
// that lets KEY write and execute custom code to solve
// any business problem.
// ============================================================

// ─────────────────────────────────────────────────────────────
// Supported sandbox languages
// ─────────────────────────────────────────────────────────────

export type SandboxLanguage = 'javascript' | 'python' | 'sql' | 'html';

// ─────────────────────────────────────────────────────────────
// Code execution request
// ─────────────────────────────────────────────────────────────

export interface SandboxExecutionRequest {
  /** Raw code string to execute */
  code: string;
  /** Language of the code */
  language: SandboxLanguage;
  /** Execution context with business scope and variables */
  context?: {
    businessId: string;
    userId: string;
    variables?: Record<string, unknown>;
    databaseAccess?: boolean;
    apiAccess?: boolean;
  };
  /** Execution timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Memory limit in megabytes (default: 128) */
  memoryLimitMb?: number;
}

// ─────────────────────────────────────────────────────────────
// Code generation request
// ─────────────────────────────────────────────────────────────

export interface SandboxGenerationRequest {
  /** Natural language description of what code should do */
  description: string;
  /** Target language for the generated code */
  language: SandboxLanguage;
  /** Context about available resources */
  context?: {
    businessId: string;
    availableTables?: string[];
    availableApis?: string[];
  };
  /** Example inputs/outputs to guide generation */
  examples?: string[];
}

// ─────────────────────────────────────────────────────────────
// Execution result
// ─────────────────────────────────────────────────────────────

export interface SandboxExecutionResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Captured output (stdout, result JSON, HTML, etc.) */
  output?: string;
  /** Error message if execution failed */
  error?: string;
  /** Classification of the error */
  errorType?: 'timeout' | 'memory' | 'runtime' | 'syntax' | 'security';
  /** Actual execution time in milliseconds */
  executionTimeMs: number;
  /** Memory used during execution in megabytes */
  memoryUsedMb?: number;
  /** Language that was executed */
  language: SandboxLanguage;
  /** The code that was executed */
  code: string;
  /** True if the code was AI-generated */
  generatedCode?: boolean;
}

// ─────────────────────────────────────────────────────────────
// Code template definition
// ─────────────────────────────────────────────────────────────

export interface CodeTemplate {
  /** Unique template identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what the template does */
  description: string;
  /** Language of the template code */
  language: SandboxLanguage;
  /** Template code with {{parameter}} placeholders */
  code: string;
  /** Parameter definitions for substitution */
  parameters: Array<{
    name: string;
    type: string;
    description: string;
    required: boolean;
  }>;
  /** Category for grouping */
  category: 'report' | 'automation' | 'integration' | 'utility' | 'analysis';
  /** Tags for filtering and discovery */
  tags: string[];
}

// ─────────────────────────────────────────────────────────────
// Template library
// ─────────────────────────────────────────────────────────────

export interface CodeTemplateLibrary {
  /** All available templates */
  templates: CodeTemplate[];
  /** Unique categories across all templates */
  categories: string[];
}

// ─────────────────────────────────────────────────────────────
// Code generation response
// ─────────────────────────────────────────────────────────────

export interface SandboxGenerationResult {
  /** Generated code */
  code: string;
  /** Human-readable explanation of the generated code */
  explanation: string;
  /** Language of the generated code */
  language: SandboxLanguage;
  /** Whether basic syntax validation passed */
  syntaxValid: boolean;
  /** Estimated complexity (low/medium/high) */
  complexity: string;
}

// ─────────────────────────────────────────────────────────────
// Template application parameters
// ─────────────────────────────────────────────────────────────

export interface TemplateApplyParams {
  /** Template ID to apply */
  templateId: string;
  /** Parameter values to substitute into {{placeholders}} */
  parameters: Record<string, string | number | boolean>;
  /** Execution context */
  context?: {
    businessId: string;
    userId: string;
    databaseAccess?: boolean;
    apiAccess?: boolean;
  };
  timeoutMs?: number;
  memoryLimitMb?: number;
}

// ─────────────────────────────────────────────────────────────
// Code explanation response
// ─────────────────────────────────────────────────────────────

export interface CodeExplanationResult {
  /** Human-readable explanation */
  explanation: string;
  /** Detected language */
  language: SandboxLanguage;
  /** Potential risks or security concerns */
  warnings: string[];
  /** Suggested improvements */
  suggestions: string[];
}

// ─────────────────────────────────────────────────────────────
// Sandbox security audit result
// ─────────────────────────────────────────────────────────────

export interface SandboxSecurityAudit {
  /** Whether the code passed security checks */
  passed: boolean;
  /** List of security violations found */
  violations: string[];
  /** Sanitized version of the code (if applicable) */
  sanitizedCode?: string;
}
