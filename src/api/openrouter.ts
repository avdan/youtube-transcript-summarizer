import { OpenRouterConfig } from '../types';

type ChatRole = 'system' | 'user' | 'assistant';

interface ChatMessage {
  role: ChatRole;
  content: string;
}

export class OpenRouterService {
  private readonly config: OpenRouterConfig;
  private readonly chunkSize = 45000;
  private readonly endpoint = 'https://openrouter.ai/api/v1/chat/completions';

  constructor(config: OpenRouterConfig) {
    if (!config.apiKey) {
      throw new Error('OpenRouter API key is required');
    }

    this.config = config;
  }

  async generateSummary(transcript: string): Promise<string> {
    try {
      const cleanedTranscript = this.normalizeTranscript(transcript);
      const chunks = this.splitTranscript(cleanedTranscript);

      if (chunks.length === 1) {
        return await this.createSummary(chunks[0], false);
      }

      const partialSummaries: string[] = [];
      for (let index = 0; index < chunks.length; index += 1) {
        const partial = await this.createSummary(
          `Section ${index + 1} of ${chunks.length}\n\n${chunks[index]}`,
          true
        );
        partialSummaries.push(partial);
      }

      return await this.createSummary(
        `Combine these section summaries into one final video summary:\n\n${partialSummaries
          .map((summary, index) => `Section ${index + 1}:\n${summary}`)
          .join('\n\n')}`,
        false
      );
    } catch (error) {
      console.error('OpenRouter API error:', error);
      throw new Error(this.formatOpenRouterError(error, 'Failed to generate summary'));
    }
  }

  async answerQuestion(
    transcript: string,
    question: string,
    conversationHistory: Array<{ role: string; content: string }> = [],
    modelOverride?: string
  ): Promise<string> {
    try {
      const transcriptForQuestion = this.normalizeTranscript(transcript).slice(0, 120000);
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content:
            'You are helping a viewer understand a YouTube video. Use the supplied transcript as the primary source of facts. The user may also ask for interpretation, opinion, implications, or general background — answer those naturally, drawing on your own knowledge, but make it clear when you are going beyond what the transcript states. Be concise.',
        },
        {
          role: 'user',
          content: `Transcript:\n${transcriptForQuestion}`,
        },
        ...conversationHistory.slice(-8).map(item => ({
          role: item.role === 'assistant' ? 'assistant' as const : 'user' as const,
          content: item.content,
        })),
        {
          role: 'user',
          content: question,
        },
      ];

      const response = await this.createChatCompletion(
        messages,
        Math.min(this.config.maxTokens || 1000, 1200),
        modelOverride
      );
      return response || 'No answer generated';
    } catch (error) {
      console.error('OpenRouter API error:', error);
      throw new Error(this.formatOpenRouterError(error, 'Failed to answer question'));
    }
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  estimateCost(_tokens: number): { estimated: number } {
    return { estimated: 0 };
  }

  private async createSummary(text: string, partial: boolean): Promise<string> {
    const systemPrompt = partial
      ? 'Summarize this section of a YouTube transcript. Preserve important claims, examples, numbers, names, and steps. Keep it compact because another pass will combine it.'
      : 'Summarize YouTube transcripts for a busy viewer. Be accurate, compact, and structured. Use Markdown bullets. Do not invent information not present in the transcript.';

    const response = await this.createChatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: this.createSummaryPrompt(text) },
      ],
      partial ? 900 : this.config.maxTokens || 1800
    );

    return response || 'No summary generated';
  }

  private async createChatCompletion(
    messages: ChatMessage[],
    maxTokens: number,
    modelOverride?: string
  ): Promise<string> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://youtube.com',
        'X-Title': 'YouTube Transcript Analyzer',
      },
      body: JSON.stringify({
        model: modelOverride || this.config.model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
    });

    const responseText = await response.text();
    let data: any = null;

    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch (error) {
      data = null;
    }

    if (!response.ok) {
      const message = data?.error?.message || data?.message || responseText || response.statusText;
      throw new Error(`OpenRouter request failed (${response.status}): ${message}`);
    }

    return this.extractMessageContent(data);
  }

  private extractMessageContent(response: any): string {
    const content = response?.choices?.[0]?.message?.content;

    if (typeof content === 'string') {
      return content.trim();
    }

    if (Array.isArray(content)) {
      return content
        .map(part => {
          if (typeof part === 'string') {
            return part;
          }
          return part?.text || '';
        })
        .join('\n')
        .trim();
    }

    return '';
  }

  private createSummaryPrompt(transcript: string): string {
    return `Create a useful summary of this YouTube video transcript.

Output format:
- Main topic: one sentence
- Key points: 5 to 8 bullets
- Takeaways: 2 to 5 bullets, only when the video includes practical advice
- Notable details: names, tools, numbers, or caveats worth preserving

Transcript:
${transcript}`;
  }

  private normalizeTranscript(transcript: string): string {
    return transcript.replace(/\s+/g, ' ').trim();
  }

  private splitTranscript(transcript: string): string[] {
    if (transcript.length <= this.chunkSize) {
      return [transcript];
    }

    const chunks: string[] = [];
    let remaining = transcript;

    while (remaining.length > this.chunkSize) {
      let splitAt = remaining.lastIndexOf('. ', this.chunkSize);
      if (splitAt < this.chunkSize * 0.7) {
        splitAt = remaining.lastIndexOf(' ', this.chunkSize);
      }
      if (splitAt <= 0) {
        splitAt = this.chunkSize;
      }

      chunks.push(remaining.slice(0, splitAt + 1).trim());
      remaining = remaining.slice(splitAt + 1).trim();
    }

    if (remaining) {
      chunks.push(remaining);
    }

    return chunks;
  }

  private formatOpenRouterError(error: any, fallback: string): string {
    const message = error?.message;

    if (!message) {
      return fallback;
    }

    if (message.includes('401')) {
      return 'OpenRouter rejected the API key. Check it in the extension settings.';
    }

    if (message.includes('402')) {
      return 'OpenRouter reported that the account needs credits or payment setup.';
    }

    if (message.includes('model')) {
      return `${fallback}: ${message}`;
    }

    return `${fallback}: ${message}`;
  }
}
