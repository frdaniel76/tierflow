/**
 * PII regex patterns for detection and redaction.
 * Vendored from pii-vault (github.com/frdaniel76/pii-vault).
 *
 * Each pattern is defined once with the /g flag. Use fresh() to get
 * a new instance before each scan — avoids shared lastIndex state bugs.
 */

/** Returns a fresh regex instance — avoids shared /g lastIndex state bugs. */
export function fresh(re: RegExp): RegExp {
  return new RegExp(re.source, re.flags);
}

export const EMAIL = /[\w.+'-]+@[\w-]+\.[\w.]{2,}/g;

export const CREDIT_CARD = /\b(?:\d[ -]?){13,18}\d\b/g;

export const PHONE = /(?:\+\d{1,3}[\s.])?(?:\(?\d{2,5}\)?[\s.-]){1,3}\d{3,6}\b/g;

export const API_KEY =
  /\b(sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|xoxb-[A-Za-z0-9-]+|xoxp-[A-Za-z0-9-]+|AIza[A-Za-z0-9_-]{35}|AKIA[A-Z0-9]{16}|ey[A-Za-z0-9_-]{10,}\.ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g;

export const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g;

export const PEM_BLOCK = /-----BEGIN [A-Z ]{1,40}-----[\s\S]*?-----END [A-Z ]{1,40}-----/gm;

export const PEM_HEADER = /-----BEGIN [A-Z ]{1,40}-----/g;

export const CREDENTIALS = /(password|passwd|secret|token|api[_\s]?key|apikey)\s*[:=]\s*(\S{4,})/gi;

export const CONNECTION_STRING =
  /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?|ftps?|sftp):\/\/[^\s"'>]{8,}/gi;

export const IP_ADDRESS =
  /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g;

export const UK_NINO = /\b[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]\b/gi;

export const UK_POSTCODE = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}\b/gi;

export const FILE_PATH =
  /(?:\/home\/|\/Users\/|C:\\Users\\)[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./\\-]*)*/g;

/**
 * Ordered detection passes. Earlier passes have higher priority.
 * Pass 1: high-confidence structured patterns (PEM, API keys, connection strings)
 * Pass 2-4: medium-confidence patterns (email, phone, credit card, etc.)
 * Pass 5: entropy-based catch-all (credentials with key=value format)
 */
export type PatternDef = {
  name: string;
  category: string;
  regex: RegExp;
  pass: number;
};

export const PATTERNS: PatternDef[] = [
  // Pass 1 — high confidence, structured
  { name: "pem_block",    category: "pem",    regex: PEM_BLOCK,          pass: 1 },
  { name: "api_key",      category: "apikey",  regex: API_KEY,            pass: 1 },
  { name: "conn_string",  category: "conn",    regex: CONNECTION_STRING,  pass: 1 },
  { name: "bearer",       category: "cred",    regex: BEARER,             pass: 1 },

  // Pass 2 — structured identifiers
  { name: "email",        category: "email",   regex: EMAIL,              pass: 2 },
  { name: "credit_card",  category: "cc",      regex: CREDIT_CARD,        pass: 2 },
  { name: "uk_nino",      category: "nino",    regex: UK_NINO,            pass: 2 },

  // Pass 3 — semi-structured
  { name: "phone",        category: "phone",   regex: PHONE,              pass: 3 },
  { name: "ip_address",   category: "ip",      regex: IP_ADDRESS,         pass: 3 },
  { name: "uk_postcode",  category: "post",    regex: UK_POSTCODE,        pass: 3 },
  { name: "file_path",    category: "path",    regex: FILE_PATH,          pass: 3 },

  // Pass 4 — PEM headers (after full PEM blocks already matched)
  { name: "pem_header",   category: "pem",     regex: PEM_HEADER,         pass: 4 },

  // Pass 5 — entropy catch-all (key=value credentials)
  { name: "credentials",  category: "secret",  regex: CREDENTIALS,        pass: 5 },
];
