import type { DictionaryInput, DictionaryProvider, DictionaryResult } from './dictionary.types'
import { OpenAiDictionaryError } from './dictionary.errors'
export { OpenAiDictionaryError } from './dictionary.errors'

type Options = { apiKey: string; model?: string; fetchImpl?: typeof fetch; timeoutMs?: number }

function parseResult(value: unknown): DictionaryResult {
  if (!value || typeof value !== 'object') throw new Error('Invalid dictionary response')
  const result = value as Record<string, unknown>
  if (!Array.isArray(result.translations) || result.translations.length === 0
    || result.translations.some((item) => typeof item !== 'string' || !item.trim())) {
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
    let requestId: string | undefined
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
      requestId = response.headers.get('x-request-id') ?? undefined
      if (!response.ok) {
        const body = await response.json().catch(() => undefined) as Record<string, unknown> | undefined
        const apiError = body?.error && typeof body.error === 'object'
          ? body.error as Record<string, unknown>
          : undefined
        throw new OpenAiDictionaryError(`OpenAI HTTP request failed (${response.status})`, {
          kind: 'http',
          status: response.status,
          ...(typeof apiError?.code === 'string' ? { apiCode: apiError.code } : {}),
          requestId,
        })
      }
      const payload = await response.json().catch(() => {
        throw new OpenAiDictionaryError('OpenAI returned invalid JSON', { kind: 'invalid_response', requestId })
      }) as Record<string, unknown>
      const outputText = Array.isArray(payload.output)
        ? payload.output.flatMap((item) => {
          if (!item || typeof item !== 'object') return []
          const content = (item as Record<string, unknown>).content
          if (!Array.isArray(content)) return []
          return content.flatMap((part) => part && typeof part === 'object'
            && (part as Record<string, unknown>).type === 'output_text'
            && typeof (part as Record<string, unknown>).text === 'string'
            ? [(part as Record<string, unknown>).text as string]
            : [])
        }).join('\n')
        : ''
      if (!outputText.trim()) {
        throw new OpenAiDictionaryError('OpenAI response has no output text', { kind: 'invalid_response', requestId })
      }
      try {
        return parseResult(JSON.parse(outputText))
      } catch {
        throw new OpenAiDictionaryError('OpenAI response has invalid dictionary data or translations', { kind: 'invalid_response', requestId })
      }
    } catch (error) {
      if (error instanceof OpenAiDictionaryError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new OpenAiDictionaryError('OpenAI request timed out', { kind: 'timeout', requestId })
      }
      throw new OpenAiDictionaryError('OpenAI request failed before a response was received', {
        kind: 'network',
        requestId,
      })
    } finally {
      clearTimeout(timeout)
    }
  }
}
