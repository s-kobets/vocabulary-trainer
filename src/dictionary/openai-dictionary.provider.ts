import type { DictionaryInput, DictionaryProvider, DictionaryResult } from './dictionary.types'

type Options = { apiKey: string; model?: string; fetchImpl?: typeof fetch; timeoutMs?: number }

function parseResult(value: unknown): DictionaryResult {
  if (!value || typeof value !== 'object') throw new Error('Invalid dictionary response')
  const result = value as Record<string, unknown>
  if (!Array.isArray(result.translations) || result.translations.some((item) => typeof item !== 'string')) {
    throw new Error('Invalid dictionary translations')
  }
  const examples = result.examples
  if (examples !== undefined && (!Array.isArray(examples) || examples.some((item) => !item || typeof item !== 'object' || typeof (item as Record<string, unknown>).source !== 'string'))) {
    throw new Error('Invalid dictionary examples')
  }
  return {
    translations: result.translations,
    transcription: typeof result.transcription === 'string' ? result.transcription : undefined,
    partOfSpeech: typeof result.partOfSpeech === 'string' ? result.partOfSpeech : undefined,
    examples: examples as DictionaryResult['examples'],
  }
}

export class OpenAiDictionaryProvider implements DictionaryProvider {
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(private readonly options: Options) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  async lookup(input: DictionaryInput): Promise<DictionaryResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.options.model ?? 'gpt-4o-mini',
          input: `Translate ${input.text} from ${input.sourceLanguage} to ${input.targetLanguage}. Return JSON with translations, transcription, partOfSpeech, and examples.`,
          text: { format: { type: 'json_object' } },
        }),
      })
      if (!response.ok) throw new Error(`OpenAI request failed: ${response.status}`)
      const payload = await response.json() as Record<string, unknown>
      const outputText = typeof payload.output_text === 'string' ? payload.output_text : undefined
      if (!outputText) throw new Error('OpenAI response has no output text')
      return parseResult(JSON.parse(outputText))
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('OpenAI request timed out')
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}
