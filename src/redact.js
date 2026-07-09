'use strict';

const REDACTED = '***REDACTED***';

// Key names that must never be stored, matched case-insensitively after
// stripping separators ("api-key", "api_key" and "apiKey" all match).
const SENSITIVE_KEYS = new Set([
  'password', 'passwd', 'pwd', 'newpassword', 'oldpassword', 'currentpassword',
  'passwordconfirmation', 'secret', 'secrets', 'secretkey', 'clientsecret',
  'token', 'accesstoken', 'refreshtoken', 'idtoken', 'authtoken', 'jwt',
  'apikey', 'apisecret', 'authorization', 'auth', 'bearer',
  'privatekey', 'publickey', 'signature',
  'session', 'sessionid', 'sessiontoken', 'sid',
  'cookie', 'cookies', 'setcookie',
  'csrf', 'csrftoken', 'xsrf', 'xsrftoken',
  'otp', 'onetimepassword', 'pin', 'mfacode', 'totp',
  'ssn', 'socialsecuritynumber',
  'creditcard', 'cardnumber', 'ccnumber', 'cvv', 'cvc', 'securitycode',
]);

const SENSITIVE_KEY_PATTERN = /(password|secret|token|api[-_]?key|private[-_]?key|credit[-_]?card|session[-_]?id)/i;

// Values that look like credentials regardless of the key they live under.
const JWT_PATTERN = /^eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*$/;
const AUTH_SCHEME_PATTERN = /^(Bearer|Basic|Digest|Token)\s+\S+/i;

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[-_\s]/g, '');
}

function isSensitiveKey(key, extraKeys) {
  const normalized = normalizeKey(key);
  if (SENSITIVE_KEYS.has(normalized)) return true;
  if (SENSITIVE_KEY_PATTERN.test(String(key))) return true;
  if (extraKeys) {
    for (const extra of extraKeys) {
      if (normalizeKey(extra) === normalized) return true;
    }
  }
  return false;
}

function isSensitiveValue(value) {
  return typeof value === 'string' &&
    (JWT_PATTERN.test(value) || AUTH_SCHEME_PATTERN.test(value));
}

/**
 * Deep-copy `value` with all sensitive keys and credential-shaped values
 * replaced by a redaction marker. Never mutates the input.
 */
function redact(value, extraKeys, depth = 0) {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string') return isSensitiveValue(value) ? REDACTED : value;
  if (t === 'number' || t === 'boolean') return value;
  if (t === 'bigint') return value.toString();
  if (t === 'function' || t === 'symbol') return undefined;
  if (depth > 10) return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redact(item, extraKeys, depth + 1));
  }
  if (Buffer.isBuffer(value)) return undefined;
  const out = {};
  for (const key of Object.keys(value)) {
    if (isSensitiveKey(key, extraKeys)) {
      out[key] = REDACTED;
    } else {
      const redacted = redact(value[key], extraKeys, depth + 1);
      if (redacted !== undefined) out[key] = redacted;
    }
  }
  return out;
}

module.exports = { redact, isSensitiveKey, isSensitiveValue, REDACTED };
