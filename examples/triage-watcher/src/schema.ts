import { TRIAGE_DISPOSITIONS } from './lib-imports';

/**
 * JSON schema for the classifier's structured output, derived from
 * `TriageDecision` (library ticket 03). Defined service-side because the library
 * must stay Anthropic-free. Used as `output_config.format = { type: 'json_schema', ... }`.
 *
 * The model returns DATA ONLY — `{ decisions: TriageDecision[] }`. It has no
 * tools and cannot emit actions; `index` correlates back to the batch via
 * `idByIndex` (never a model-supplied id).
 */
export const DECISIONS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['decisions'],
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'disposition', 'confidence', 'category', 'injectionSuspected', 'note'],
        properties: {
          index: { type: 'integer', minimum: 1 },
          disposition: { type: 'string', enum: [...TRIAGE_DISPOSITIONS] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          category: {
            type: ['string', 'null'],
            enum: ['bug', 'feature', 'praise', 'question', 'other', null],
          },
          injectionSuspected: { type: 'boolean' },
          note: { type: 'string', maxLength: 2000 },
          duplicateOfIndex: { type: ['integer', 'null'], minimum: 1 },
        },
      },
    },
  },
} as const;
