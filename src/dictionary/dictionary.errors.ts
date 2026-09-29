export type OpenAiDictionaryErrorKind =
  | 'http'
  | 'network'
  | 'timeout'
  | 'invalid_response_json'
  | 'no_output_text'
  | 'invalid_dictionary_json'
  | 'invalid_dictionary_data'
  | 'invalid_translations'
  | 'invalid_examples'

export type OpenAiDictionaryDiagnostics = {
  kind: OpenAiDictionaryErrorKind
  status?: number
  apiCode?: string
  requestId?: string
  responseStatus?: string
  outputTypes?: string
  contentTypes?: string
  outputKeys?: string
  translationsType?: string
  translationsCount?: number
  examplesType?: string
}

export class OpenAiDictionaryError extends Error {
  constructor(message: string, readonly diagnostics: OpenAiDictionaryDiagnostics) {
    super(message)
    this.name = 'OpenAiDictionaryError'
  }

  get status(): number | undefined { return this.diagnostics.status }
  get apiCode(): string | undefined { return this.diagnostics.apiCode }
  get requestId(): string | undefined { return this.diagnostics.requestId }
}

export function dictionaryFailureFields(error: unknown): Record<string, string | number> {
  const errorType = error instanceof Error ? error.name : typeof error
  if (!(error instanceof OpenAiDictionaryError)) return { errorType }
  const {
    kind, status, apiCode, requestId, responseStatus, outputTypes, contentTypes,
    outputKeys, translationsType, translationsCount, examplesType,
  } = error.diagnostics
  return {
    errorType,
    provider: 'openai',
    failureKind: kind,
    ...(status === undefined ? {} : { status }),
    ...(apiCode === undefined ? {} : { apiCode }),
    ...(requestId === undefined ? {} : { requestId }),
    ...(responseStatus === undefined ? {} : { responseStatus }),
    ...(outputTypes === undefined ? {} : { outputTypes }),
    ...(contentTypes === undefined ? {} : { contentTypes }),
    ...(outputKeys === undefined ? {} : { outputKeys }),
    ...(translationsType === undefined ? {} : { translationsType }),
    ...(translationsCount === undefined ? {} : { translationsCount }),
    ...(examplesType === undefined ? {} : { examplesType }),
  }
}
