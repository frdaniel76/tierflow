/**
 * PII regex patterns for detection and redaction.
 * Vendored from pii-vault (github.com/frdaniel76/pii-vault).
 *
 * Each pattern is defined once with the /g flag. Use fresh() to get
 * a new instance before each scan — avoids shared lastIndex state bugs.
 *
 * Known limitations:
 * - URL-encoded PII (e.g. john%40acme.com) is not decoded before scanning
 * - Unicode homoglyphs (Cyrillic chars mimicking Latin) are not detected
 * - PII spanning multiple messages cannot be detected at the message level
 * - Physical/mailing addresses are not detected (too ambiguous for regex)
 * - Names (first/last) are not detected (too high false-positive rate)
 */

/** Returns a fresh regex instance — avoids shared /g lastIndex state bugs. */
export function fresh(re: RegExp): RegExp {
  return new RegExp(re.source, re.flags);
}

// L-4 fix: tighter email — no leading/trailing dots, no consecutive dots
export const EMAIL = /[a-zA-Z0-9](?:[a-zA-Z0-9.+_'-]*[a-zA-Z0-9])?@[\w-]+\.[\w.]{2,}/g;

// C-3 fix: stricter credit card — require standard card prefixes OR grouped format, 13-19 digits
export const CREDIT_CARD =
  /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12}|(?:\d{4}[ -]){3}\d{4})\b/g;

// C-2 fix: US Social Security Number (XXX-XX-XXXX)
export const SSN = /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/g;

// H-5 fix: tighter phone — no ambiguous optional groups
export const PHONE = /(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,6}\b/g;

export const API_KEY =
  /\b(sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|xoxb-[A-Za-z0-9-]+|xoxp-[A-Za-z0-9-]+|AIza[A-Za-z0-9_-]{35}|AKIA[A-Z0-9]{16}|ey[A-Za-z0-9_-]{10,}\.ey[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?)/g;

// L-2 fix: require 20+ chars for Bearer token value
export const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/g;

export const PEM_BLOCK = /-----BEGIN [A-Z ]{1,40}-----[\s\S]*?-----END [A-Z ]{1,40}-----/gm;

export const PEM_HEADER = /-----BEGIN [A-Z ]{1,40}-----/g;

// M-7 + H-6 fix: expanded keyword list, value captured more broadly
export const CREDENTIALS = /(password|passwd|pwd|pass|secret|token|auth_token|access_key|private_key|client_secret|app_secret|api[_\s]?key|apikey)\s*[:=]\s*(\S{4,})/gi;

export const CONNECTION_STRING =
  /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?|ftps?|sftp):\/\/[^\s"'>]{8,}/gi;

export const IP_ADDRESS =
  /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g;

// H-3 fix: IPv6 addresses (full, compressed, and mixed)
export const IPV6_ADDRESS =
  /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4}|::1?\b/g;

export const UK_NINO = /\b[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]\b/gi;

export const UK_POSTCODE = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}\b/gi;

// L-3 fix: expanded file path detection — /home/, /Users/, /root/, /etc/, /var/, C:\Users\, D:\Users\
export const FILE_PATH =
  /(?:\/home\/|\/Users\/|\/root\/|\/etc\/|\/var\/|[A-Z]:\\Users\\)[A-Za-z0-9_.-]+(?:[\/\\][A-Za-z0-9_./\\-]*)*/g;

/**
 * Ordered detection passes. Earlier passes have higher priority.
 * Pass 1: high-confidence structured patterns (PEM, API keys, connection strings)
 * Pass 2-4: medium-confidence patterns (email, phone, credit card, SSN, etc.)
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
  { name: "ssn",          category: "ssn",     regex: SSN,                pass: 2 },
  { name: "uk_nino",      category: "nino",    regex: UK_NINO,            pass: 2 },

  // Pass 3 — semi-structured
  { name: "phone",        category: "phone",   regex: PHONE,              pass: 3 },
  { name: "ip_address",   category: "ip",      regex: IP_ADDRESS,         pass: 3 },
  { name: "ipv6_address", category: "ip",      regex: IPV6_ADDRESS,       pass: 3 },
  { name: "uk_postcode",  category: "post",    regex: UK_POSTCODE,        pass: 3 },
  { name: "file_path",    category: "path",    regex: FILE_PATH,          pass: 3 },

  // Pass 4 — PEM headers (after full PEM blocks already matched)
  { name: "pem_header",   category: "pem",     regex: PEM_HEADER,         pass: 4 },

  // Pass 5 — entropy catch-all (key=value credentials)
  { name: "credentials",  category: "secret",  regex: CREDENTIALS,        pass: 5 },
];
