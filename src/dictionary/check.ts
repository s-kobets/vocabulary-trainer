import 'dotenv/config'
import { OpenAiDictionaryProvider } from './openai-dictionary.provider'
import { dictionaryFailureFields } from './dictionary.errors'

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    process.stderr.write('OPENAI_API_KEY is required; no request sent.\n')
    process.exitCode = 1
    return
  }

  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'
  const provider = new OpenAiDictionaryProvider({ apiKey, model })
  try {
    const result = await provider.lookup({ text: 'minor', sourceLanguage: 'en', targetLanguage: 'ru' })
    process.stdout.write(`OpenAI check passed (${model}): minor -> ${result.translations.join(', ')}\n`)
  } catch (error) {
    process.stderr.write(`OpenAI check failed: ${JSON.stringify(dictionaryFailureFields(error))}\n`)
    process.exitCode = 1
  }
}

void main()
