'use strict';

// Confidence scores, 0-100. Validation-schema sources are authoritative;
// runtime inference gains confidence with observation volume and stability.

const SOURCE_CONFIDENCE = {
  zod: 100,
  joi: 100,
  yup: 100,
  ajv: 100,
  manual: 100,
  'express-validator': 90,
  'class-validator': 90,
  prisma: 75,
  'code-analysis': 55,
};

const ROUTE_SCAN_CONFIDENCE = 25;

function sourceConfidence(name) {
  return SOURCE_CONFIDENCE[name] !== undefined ? SOURCE_CONFIDENCE[name] : 85;
}

function runtimeConfidence(observations, stability) {
  if (!observations) return 0;
  const volume = Math.min(observations, 30) / 30; // saturates at 30 samples
  const base = 40 + 45 * volume;
  const score = base * (0.7 + 0.3 * (typeof stability === 'number' ? stability : 1));
  return Math.round(Math.max(30, Math.min(90, score)));
}

const SOURCE_LABELS = {
  zod: 'Zod',
  joi: 'Joi',
  yup: 'Yup',
  ajv: 'AJV',
  'express-validator': 'express-validator',
  'class-validator': 'class-validator',
  manual: 'Manual',
  runtime: 'Runtime Analysis',
  prisma: 'Prisma Schema',
  'code-analysis': 'Code Analysis',
  'runtime + code-analysis': 'Runtime Analysis + Code Analysis',
  'route-scan': 'Route Scanner',
};

function sourceLabel(name) {
  return SOURCE_LABELS[name] || name;
}

module.exports = {
  sourceConfidence,
  runtimeConfidence,
  sourceLabel,
  ROUTE_SCAN_CONFIDENCE,
};
