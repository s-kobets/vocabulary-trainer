import { strict as assert } from 'node:assert'
import test from 'node:test'
import { OpenAiDictionaryProvider } from './openai-dictionary.provider'

test('OpenAI provider parses structured dictionary output', async () => {
  const provider = new OpenAiDictionaryProvider({
    apiKey: 'secret',
    fetchImpl: async (_url, init) => {
      assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer secret')
      return new Response(JSON.stringify({ output_text: JSON.stringify({
        translations: ['примерный'], transcription: '/əˈprɒksɪmət/', partOfSpeech: 'adjective',
        examples: [{ source: 'An approximate value', target: 'Приблизительное значение' }],
      }) }), { status: 200 })
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
    fetchImpl: async () => new Response(JSON.stringify({ output_text: '{"examples":[]}' }), { status: 200 }),
  })
  await assert.rejects(() => malformed.lookup({ text: 'word', sourceLanguage: 'en', targetLanguage: 'ru' }), /translations/)
})
