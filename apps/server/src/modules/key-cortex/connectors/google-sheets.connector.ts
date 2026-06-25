/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                      GOOGLE SHEETS CONNECTOR                              ║
 * ║        Read, write, and manage data in Google Sheets                      ║
 * ║  Production-hardened: 100/sec user rate limit, retries, health          ║
 * ║  checks, webhook security, sandbox mode                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

import { ExternalConnectorDefinition } from '../key-cortex-external-connector.types';

export const GoogleSheetsConnector: ExternalConnectorDefinition = {
  id: 'google_sheets',
  name: 'Google Sheets',
  description: 'Read, write, and manage data in Google Sheets spreadsheets',
  category: 'productivity',
  authType: 'oauth2',
  logoUrl: 'https://cdn.keyflow.io/connectors/google-sheets.svg',
  website: 'https://sheets.google.com',
  docsUrl: 'https://developers.google.com/sheets/api/reference/rest',
  baseUrl: 'https://sheets.googleapis.com/v4',
  supportsOAuth: true,
  oauthScopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive.readonly',
  ],
  defaultHeaders: {
    'Content-Type': 'application/json',
  },

  // ── Legacy rate limit (backward compatibility) ──────────────────────────
  rateLimit: {
    requestsPerWindow: 300,
    windowSeconds: 60,
    burstLimit: 60,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // PRODUCTION HARDENING
  // ══════════════════════════════════════════════════════════════════════════

  /** Rate limiting — Google Sheets: 100/sec per user, 500/sec per project */
  rateLimitHardened: {
    requestsPerSecond: 100,
    requestsPerMinute: 6000,
    requestsPerHour: 360000,
    burstAllowance: 60,
  },

  /** Retry configuration with exponential backoff + jitter */
  retryConfig: {
    maxRetries: 3,
    baseDelayMs: 500,
    maxDelayMs: 30000,
    retryableStatusCodes: [429, 500, 502, 503, 504],
    retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'],
  },

  /** Timeout configuration */
  timeoutConfig: {
    connectTimeoutMs: 10000,
    requestTimeoutMs: 30000,
    uploadTimeoutMs: 120000,
  },

  /** Health check endpoint */
  healthCheck: {
    endpoint: '/spreadsheets',
    method: 'GET',
    expectedStatus: 200,
  },

  /** Webhook security — Google uses push notifications via Cloud Pub/Sub */
  webhookSecurity: {
    signatureHeader: 'x-goog-signature',
    signatureAlgorithm: 'hmac-sha256',
    signatureFormat: 'hex',
    timestampHeader: 'x-goog-timestamp',
    timestampToleranceSeconds: 600,
  },

  /** Required OAuth scopes */
  requiredScopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive.readonly',
  ],

  /** Sandbox/test endpoints — Google doesn't have a separate sandbox */
  sandboxEndpoints: {
    baseUrl: 'https://sheets.googleapis.com/v4',
    authUrl: 'https://oauth2.googleapis.com/token',
  },

  // ══════════════════════════════════════════════════════════════════════════

  configSchema: [
    {
      name: 'clientId',
      type: 'string',
      label: 'Client ID',
      description: 'OAuth 2.0 Client ID from Google Cloud Console',
      required: true,
      placeholder: '123456789012-xxxxxxxxxxxxxxxx.apps.googleusercontent.com',
    },
    {
      name: 'clientSecret',
      type: 'password',
      label: 'Client Secret',
      description: 'OAuth 2.0 Client Secret from Google Cloud Console',
      required: true,
      placeholder: 'GOCSPX-xxxxxxxxxxxxxxxx',
      secret: true,
    },
    {
      name: 'refreshToken',
      type: 'password',
      label: 'Refresh Token',
      description: 'OAuth 2.0 refresh token',
      required: true,
      placeholder: '1//xxxxxxxxxxxxxxxx...',
      secret: true,
    },
    {
      name: 'defaultSpreadsheetId',
      type: 'string',
      label: 'Default Spreadsheet ID',
      description: 'Default spreadsheet to use (from URL)',
      required: false,
      placeholder: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
    },
    {
      name: 'defaultRange',
      type: 'string',
      label: 'Default Range',
      description: 'Default sheet/range to use (e.g., Sheet1!A1:Z1000)',
      required: false,
      placeholder: 'Sheet1!A1:Z1000',
    },
    {
      name: 'includeGridData',
      type: 'boolean',
      label: 'Include Grid Data',
      description: 'Include grid data in responses by default',
      required: false,
      defaultValue: 'false',
    },
  ],

  actions: [
    {
      name: 'get_sheet',
      description: 'Read values from a range in a spreadsheet',
      endpoint: '/spreadsheets/{spreadsheetId}/values/{range}',
      method: 'GET',
      category: 'read',
      requiredScope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      parameters: [
        {
          name: 'spreadsheetId',
          type: 'string',
          label: 'Spreadsheet ID',
          description: 'ID of the spreadsheet (from URL)',
          required: true,
          inPath: true,
        },
        {
          name: 'range',
          type: 'string',
          label: 'Range',
          description: 'A1 notation range (e.g., Sheet1!A1:D10)',
          required: true,
          inPath: true,
        },
        {
          name: 'valueRenderOption',
          type: 'string',
          label: 'Value Render Option',
          description: 'How values should be rendered',
          required: false,
          defaultValue: 'FORMATTED_VALUE',
          inQuery: true,
          options: [
            { label: 'Formatted Value', value: 'FORMATTED_VALUE' },
            { label: 'Unformatted Value', value: 'UNFORMATTED_VALUE' },
            { label: 'Formula', value: 'FORMULA' },
          ],
        },
        {
          name: 'dateTimeRenderOption',
          type: 'string',
          label: 'Date/Time Render Option',
          description: 'How dates should be rendered',
          required: false,
          defaultValue: 'SERIAL_NUMBER',
          inQuery: true,
          options: [
            { label: 'Serial Number', value: 'SERIAL_NUMBER' },
            { label: 'Formatted String', value: 'FORMATTED_STRING' },
          ],
        },
        {
          name: 'majorDimension',
          type: 'string',
          label: 'Major Dimension',
          description: 'Whether data is organized by rows or columns',
          required: false,
          defaultValue: 'ROWS',
          inQuery: true,
          options: [
            { label: 'Rows', value: 'ROWS' },
            { label: 'Columns', value: 'COLUMNS' },
          ],
        },
      ],
      returns: '$.range, $.majorDimension, $.values[][]',
    },
    {
      name: 'get_sheet_metadata',
      description: 'Get metadata about a spreadsheet including sheets list',
      endpoint: '/spreadsheets/{spreadsheetId}',
      method: 'GET',
      category: 'read',
      requiredScope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      parameters: [
        {
          name: 'spreadsheetId',
          type: 'string',
          label: 'Spreadsheet ID',
          description: 'ID of the spreadsheet',
          required: true,
          inPath: true,
        },
        {
          name: 'includeGridData',
          type: 'boolean',
          label: 'Include Grid Data',
          description: 'Include grid data in response',
          required: false,
          defaultValue: false,
          inQuery: true,
        },
      ],
      returns: '$.properties.title, $.sheets[*].properties.title, $.sheets[*].properties.sheetId, $.sheets[*].properties.gridProperties',
    },
    {
      name: 'update_cell',
      description: 'Update a single cell or range of values',
      endpoint: '/spreadsheets/{spreadsheetId}/values/{range}',
      method: 'PUT',
      category: 'write',
      requiredScope: 'https://www.googleapis.com/auth/spreadsheets',
      parameters: [
        {
          name: 'spreadsheetId',
          type: 'string',
          label: 'Spreadsheet ID',
          description: 'ID of the spreadsheet',
          required: true,
          inPath: true,
        },
        {
          name: 'range',
          type: 'string',
          label: 'Range',
          description: 'A1 notation range to update (e.g., Sheet1!A1)',
          required: true,
          inPath: true,
        },
        {
          name: 'values',
          type: 'json',
          label: 'Values',
          description: '2D array of values to write [["A1","B1"],["A2","B2"]]',
          required: true,
          inBody: true,
        },
        {
          name: 'valueInputOption',
          type: 'string',
          label: 'Value Input Option',
          description: 'How input data should be interpreted',
          required: false,
          defaultValue: 'USER_ENTERED',
          inQuery: true,
          options: [
            { label: 'User Entered', value: 'USER_ENTERED' },
            { label: 'Raw', value: 'RAW' },
          ],
        },
        {
          name: 'includeValuesInResponse',
          type: 'boolean',
          label: 'Include Values in Response',
          description: 'Return updated values in response',
          required: false,
          defaultValue: true,
          inQuery: true,
        },
      ],
      returns: '$.updatedRange, $.updatedRows, $.updatedColumns, $.updatedCells, $.updatedData',
      examplePayload: {
        values: [['Updated Value']],
      },
    },
    {
      name: 'append_row',
      description: 'Append a row of data to the end of a range',
      endpoint: '/spreadsheets/{spreadsheetId}/values/{range}:append',
      method: 'POST',
      category: 'write',
      requiredScope: 'https://www.googleapis.com/auth/spreadsheets',
      parameters: [
        {
          name: 'spreadsheetId',
          type: 'string',
          label: 'Spreadsheet ID',
          description: 'ID of the spreadsheet',
          required: true,
          inPath: true,
        },
        {
          name: 'range',
          type: 'string',
          label: 'Range',
          description: 'A1 notation of the table range (e.g., Sheet1!A1:E)',
          required: true,
          inPath: true,
        },
        {
          name: 'values',
          type: 'json',
          label: 'Values',
          description: '2D array with the row to append',
          required: true,
          inBody: true,
        },
        {
          name: 'valueInputOption',
          type: 'string',
          label: 'Value Input Option',
          description: 'How input data should be interpreted',
          required: false,
          defaultValue: 'USER_ENTERED',
          inQuery: true,
          options: [
            { label: 'User Entered', value: 'USER_ENTERED' },
            { label: 'Raw', value: 'RAW' },
          ],
        },
        {
          name: 'insertDataOption',
          type: 'string',
          label: 'Insert Data Option',
          description: 'How the input should be inserted',
          required: false,
          defaultValue: 'INSERT_ROWS',
          inQuery: true,
          options: [
            { label: 'Insert Rows', value: 'INSERT_ROWS' },
            { label: 'Overwrite', value: 'OVERWRITE' },
          ],
        },
        {
          name: 'includeValuesInResponse',
          type: 'boolean',
          label: 'Include Values in Response',
          description: 'Return appended values in response',
          required: false,
          defaultValue: true,
          inQuery: true,
        },
      ],
      returns: '$.updates.updatedRange, $.updates.updatedRows, $.tableRange',
      examplePayload: {
        values: [['John Doe', 'john@example.com', '2024-01-15', 'Active']],
      },
    },
    {
      name: 'create_sheet',
      description: 'Create a new spreadsheet',
      endpoint: '/spreadsheets',
      method: 'POST',
      category: 'management',
      requiredScope: 'https://www.googleapis.com/auth/spreadsheets',
      parameters: [
        {
          name: 'properties',
          type: 'json',
          label: 'Spreadsheet Properties',
          description: 'Spreadsheet properties including title',
          required: true,
          inBody: true,
        },
        {
          name: 'sheets',
          type: 'json',
          label: 'Sheets',
          description: 'Array of sheet objects to create',
          required: false,
          inBody: true,
        },
      ],
      returns: '$.spreadsheetId, $.properties.title, $.spreadsheetUrl, $.sheets[*].properties.title',
      examplePayload: {
        properties: { title: 'My New Spreadsheet' },
        sheets: [{ properties: { title: 'Sheet1' } }],
      },
    },
    {
      name: 'clear_range',
      description: 'Clear values from a range',
      endpoint: '/spreadsheets/{spreadsheetId}/values/{range}:clear',
      method: 'POST',
      category: 'write',
      requiredScope: 'https://www.googleapis.com/auth/spreadsheets',
      parameters: [
        {
          name: 'spreadsheetId',
          type: 'string',
          label: 'Spreadsheet ID',
          description: 'ID of the spreadsheet',
          required: true,
          inPath: true,
        },
        {
          name: 'range',
          type: 'string',
          label: 'Range',
          description: 'A1 notation range to clear',
          required: true,
          inPath: true,
        },
      ],
      returns: '$.clearedRange',
    },
    {
      name: 'batch_get',
      description: 'Read values from multiple ranges at once',
      endpoint: '/spreadsheets/{spreadsheetId}/values:batchGet',
      method: 'GET',
      category: 'read',
      requiredScope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      parameters: [
        {
          name: 'spreadsheetId',
          type: 'string',
          label: 'Spreadsheet ID',
          description: 'ID of the spreadsheet',
          required: true,
          inPath: true,
        },
        {
          name: 'ranges',
          type: 'string',
          label: 'Ranges',
          description: 'Comma-separated A1 notation ranges',
          required: true,
          inQuery: true,
        },
        {
          name: 'valueRenderOption',
          type: 'string',
          label: 'Value Render Option',
          description: 'How values should be rendered',
          required: false,
          defaultValue: 'FORMATTED_VALUE',
          inQuery: true,
          options: [
            { label: 'Formatted Value', value: 'FORMATTED_VALUE' },
            { label: 'Unformatted Value', value: 'UNFORMATTED_VALUE' },
            { label: 'Formula', value: 'FORMULA' },
          ],
        },
        {
          name: 'majorDimension',
          type: 'string',
          label: 'Major Dimension',
          description: 'Whether data is organized by rows or columns',
          required: false,
          defaultValue: 'ROWS',
          inQuery: true,
          options: [
            { label: 'Rows', value: 'ROWS' },
            { label: 'Columns', value: 'COLUMNS' },
          ],
        },
      ],
      returns: '$.valueRanges[*].range, $.valueRanges[*].values[][]',
    },
    {
      name: 'batch_update',
      description: 'Update values in multiple ranges at once',
      endpoint: '/spreadsheets/{spreadsheetId}/values:batchUpdate',
      method: 'POST',
      category: 'write',
      requiredScope: 'https://www.googleapis.com/auth/spreadsheets',
      parameters: [
        {
          name: 'spreadsheetId',
          type: 'string',
          label: 'Spreadsheet ID',
          description: 'ID of the spreadsheet',
          required: true,
          inPath: true,
        },
        {
          name: 'data',
          type: 'json',
          label: 'Data',
          description: 'Array of {range, values} objects to update',
          required: true,
          inBody: true,
        },
        {
          name: 'valueInputOption',
          type: 'string',
          label: 'Value Input Option',
          description: 'How input data should be interpreted',
          required: false,
          defaultValue: 'USER_ENTERED',
          inQuery: true,
          options: [
            { label: 'User Entered', value: 'USER_ENTERED' },
            { label: 'Raw', value: 'RAW' },
          ],
        },
        {
          name: 'includeValuesInResponse',
          type: 'boolean',
          label: 'Include Values in Response',
          description: 'Return updated values',
          required: false,
          defaultValue: true,
          inQuery: true,
        },
      ],
      returns: '$.totalUpdatedCells, $.totalUpdatedColumns, $.totalUpdatedRows, $.responses[*].updatedRange',
      examplePayload: {
        data: [
          { range: 'Sheet1!A1', values: [['Header 1']] },
          { range: 'Sheet1!B1', values: [['Header 2']] },
        ],
      },
    },
    {
      name: 'add_sheet',
      description: 'Add a new sheet to an existing spreadsheet',
      endpoint: '/spreadsheets/{spreadsheetId}:batchUpdate',
      method: 'POST',
      category: 'management',
      requiredScope: 'https://www.googleapis.com/auth/spreadsheets',
      parameters: [
        {
          name: 'spreadsheetId',
          type: 'string',
          label: 'Spreadsheet ID',
          description: 'ID of the spreadsheet',
          required: true,
          inPath: true,
        },
        {
          name: 'title',
          type: 'string',
          label: 'Sheet Title',
          description: 'Title for the new sheet',
          required: true,
          inBody: true,
        },
        {
          name: 'rowCount',
          type: 'number',
          label: 'Row Count',
          description: 'Number of rows for the new sheet',
          required: false,
          defaultValue: 1000,
          inBody: true,
        },
        {
          name: 'columnCount',
          type: 'number',
          label: 'Column Count',
          description: 'Number of columns for the new sheet',
          required: false,
          defaultValue: 26,
          inBody: true,
        },
      ],
      returns: '$.replies[0].addSheet.properties.sheetId, $.replies[0].addSheet.properties.title',
    },
    {
      name: 'delete_sheet',
      description: 'Delete a sheet from a spreadsheet',
      endpoint: '/spreadsheets/{spreadsheetId}:batchUpdate',
      method: 'POST',
      category: 'management',
      requiredScope: 'https://www.googleapis.com/auth/spreadsheets',
      parameters: [
        {
          name: 'spreadsheetId',
          type: 'string',
          label: 'Spreadsheet ID',
          description: 'ID of the spreadsheet',
          required: true,
          inPath: true,
        },
        {
          name: 'sheetId',
          type: 'number',
          label: 'Sheet ID',
          description: 'Numeric ID of the sheet to delete',
          required: true,
          inBody: true,
        },
      ],
      returns: '$.replies[0].deleteSheet',
    },
  ],

  triggers: [
    {
      name: 'sheet_edited',
      description: 'Triggered when a spreadsheet is edited (via push notifications)',
      eventType: 'sheets.edit',
      payloadSchema: {
        spreadsheetId: 'string',
        kind: 'string',
        start: 'object',
        end: 'object',
        updatedCells: 'number?',
        updatedColumns: 'number?',
        updatedRows: 'number?',
      },
      examplePayload: {
        spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
        kind: 'drive#change',
        start: { sheetId: 0, row: 1, column: 1 },
        end: { sheetId: 0, row: 5, column: 3 },
      },
      isPremium: true,
    },
    {
      name: 'form_submitted',
      description: 'Triggered when a Google Form response is submitted (linked to sheet)',
      eventType: 'forms.submit',
      payloadSchema: {
        spreadsheetId: 'string',
        range: 'string',
        values: 'array',
        timestamp: 'string',
      },
    },
  ],
};
