import type { DictionaryProvider } from './dictionary.types'

export class MockDictionaryProvider implements DictionaryProvider {
  async lookup(input: Parameters<DictionaryProvider['lookup']>[0]) {
    return {
      translations: [`[mock:${input.targetLanguage}] ${input.text}`],
      examples: [],
    }
  }
}
