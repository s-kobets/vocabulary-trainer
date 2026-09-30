import 'dotenv/config'

export type Config = {
  nodeEnv: string
  port: number
  databasePath: string
  telegramBotToken: string
  telegramBotUsername?: string
  appUrl?: string
  sessionSecret?: string
  openAiApiKey?: string
  openAiModel: string
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const telegramBotToken = env.TELEGRAM_BOT_TOKEN?.trim()
  if (!telegramBotToken) {
    throw new Error('Missing required environment variable: TELEGRAM_BOT_TOKEN')
  }

  const port = Number(env.PORT ?? 3000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }

  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    port,
    databasePath: env.DATABASE_PATH ?? './data/vocabulary.db',
    telegramBotToken,
    telegramBotUsername: env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, ''),
    appUrl: env.APP_URL,
    sessionSecret: env.SESSION_SECRET,
    openAiApiKey: env.OPENAI_API_KEY?.trim(),
    openAiModel: env.OPENAI_MODEL ?? 'gpt-4o-mini',
  }
}
