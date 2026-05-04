export interface ModelOption {
  id: string;
  label: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite (Fast, low cost)' },
  { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5 (High quality)' },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct (Open model)' },
  { id: 'mistralai/mistral-small-3.2-24b-instruct-2506', label: 'Mistral Small 3.2 24B (Efficient)' },
  { id: 'openrouter/auto', label: 'OpenRouter Auto (Route automatically)' },
];

export const DEFAULT_SUMMARY_MODEL = 'google/gemini-2.5-flash-lite';
export const DEFAULT_QA_MODEL = 'google/gemini-2.5-flash-lite';

export type SummaryLength = 'concise' | 'normal' | 'extended';

export interface SummaryLengthOption {
  id: SummaryLength;
  label: string;
}

export const SUMMARY_LENGTH_OPTIONS: SummaryLengthOption[] = [
  { id: 'concise', label: 'Concise' },
  { id: 'normal', label: 'Normal' },
  { id: 'extended', label: 'Extended' },
];

export const DEFAULT_SUMMARY_LENGTH: SummaryLength = 'normal';

const VALID_LENGTHS = new Set<SummaryLength>(SUMMARY_LENGTH_OPTIONS.map(o => o.id));

export function normalizeSummaryLength(value: unknown): SummaryLength {
  if (typeof value === 'string') {
    if (VALID_LENGTHS.has(value as SummaryLength)) return value as SummaryLength;
    if (value === 'short') return 'concise';
    if (value === 'medium') return 'normal';
    if (value === 'long') return 'extended';
  }
  return DEFAULT_SUMMARY_LENGTH;
}
