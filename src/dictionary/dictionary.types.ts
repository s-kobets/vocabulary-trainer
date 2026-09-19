export type DictionaryInput = {
  text: string
  sourceLanguage: string
  targetLanguage: string
}

export type DictionaryResult = {
  translations: string[]
  transcription?: string
  partOfSpeech?: string
  examples?: { source: string; target?: string }[]
}

export interface DictionaryProvider {
  lookup(input: DictionaryInput): Promise<DictionaryResult>
}
