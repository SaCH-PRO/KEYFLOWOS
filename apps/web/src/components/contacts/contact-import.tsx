"use client";

import { useState, useRef, useCallback, DragEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  Link2,
  FileSpreadsheet,
  ChevronDown,
  ChevronUp,
  X,
  FileText,
  Download,
  CheckCircle2,
  AlertCircle,
  Chrome,
  ArrowLeft,
  ArrowRight,
  Table,
} from "lucide-react";
import { getGoogleContactsAuthUrl, checkImportDuplicates } from "@/lib/client";
import { toast } from "sonner";

type ImportMethod = "file" | "url" | "google";
type FileType = "csv" | "xlsx" | "vcf";

interface ContactImportProps {
  onImportFile: (type: FileType | "image", file: File) => Promise<void>;
  onImportLink: (url: string) => Promise<void>;
  loading?: boolean;
  businessId?: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const CONTACT_FIELDS = [
  { key: "firstName", label: "First Name" },
  { key: "lastName", label: "Last Name" },
  { key: "displayName", label: "Display Name" },
  { key: "email", label: "Email" },
  { key: "secondaryEmail", label: "Secondary Email" },
  { key: "phone", label: "Phone" },
  { key: "secondaryPhone", label: "Secondary Phone" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "status", label: "Status" },
  { key: "companyName", label: "Company" },
  { key: "jobTitle", label: "Job Title" },
  { key: "department", label: "Department" },
  { key: "industry", label: "Industry" },
  { key: "segment", label: "Segment" },
  { key: "address", label: "Address" },
  { key: "addressLine2", label: "Address Line 2" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "postalCode", label: "Postal Code" },
  { key: "country", label: "Country" },
  { key: "timezone", label: "Timezone" },
  { key: "preferredChannel", label: "Preferred Channel" },
  { key: "language", label: "Language" },
  { key: "lifecycleStage", label: "Lifecycle Stage" },
  { key: "tags", label: "Tags" },
  { key: "marketingOptIn", label: "Marketing Opt-In" },
  { key: "doNotContact", label: "Do Not Contact" },
  { key: "notes", label: "Notes" },
] as const;

const HEADER_ALIASES: Record<string, string> = {
  "first name": "firstName",
  "first_name": "firstName",
  "firstname": "firstName",
  "given name": "firstName",
  "givenname": "firstName",
  "last name": "lastName",
  "last_name": "lastName",
  "lastname": "lastName",
  "surname": "lastName",
  "family name": "lastName",
  "familyname": "lastName",
  "display name": "displayName",
  "display_name": "displayName",
  "displayname": "displayName",
  "full name": "displayName",
  "fullname": "displayName",
  "name": "displayName",
  "email": "email",
  "e-mail": "email",
  "email address": "email",
  "email_address": "email",
  "emailaddress": "email",
  "primary email": "email",
  "secondary email": "secondaryEmail",
  "secondary_email": "secondaryEmail",
  "secondaryemail": "secondaryEmail",
  "other email": "secondaryEmail",
  "phone": "phone",
  "phone number": "phone",
  "phone_number": "phone",
  "phonenumber": "phone",
  "telephone": "phone",
  "tel": "phone",
  "mobile": "phone",
  "cell": "phone",
  "cell phone": "phone",
  "primary phone": "phone",
  "secondary phone": "secondaryPhone",
  "secondary_phone": "secondaryPhone",
  "secondaryphone": "secondaryPhone",
  "other phone": "secondaryPhone",
  "home phone": "secondaryPhone",
  "work phone": "secondaryPhone",
  "whatsapp": "whatsapp",
  "whats app": "whatsapp",
  "status": "status",
  "contact status": "status",
  "company": "companyName",
  "organization": "companyName",
  "org": "companyName",
  "company name": "companyName",
  "company_name": "companyName",
  "job title": "jobTitle",
  "job_title": "jobTitle",
  "jobtitle": "jobTitle",
  "title": "jobTitle",
  "position": "jobTitle",
  "role": "jobTitle",
  "department": "department",
  "dept": "department",
  "industry": "industry",
  "segment": "segment",
  "address": "address",
  "street": "address",
  "street address": "address",
  "address line 1": "address",
  "address_line_1": "address",
  "address line 2": "addressLine2",
  "address_line_2": "addressLine2",
  "addressline2": "addressLine2",
  "apt": "addressLine2",
  "suite": "addressLine2",
  "city": "city",
  "town": "city",
  "state": "state",
  "province": "state",
  "region": "state",
  "postal code": "postalCode",
  "postal_code": "postalCode",
  "postalcode": "postalCode",
  "zip": "postalCode",
  "zip code": "postalCode",
  "zipcode": "postalCode",
  "country": "country",
  "timezone": "timezone",
  "time zone": "timezone",
  "time_zone": "timezone",
  "preferred channel": "preferredChannel",
  "preferred_channel": "preferredChannel",
  "preferredchannel": "preferredChannel",
  "channel": "preferredChannel",
  "language": "language",
  "lang": "language",
  "lifecycle stage": "lifecycleStage",
  "lifecycle_stage": "lifecycleStage",
  "lifecyclestage": "lifecycleStage",
  "stage": "lifecycleStage",
  "tags": "tags",
  "tag": "tags",
  "labels": "tags",
  "marketing opt-in": "marketingOptIn",
  "marketing_opt_in": "marketingOptIn",
  "marketingoptin": "marketingOptIn",
  "opt in": "marketingOptIn",
  "optin": "marketingOptIn",
  "do not contact": "doNotContact",
  "do_not_contact": "doNotContact",
  "donotcontact": "doNotContact",
  "dnc": "doNotContact",
  "notes": "notes",
  "note": "notes",
  "comments": "notes",
  "comment": "notes",
};

interface MappingState {
  headers: string[];
  previewRows: string[][];
  mapping: Record<string, string>;
}

const CSV_TEMPLATE = `firstName,lastName,displayName,email,secondaryEmail,phone,secondaryPhone,whatsapp,status,companyName,jobTitle,department,industry,segment,address,addressLine2,city,state,postalCode,country,timezone,preferredChannel,language,lifecycleStage,tags,marketingOptIn,doNotContact,notes
John,Doe,Johnny D,john@example.com,john.personal@mail.com,+1868123456,+1868111222,+1868123456,LEAD,Acme Corp,Marketing Manager,Marketing,Technology,Enterprise,123 Main Street,Suite 4,Port of Spain,Trinidad,00100,Trinidad,America/Port_of_Spain,whatsapp,en,Awareness,"vip,tech",Yes,No,Key decision maker
Jane,Smith,,jane@example.com,,+1868654321,,,PROSPECT,Tech Inc,CEO,,Services,SMB,456 Oak Avenue,,San Fernando,Trinidad,,Trinidad,,email,en,Consideration,local,Yes,No,`;

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSVContent(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1, 4).map(parseCSVLine);
  return { headers, rows };
}

function autoMatchHeaders(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const usedFields = new Set<string>();

  for (const header of headers) {
    const normalized = header.toLowerCase().trim();
    const exactMatch = CONTACT_FIELDS.find((f) => f.key.toLowerCase() === normalized);
    if (exactMatch && !usedFields.has(exactMatch.key)) {
      mapping[header] = exactMatch.key;
      usedFields.add(exactMatch.key);
      continue;
    }
    const aliasMatch = HEADER_ALIASES[normalized];
    if (aliasMatch && !usedFields.has(aliasMatch)) {
      mapping[header] = aliasMatch;
      usedFields.add(aliasMatch);
      continue;
    }
    mapping[header] = "";
  }

  return mapping;
}

export function ContactImport({ onImportFile, onImportLink, loading, businessId }: ContactImportProps) {
  const [expanded, setExpanded] = useState(false);
  const [method, setMethod] = useState<ImportMethod>("file");
  const [fileType, setFileType] = useState<FileType>("csv");
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [mappingState, setMappingState] = useState<MappingState | null>(null);
  const [parsingFile, setParsingFile] = useState(false);
  const [duplicateResult, setDuplicateResult] = useState<{
    total: number;
    newCount: number;
    duplicateCount: number;
    duplicates: Array<{
      importIndex: number;
      importContact: { email?: string; phone?: string; firstName?: string; lastName?: string };
      existingContact: { id: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null };
      matchField: 'email' | 'phone';
    }>;
  } | null>(null);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [skipDuplicates, setSkipDuplicates] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleGoogleConnect = async () => {
    setGoogleLoading(true);
    try {
      const result = await getGoogleContactsAuthUrl(businessId);
      if (result?.data?.url) {
        window.location.href = result.data.url;
      } else {
        toast.error("Could not get Google authorization URL");
      }
    } catch {
      toast.error("Failed to start Google connection");
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const validateFileSize = (f: File): boolean => {
    if (f.size > MAX_FILE_SIZE) {
      setSizeError(`File is ${formatFileSize(f.size)}. Maximum allowed size is 10MB.`);
      return false;
    }
    setSizeError(null);
    return true;
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      if (!validateFileSize(droppedFile)) return;
      const ext = droppedFile.name.split(".").pop()?.toLowerCase();
      if (ext === "csv") setFileType("csv");
      else if (ext === "xlsx" || ext === "xls") setFileType("xlsx");
      else if (ext === "vcf") setFileType("vcf");
      setFile(droppedFile);
      setMappingState(null);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (!validateFileSize(selectedFile)) return;
      setSizeError(null);
      setFile(selectedFile);
      setMappingState(null);
    }
  };

  const parseFileForMapping = useCallback(async () => {
    if (!file) return;
    setParsingFile(true);
    try {
      const text = await file.text();
      const { headers, rows } = parseCSVContent(text);
      if (headers.length === 0) {
        setSizeError("Could not parse file headers. Please check your file format.");
        setParsingFile(false);
        return;
      }
      const mapping = autoMatchHeaders(headers);
      setMappingState({ headers, previewRows: rows, mapping });
    } catch {
      setSizeError("Failed to read file. Please ensure it is a valid CSV.");
    } finally {
      setParsingFile(false);
    }
  }, [file]);

  const handleCheckDuplicates = useCallback(async () => {
    if (!file || !mappingState || !businessId) return;
    setCheckingDuplicates(true);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      const allRows = lines.slice(1).map(parseCSVLine);
      const contacts = allRows.slice(0, 100).map((row) => {
        const contact: Record<string, string> = {};
        mappingState.headers.forEach((header, idx) => {
          const field = mappingState.mapping[header];
          if (field && row[idx]) {
            contact[field] = row[idx];
          }
        });
        return {
          email: contact.email,
          phone: contact.phone,
          firstName: contact.firstName,
          lastName: contact.lastName,
        };
      });
      const result = await checkImportDuplicates(businessId, contacts);
      if (result.data) {
        setDuplicateResult(result.data);
      } else {
        setDuplicateResult(null);
        toast.info("Could not check duplicates. You can proceed with import.");
      }
    } catch {
      toast.error("Failed to check duplicates");
      setDuplicateResult(null);
    } finally {
      setCheckingDuplicates(false);
    }
  }, [file, mappingState, businessId]);

  const handleFileImport = async () => {
    if (!file) return;
    try {
      await onImportFile(fileType, file);
      toast.success("Contacts imported successfully");
      setFile(null);
      setMappingState(null);
      setDuplicateResult(null);
      setSkipDuplicates(false);
      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed";
      toast.error(msg);
    }
  };

  const handleLinkImport = async () => {
    if (!link.trim()) return;
    try {
      await onImportLink(link.trim());
      toast.success("Contacts imported from URL");
      setLink("");
      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import from URL failed";
      toast.error(msg);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "contacts_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const mappedCount = mappingState
    ? Object.values(mappingState.mapping).filter((v) => v !== "").length
    : 0;

  const showMappingStep = fileType === "csv" && mappingState !== null;

  return (
    <div className="kf-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[hsl(var(--kf-accent1))]/10">
            <Upload className="w-5 h-5 text-[hsl(var(--kf-accent1))]" />
          </div>
          <div className="text-left">
            <span className="font-medium">Import Contacts</span>
            <p className="text-xs text-muted-foreground">CSV, Excel, vCard, Google, or URL</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {uploadSuccess && (
            <span className="flex items-center gap-1 text-xs text-green-500">
              <CheckCircle2 className="w-4 h-4" />
              Imported!
            </span>
          )}
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-5 h-5 text-muted-foreground" />
          )}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-border"
          >
            <div className="flex border-b border-border overflow-x-auto">
              {[
                { key: "file" as const, label: "Upload File", icon: FileSpreadsheet },
                { key: "google" as const, label: "Google", icon: Chrome },
                { key: "url" as const, label: "From URL", icon: Link2 },
              ].map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setMethod(key)}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-3 text-sm font-medium transition-all border-b-2 whitespace-nowrap ${
                    method === key
                      ? "border-[hsl(var(--kf-accent1))] text-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))]/5"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>

            <div className="p-4">
              {method === "file" && (
                <div className="space-y-4">
                  {!showMappingStep && (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="flex gap-2">
                          {(["csv", "xlsx", "vcf"] as const).map((type) => (
                            <button
                              key={type}
                              onClick={() => {
                                setFileType(type);
                                setFile(null);
                                setMappingState(null);
                                setSizeError(null);
                              }}
                              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                                fileType === type
                                  ? "bg-[hsl(var(--kf-accent1))] text-white"
                                  : "bg-muted text-muted-foreground hover:bg-muted/80"
                              }`}
                            >
                              {type === "vcf" ? "vCard" : type.toUpperCase()}
                            </button>
                          ))}
                        </div>
                        {fileType !== "vcf" && (
                          <button
                            onClick={downloadTemplate}
                            className="flex items-center gap-1.5 text-xs text-[hsl(var(--kf-accent2))] hover:underline"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Download Template
                          </button>
                        )}
                      </div>

                      <div
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className={`relative flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
                          isDragging
                            ? "border-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))]/10"
                            : file
                            ? "border-green-500/50 bg-green-500/5"
                            : "border-border hover:border-[hsl(var(--kf-accent1))]/50 hover:bg-muted/30"
                        }`}
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept={fileType === "csv" ? ".csv" : fileType === "xlsx" ? ".xlsx,.xls" : ".vcf"}
                          onChange={handleFileSelect}
                          className="hidden"
                        />
                        
                        {file ? (
                          <>
                            <div className="flex items-center gap-3 p-3 bg-background rounded-lg border border-border">
                              <FileText className="w-8 h-8 text-[hsl(var(--kf-accent1))]" />
                              <div className="text-left">
                                <p className="font-medium text-sm">{file.name}</p>
                                <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFile(null);
                                  setSizeError(null);
                                }}
                                className="p-1 hover:bg-muted rounded-full transition-colors"
                              >
                                <X className="w-4 h-4 text-muted-foreground" />
                              </button>
                            </div>
                            <p className="text-xs text-muted-foreground">Click to change file or drag a new one</p>
                          </>
                        ) : (
                          <>
                            <div className="p-3 rounded-full bg-muted">
                              <Upload className="w-6 h-6 text-muted-foreground" />
                            </div>
                            <div className="text-center">
                              <p className="font-medium">
                                {isDragging ? "Drop file here" : "Drag & drop or click to upload"}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">
                                Supports {fileType.toUpperCase()} files up to 10MB
                              </p>
                            </div>
                          </>
                        )}
                      </div>

                      {sizeError && (
                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                          <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            {sizeError}
                          </p>
                        </div>
                      )}

                      <div className="p-3 rounded-lg bg-muted/50 border border-border">
                        <p className="text-xs text-muted-foreground flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <span>
                            {fileType === "vcf" ? (
                              <>
                                <strong>vCard files</strong> (.vcf) are exported from your phone&apos;s Contacts app, Google Contacts, or Outlook. 
                                They can contain single or multiple contacts.
                              </>
                            ) : (
                              <>
                                Your file should have columns: <strong>firstName</strong>, <strong>lastName</strong>, <strong>email</strong>, <strong>phone</strong>, <strong>companyName</strong>, <strong>address</strong>, <strong>city</strong>, <strong>country</strong>, <strong>status</strong>. 
                                Download the template for the correct format.
                              </>
                            )}
                          </span>
                        </p>
                      </div>

                      {fileType === "csv" && file ? (
                        <button
                          onClick={parseFileForMapping}
                          disabled={!file || parsingFile}
                          className="kf-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                          {parsingFile ? (
                            "Parsing file..."
                          ) : (
                            <>
                              <Table className="w-4 h-4" />
                              Map Fields
                              <ArrowRight className="w-4 h-4" />
                            </>
                          )}
                        </button>
                      ) : (
                        <button
                          onClick={handleFileImport}
                          disabled={!file || loading}
                          className="kf-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {loading ? "Importing..." : `Import ${file ? file.name.split(".")[0] : "Contacts"}`}
                        </button>
                      )}
                    </>
                  )}

                  {showMappingStep && mappingState && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <button
                          onClick={() => setMappingState(null)}
                          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <ArrowLeft className="w-4 h-4" />
                          Back
                        </button>
                        <div className="flex items-center gap-2 text-sm">
                          <FileText className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                          <span className="font-medium">{file?.name}</span>
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-[hsl(var(--kf-accent1))]/5 border border-[hsl(var(--kf-accent1))]/20">
                        <p className="text-sm font-medium flex items-center gap-2">
                          <Table className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                          Map your columns to contact fields
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {mappedCount} of {mappingState.headers.length} columns mapped
                        </p>
                      </div>

                      <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                        {mappingState.headers.map((header) => {
                          const sampleValues = mappingState.previewRows
                            .map((row) => {
                              const idx = mappingState.headers.indexOf(header);
                              return row[idx] || "";
                            })
                            .filter(Boolean)
                            .slice(0, 2);

                          return (
                            <div
                              key={header}
                              className="flex items-center gap-3 p-2.5 rounded-lg border border-border bg-background"
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{header}</p>
                                {sampleValues.length > 0 && (
                                  <p className="text-xs text-muted-foreground truncate">
                                    e.g. {sampleValues.join(", ")}
                                  </p>
                                )}
                              </div>
                              <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                              <select
                                value={mappingState.mapping[header] || ""}
                                onChange={(e) => {
                                  setMappingState((prev) => {
                                    if (!prev) return prev;
                                    return {
                                      ...prev,
                                      mapping: { ...prev.mapping, [header]: e.target.value },
                                    };
                                  });
                                }}
                                className="flex-1 min-w-0 text-sm rounded-md border border-border bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]"
                              >
                                <option value="">-- Skip --</option>
                                {CONTACT_FIELDS.map((field) => (
                                  <option key={field.key} value={field.key}>
                                    {field.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        })}
                      </div>

                      {mappingState.previewRows.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground">
                            Preview ({mappingState.previewRows.length} row{mappingState.previewRows.length !== 1 ? "s" : ""})
                          </p>
                          <div className="overflow-x-auto rounded-lg border border-border">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-muted/50">
                                  {mappingState.headers
                                    .filter((h) => mappingState.mapping[h])
                                    .map((header) => (
                                      <th
                                        key={header}
                                        className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap"
                                      >
                                        {CONTACT_FIELDS.find((f) => f.key === mappingState.mapping[header])?.label || header}
                                      </th>
                                    ))}
                                </tr>
                              </thead>
                              <tbody>
                                {mappingState.previewRows.map((row, rowIdx) => (
                                  <tr key={rowIdx} className="border-t border-border">
                                    {mappingState.headers
                                      .filter((h) => mappingState.mapping[h])
                                      .map((header) => {
                                        const colIdx = mappingState.headers.indexOf(header);
                                        return (
                                          <td
                                            key={header}
                                            className="px-3 py-2 whitespace-nowrap max-w-[150px] truncate"
                                          >
                                            {row[colIdx] || ""}
                                          </td>
                                        );
                                      })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {!duplicateResult && (
                        <button
                          onClick={handleCheckDuplicates}
                          disabled={!file || checkingDuplicates || mappedCount === 0 || !businessId}
                          className="kf-btn-secondary w-full disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                          {checkingDuplicates ? (
                            "Checking duplicates..."
                          ) : (
                            <>
                              <AlertCircle className="w-4 h-4" />
                              Check Duplicates
                            </>
                          )}
                        </button>
                      )}

                      {duplicateResult && (
                        <div className="space-y-3">
                          <div className="p-3 rounded-lg border border-border bg-muted/30">
                            <div className="flex items-center gap-3 text-sm">
                              <div className="flex items-center gap-1.5">
                                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                <span className="font-medium">{duplicateResult.newCount} new</span>
                              </div>
                              {duplicateResult.duplicateCount > 0 && (
                                <div className="flex items-center gap-1.5">
                                  <AlertCircle className="w-4 h-4 text-amber-500" />
                                  <span className="font-medium text-amber-600 dark:text-amber-400">{duplicateResult.duplicateCount} potential duplicate{duplicateResult.duplicateCount !== 1 ? "s" : ""}</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {duplicateResult.duplicateCount > 0 && duplicateResult.duplicates.length > 0 && (
                            <div className="max-h-32 overflow-y-auto space-y-1.5">
                              {duplicateResult.duplicates.slice(0, 10).map((dup, idx) => (
                                <div key={idx} className="flex items-center gap-2 text-xs p-2 rounded-md bg-amber-500/5 border border-amber-500/15">
                                  <AlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                                  <span className="truncate">
                                    {dup.importContact.firstName || dup.importContact.email || dup.importContact.phone || "Row " + (dup.importIndex + 1)}
                                    {" matches "}
                                    {dup.existingContact.firstName ? `${dup.existingContact.firstName} ${dup.existingContact.lastName || ""}`.trim() : dup.existingContact.email || dup.existingContact.phone}
                                    {" (by " + dup.matchField + ")"}
                                  </span>
                                </div>
                              ))}
                              {duplicateResult.duplicates.length > 10 && (
                                <p className="text-xs text-muted-foreground text-center">
                                  +{duplicateResult.duplicates.length - 10} more duplicates
                                </p>
                              )}
                            </div>
                          )}

                          <div className="flex gap-2">
                            <button
                              onClick={handleFileImport}
                              disabled={!file || loading}
                              className="kf-btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                              {loading ? "Importing..." : (
                                <>
                                  <Upload className="w-4 h-4" />
                                  Import All
                                </>
                              )}
                            </button>
                            {duplicateResult.duplicateCount > 0 && (
                              <button
                                onClick={() => {
                                  setSkipDuplicates(true);
                                  handleFileImport();
                                }}
                                disabled={!file || loading}
                                className="kf-btn-secondary flex-1 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                              >
                                {loading ? "Importing..." : "Skip Duplicates"}
                              </button>
                            )}
                          </div>
                          <button
                            onClick={() => {
                              setDuplicateResult(null);
                              setMappingState(null);
                            }}
                            className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      )}

                      {!duplicateResult && (
                        <button
                          onClick={handleFileImport}
                          disabled={!file || loading || mappedCount === 0}
                          className="kf-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                          {loading ? (
                            "Importing..."
                          ) : (
                            <>
                              <Upload className="w-4 h-4" />
                              Import {mappedCount} Mapped Fields
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {method === "google" && (
                <div className="space-y-4">
                  <div className="text-center py-4">
                    <div className="mx-auto w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center mb-4">
                      <Chrome className="w-8 h-8 text-blue-500" />
                    </div>
                    <h3 className="font-semibold text-lg mb-2">Connect Google Contacts</h3>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                      Securely import your contacts from Google. We only read your contact list - we never modify or delete anything.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                    <p className="text-xs text-blue-600 dark:text-blue-400">
                      <strong>What we import:</strong> Name, email, phone, company, and job title from your Google Contacts.
                    </p>
                  </div>

                  <button
                    onClick={handleGoogleConnect}
                    disabled={googleLoading}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg bg-blue-500 text-white font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Chrome className="w-5 h-5" />
                    {googleLoading ? "Connecting..." : "Connect Google Contacts"}
                  </button>

                  <p className="text-xs text-center text-muted-foreground">
                    You&apos;ll be redirected to Google to authorize access.
                  </p>
                </div>
              )}

              {method === "url" && (
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Import from URL</label>
                    <p className="text-xs text-muted-foreground mb-3">
                      Enter a direct link to a CSV file hosted online (Google Sheets, Dropbox, etc.)
                    </p>
                  </div>

                  <input
                    type="url"
                    placeholder="https://docs.google.com/spreadsheets/.../export?format=csv"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    className="kf-input w-full"
                  />

                  <div className="p-3 rounded-lg bg-muted/50 border border-border">
                    <p className="text-xs text-muted-foreground">
                      <strong>Tip:</strong> For Google Sheets, use File &rarr; Share &rarr; Publish to web, then select CSV format.
                    </p>
                  </div>

                  <button
                    onClick={handleLinkImport}
                    disabled={!link.trim() || loading}
                    className="kf-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? "Importing..." : "Import from URL"}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
