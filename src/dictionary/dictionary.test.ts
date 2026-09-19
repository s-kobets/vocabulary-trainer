import { strict as assert } from 'node:assert'
import test from 'node:test'
import { MockDictionaryProvider } from './mock-dictionary.provider'

test('mock provider is deterministic and does not require a network', async () => {
  const provider = new MockDictionaryProvider()
  const result = await provider.lookup({
    text: 'reliable',
    sourceLanguage: 'en',
    targetLanguage: 'ru',
  })

  assert.deepEqual(result, {
    translations: ['[mock:ru] reliable'],
    examples: [],
  })
})
