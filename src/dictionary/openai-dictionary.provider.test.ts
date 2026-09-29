import { strict as assert } from 'node:assert'
import test from 'node:test'
import { OpenAiDictionaryError, OpenAiDictionaryProvider } from './openai-dictionary.provider'

test('OpenAI provider parses raw Responses API message output', async () => {
  const provider = new OpenAiDictionaryProvider({
    apiKey: 'secret',
    fetchImpl: async (_url, init) => {
      assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer secret')
      const request = JSON.parse(String(init?.body)) as {
        text: { format: { type: string; strict?: boolean; schema?: { properties?: Record<string, { type?: unknown }> } } }
      }
      assert.equal(request.text.format.type, 'json_schema')
      assert.equal(request.text.format.strict, true)
      assert.equal(request.text.format.schema?.properties?.translations.type, 'array')
      return new Response(JSON.stringify({
        id: 'resp-test',
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify({
            translations: ['примерный'], transcription: '/əˈprɒksɪmət/', partOfSpeech: 'adjective',
            examples: [{ source: 'An approximate value', target: 'Приблизительное значение' }],
          }) }],
        }],
      }), { status: 200 })
    },
  })

  assert.deepEqual(await provider.lookup({ text: 'approximate', sourceLanguage: 'en', targetLanguage: 'ru' }), {
    translations: ['примерный'], transcription: '/əˈprɒksɪmət/', partOfSpeech: 'adjective',
    examples: [{ source: 'An approximate value', target: 'Приблизительное значение' }],
  })
})

test('OpenAI provider rejects failed and malformed responses', async () => {
  const failed = new OpenAiDictionaryProvider({ apiKey: 'secret', fetchImpl: async () => new Response('', { status: 429 }) })
  await assert.rejects(() => failed.lookup({ text: 'word', sourceLanguage: 'en', targetLanguage: 'ru' }), /429/)
  const malformed = new OpenAiDictionaryProvider({
    apiKey: 'secret',
    fetchImpl: async () => new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{"examples":[]}' }] }],
    }), { status: 200 }),
  })
  await assert.rejects(
    () => malformed.lookup({ text: 'word', sourceLanguage: 'en', targetLanguage: 'ru' }),
    (error: unknown) => (error as OpenAiDictionaryError).diagnostics.kind === 'invalid_translations',
  )
  const empty = new OpenAiDictionaryProvider({
    apiKey: 'secret',
    fetchImpl: async () => new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{"translations":[]}' }] }],
    }), { status: 200 }),
  })
  await assert.rejects(
    () => empty.lookup({ text: 'word', sourceLanguage: 'en', targetLanguage: 'ru' }),
    (error: unknown) => (error as OpenAiDictionaryError).diagnostics.kind === 'invalid_translations',
  )
})

test('OpenAI provider preserves safe HTTP failure metadata', async () => {
  const provider = new OpenAiDictionaryProvider({
    apiKey: 'secret-api-key',
    fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'insufficient_quota' } }), {
      status: 429,
      headers: { 'x-request-id': 'req-safe-id' },
    }),
  })

  await assert.rejects(
    () => provider.lookup({ text: 'sensitive word', sourceLanguage: 'en', targetLanguage: 'ru' }),
    (error: unknown) => {
      assert.equal((error as OpenAiDictionaryError).status, 429)
      assert.equal((error as OpenAiDictionaryError).apiCode, 'insufficient_quota')
      assert.equal((error as OpenAiDictionaryError).requestId, 'req-safe-id')
      assert.doesNotMatch((error as Error).message, /secret-api-key|sensitive word/)
      return true
    },
  )
})

test('OpenAI provider reports response shape when no text output is present', async () => {
  const provider = new OpenAiDictionaryProvider({
    apiKey: 'secret',
    fetchImpl: async () => new Response(JSON.stringify({
      status: 'incomplete',
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'not included in diagnostics' }] }],
    }), { status: 200, headers: { 'x-request-id': 'req-no-text' } }),
  })

  await assert.rejects(
    () => provider.lookup({ text: 'minor', sourceLanguage: 'en', targetLanguage: 'ru' }),
    (error: unknown) => {
      const openAiError = error as OpenAiDictionaryError
      assert.equal(openAiError.diagnostics.kind, 'no_output_text')
      assert.equal(openAiError.status, 200)
      assert.equal(openAiError.diagnostics.responseStatus, 'incomplete')
      assert.equal(openAiError.diagnostics.outputTypes, 'message')
      assert.equal(openAiError.diagnostics.contentTypes, 'refusal')
      assert.equal(openAiError.requestId, 'req-no-text')
      assert.doesNotMatch(JSON.stringify(openAiError.diagnostics), /not included in diagnostics|minor/)
      return true
    },
  )
})
