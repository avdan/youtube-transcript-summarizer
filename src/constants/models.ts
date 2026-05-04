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
