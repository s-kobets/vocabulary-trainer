export function normalizeText(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function classifyText(input: string): 'word' | 'phrase' {
  return /\s/.test(input.trim()) ? 'phrase' : 'word'
}
