import type { DictionaryInput, DictionaryProvider, DictionaryResult } from './dictionary.types'
import { OpenAiDictionaryError } from './dictionary.errors'
export { OpenAiDictionaryError } from './dictionary.errors'

type Options = { apiKey: string; model?: string; fetchImpl?: typeof fetch; timeoutMs?: number }

const dictionarySchema = {
  type: 'object',
  properties: {
    translations: { type: 'array', items: { type: 'string' } },
    transcription: { type: ['string', 'null'] },
    partOfSpeech: { type: ['string', 'null'] },
    examples: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          source: { type: 'string' },
          target: { type: ['string', 'null'] },
        },
        required: ['source', 'target'],
        additionalProperties: false,
      },
    },
  },
  required: ['translations', 'transcription', 'partOfSpeech', 'examples'],
  additionalProperties: false,
}

function parseResult(value: unknown): DictionaryResult {
  if (!value || typeof value !== 'object') throw new Error('Invalid dictionary response')
  const result = value as Record<string, unknown>
  if (!Array.isArray(result.translations) || result.translations.length === 0
    || result.translations.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error('Invalid dictionary translations')
  }
  const examples = result.examples
  if (!Array.isArray(examples) || examples.some((item) => !item || typeof item !== 'object'
    || typeof (item as Record<string, unknown>).source !== 'string'
    || ((item as Record<string, unknown>).target !== undefined
      && (item as Record<string, unknown>).target !== null
      && typeof (item as Record<string, unknown>).target !== 'string'))) {
    throw new Error('Invalid dictionary examples')
  }
  return {
    translations: result.translations,
    transcription: typeof result.transcription === 'string' ? result.transcription : undefined,
    partOfSpeech: typeof result.partOfSpeech === 'string' ? result.partOfSpeech : undefined,
    examples: examples.map((example) => {
      const { source, target } = example as { source: string; target?: string | null }
      return { source, ...(typeof target === 'string' ? { target } : {}) }
    }),
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
          text: {
            format: {
              type: 'json_schema',
              name: 'dictionary_translation',
              strict: true,
              schema: dictionarySchema,
            },
          },
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
      const responseData = await response.json().catch(() => {
        throw new OpenAiDictionaryError('OpenAI returned invalid response JSON', {
          kind: 'invalid_response_json', status: response.status, requestId,
        })
      }) as unknown
      if (!responseData || typeof responseData !== 'object') {
        throw new OpenAiDictionaryError('OpenAI returned invalid response JSON', {
          kind: 'invalid_response_json', status: response.status, requestId,
        })
      }
      const payload = responseData as Record<string, unknown>
      const outputItems = Array.isArray(payload.output) ? payload.output : []
      const contentParts = outputItems.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const content = (item as Record<string, unknown>).content
        return Array.isArray(content) ? content : []
      })
      const outputText = contentParts.flatMap((part) => part && typeof part === 'object'
        && (part as Record<string, unknown>).type === 'output_text'
        && typeof (part as Record<string, unknown>).text === 'string'
        ? [(part as Record<string, unknown>).text as string]
        : []).join('\n')
      if (!outputText.trim()) {
        throw new OpenAiDictionaryError('OpenAI response has no output text', {
          kind: 'no_output_text',
          status: response.status,
          requestId,
          responseStatus: typeof payload.status === 'string' ? payload.status : undefined,
          outputTypes: outputItems.flatMap((item) => item && typeof item === 'object'
            && typeof (item as Record<string, unknown>).type === 'string'
            ? [(item as Record<string, unknown>).type as string]
            : []).join(',') || 'none',
          contentTypes: contentParts.flatMap((part) => part && typeof part === 'object'
            && typeof (part as Record<string, unknown>).type === 'string'
            ? [(part as Record<string, unknown>).type as string]
            : []).join(',') || 'none',
        })
      }
      let dictionaryValue: unknown
      try {
        dictionaryValue = JSON.parse(outputText)
      } catch {
        throw new OpenAiDictionaryError('OpenAI output is not valid dictionary JSON', {
          kind: 'invalid_dictionary_json', status: response.status, requestId,
        })
      }
      try {
        if (!dictionaryValue || typeof dictionaryValue !== 'object' || Array.isArray(dictionaryValue)) {
          throw new OpenAiDictionaryError('OpenAI output is not a dictionary object', {
            kind: 'invalid_dictionary_data', status: response.status, requestId,
          })
        }
        const result = dictionaryValue as Record<string, unknown>
        const translations = result.translations
        if (!Array.isArray(translations) || translations.length === 0
          || translations.some((translation) => typeof translation !== 'string' || !translation.trim())) {
          throw new OpenAiDictionaryError('OpenAI output has invalid translations', {
            kind: 'invalid_translations',
            status: response.status,
            requestId,
            outputKeys: Object.keys(result).sort().join(','),
            translationsType: Array.isArray(translations) ? 'array' : translations === null ? 'null' : typeof translations,
            ...(Array.isArray(translations) ? { translationsCount: translations.length } : {}),
          })
        }
        const examples = result.examples
        if (examples !== undefined && (!Array.isArray(examples) || examples.some((example) => !example
          || typeof example !== 'object' || typeof (example as Record<string, unknown>).source !== 'string'))) {
          throw new OpenAiDictionaryError('OpenAI output has invalid examples', {
            kind: 'invalid_examples',
            status: response.status,
            requestId,
            examplesType: examples === null ? 'null' : Array.isArray(examples) ? 'array' : typeof examples,
          })
        }
        return parseResult(result)
      } catch (error) {
        if (error instanceof OpenAiDictionaryError) throw error
        throw new OpenAiDictionaryError('OpenAI output has invalid dictionary data', { kind: 'invalid_dictionary_data', status: response.status, requestId })
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
