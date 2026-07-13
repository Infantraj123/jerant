'use strict';

// Security scheme modeling. Three inputs, in priority order per operation:
//   1. validate({security: ...}) on the route ([] marks a public route)
//   2. auto-detection from middleware source (Authorization header reads,
//      passport.authenticate, x-api-key lookups)
//   3. the app-wide default from jerant(app, {security: ...})
// Registered schemes give Swagger UI its Authorize button.

const SHORTHAND_SCHEMES = {
  bearer: { name: 'bearerAuth', scheme: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
  basic: { name: 'basicAuth', scheme: { type: 'http', scheme: 'basic' } },
  apiKey: { name: 'apiKeyAuth', scheme: { type: 'apiKey', in: 'header', name: 'X-API-Key' } },
  cookie: { name: 'cookieAuth', scheme: { type: 'apiKey', in: 'cookie', name: 'session' } },
};

/**
 * Normalize jerant(app, {security}) into
 * { schemes: {name: scheme}, defaultRequirement: [{name: []}]|null, autoDetect }.
 */
function resolveSecurity(option) {
  if (option === false) return { schemes: {}, defaultRequirement: null, autoDetect: false };
  const resolved = { schemes: {}, defaultRequirement: null, autoDetect: true };
  if (option === undefined || option === null) return resolved;

  if (typeof option === 'string') {
    const shorthand = SHORTHAND_SCHEMES[option];
    if (shorthand) {
      resolved.schemes[shorthand.name] = { ...shorthand.scheme };
      resolved.defaultRequirement = [{ [shorthand.name]: [] }];
    }
    return resolved;
  }

  if (typeof option === 'object') {
    for (const [name, scheme] of Object.entries(option.schemes || {})) {
      if (scheme && typeof scheme === 'object') resolved.schemes[name] = { ...scheme };
    }
    if (option.autoDetect === false) resolved.autoDetect = false;
    const def = option.default;
    if (def) resolved.defaultRequirement = normalizeRequirement(def, resolved.schemes);
    return resolved;
  }
  return resolved;
}

/**
 * Accept the friendly forms a requirement can take:
 * 'bearerAuth' | ['bearerAuth'] | [{bearerAuth: []}] | [] (public).
 */
function normalizeRequirement(value, knownSchemes) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return [{ [value]: [] }];
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return []; // explicitly public
  const out = [];
  for (const item of value) {
    if (typeof item === 'string') out.push({ [item]: [] });
    else if (item && typeof item === 'object') out.push(item);
  }
  // Silence unused warning path: knownSchemes reserved for future scope checks.
  void knownSchemes;
  return out.length ? out : null;
}

// --- Auto-detection from middleware source ---

const detectionCache = new WeakMap();

/** Best-effort auth style read out of one middleware function's source. */
function detectAuthInFunction(fn) {
  if (detectionCache.has(fn)) return detectionCache.get(fn);
  let result = null;
  try {
    const src = fn.toString();
    if (!/\[native code\]/.test(src)) {
      const readsAuthHeader =
        /req\s*\.\s*(?:headers|get|header)\s*(?:\.\s*authorization\b|\(\s*['"`]authorization['"`]\s*\)|\[\s*['"`]authorization['"`]\s*\])/i.test(src) ||
        /headers\s*\[\s*['"`]authorization['"`]\s*\]/i.test(src);
      const mentionsApiKey = /['"`]x-api-key['"`]/i.test(src);
      const usesPassport = /passport\s*\.\s*authenticate\s*\(/.test(src);
      const usesJwt = /\bjwt\s*\.\s*verify\s*\(|jsonwebtoken/.test(src);
      const mentionsBasic = /['"`]Basic[\s'"`]/.test(src);
      const mentionsBearer = /['"`]Bearer[\s'"`]|\.startsWith\(\s*['"`]Bearer/i.test(src);

      if (mentionsApiKey) result = 'apiKey';
      else if (readsAuthHeader && mentionsBasic && !mentionsBearer) result = 'basic';
      else if (readsAuthHeader || usesPassport || usesJwt || mentionsBearer) result = 'bearer';
    }
  } catch { /* exotic function objects are skipped */ }
  detectionCache.set(fn, result);
  return result;
}

// Middleware names that imply authentication even when the source is opaque
// (bound functions, wrapped handlers).
const AUTH_NAME = /^(requireauth|isauthenticated|ensureauthenticated|authenticate|authguard|verifytoken|checkauth|authmiddleware)$/i;

/** Detect the auth style of a route from its middleware handles. */
function detectRouteSecurity(handles) {
  for (const handle of handles || []) {
    if (typeof handle !== 'function' || handle.__jerantInternal || handle.__jerant) continue;
    const detected = detectAuthInFunction(handle);
    if (detected) return detected;
    if (handle.name && AUTH_NAME.test(handle.name)) return 'bearer';
  }
  return null;
}

/** Scheme registration for an auto-detected style; returns the requirement. */
function requirementForDetected(style, schemes) {
  const shorthand = SHORTHAND_SCHEMES[style];
  if (!shorthand) return null;
  // An explicitly configured scheme of the same style is reused instead of
  // registering a duplicate.
  for (const [name, scheme] of Object.entries(schemes)) {
    if (
      (style === 'bearer' && scheme.type === 'http' && scheme.scheme === 'bearer') ||
      (style === 'basic' && scheme.type === 'http' && scheme.scheme === 'basic') ||
      (style === 'apiKey' && scheme.type === 'apiKey' && scheme.in === 'header') ||
      (style === 'cookie' && scheme.type === 'apiKey' && scheme.in === 'cookie')
    ) {
      return [{ [name]: [] }];
    }
  }
  schemes[shorthand.name] = { ...shorthand.scheme };
  return [{ [shorthand.name]: [] }];
}

module.exports = {
  resolveSecurity,
  normalizeRequirement,
  detectRouteSecurity,
  requirementForDetected,
  SHORTHAND_SCHEMES,
};
