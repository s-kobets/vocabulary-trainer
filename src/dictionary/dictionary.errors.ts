export type OpenAiDictionaryErrorKind = 'http' | 'network' | 'timeout' | 'invalid_response'

export type OpenAiDictionaryDiagnostics = {
  kind: OpenAiDictionaryErrorKind
  status?: number
  apiCode?: string
  requestId?: string
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
  const { kind, status, apiCode, requestId } = error.diagnostics
  return {
    errorType,
    provider: 'openai',
    failureKind: kind,
    ...(status === undefined ? {} : { status }),
    ...(apiCode === undefined ? {} : { apiCode }),
    ...(requestId === undefined ? {} : { requestId }),
  }
}
