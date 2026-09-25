import path from 'node:path'
import Fastify from 'fastify'
import { createHttpApp } from './http'
import { loadConfig } from './config'
import { openDatabase, runMigrations, type SqliteDatabase } from './db/database'
import { MockDictionaryProvider } from './dictionary/mock-dictionary.provider'
import { OpenAiDictionaryProvider } from './dictionary/openai-dictionary.provider'
import { EnrichmentWorker } from './vocabulary/enrichment.worker'
import { registerCommandMenu } from './telegram/commands'
import { LanguagePairRepository } from './languages/language-pair.repository'
import { LanguagePairService } from './languages/language-pair.service'
import { ReviewRepository } from './reviews/review.repository'
import { ReviewService } from './reviews/review.service'
import { createBot } from './telegram/bot'
import { TelegramAccountRepository } from './users/telegram-account.repository'
import { UserRepository } from './users/user.repository'
import { UserService } from './users/user.service'
import { UserSettingsRepository } from './users/user-settings.repository'
import { VocabularyRepository } from './vocabulary/vocabulary.repository'
import { VocabularyService } from './vocabulary/vocabulary.service'

function errorMetadata(error: unknown, secrets: Array<string | undefined> = []): Record<string, string> {
  if (!(error instanceof Error)) return { errorName: typeof error, errorMessage: 'Unknown failure' }
  let message = error.message
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join('[redacted]')
  }
  const metadata: Record<string, string> = {
    errorName: error.name,
    errorMessage: message,
  }
  if ('code' in error && (typeof error.code === 'string' || typeof error.code === 'number')) {
    metadata.errorCode = String(error.code)
  }
  return metadata
}

export async function start(): Promise<void> {
  const config = loadConfig()
  const bootstrapLogger = Fastify({ logger: true }).log
  let db: SqliteDatabase | undefined
  let app: ReturnType<typeof createHttpApp> | undefined
  let bot: ReturnType<typeof createBot> | undefined
  let enrichmentWorker: EnrichmentWorker | undefined
  let cleanupStarted = false
  let shutdownPromise: Promise<void> | undefined

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    app?.log.info({ signal }, 'Shutdown started')
    await cleanup(signal)
    app?.log.info({ signal }, 'Shutdown complete')
  }
  const sigintHandler = () => { shutdownPromise ??= shutdown('SIGINT') }
  const sigtermHandler = () => { shutdownPromise ??= shutdown('SIGTERM') }

  const cleanup = async (reason: string): Promise<void> => {
    if (cleanupStarted) return
    cleanupStarted = true
    process.removeListener('SIGINT', sigintHandler)
    process.removeListener('SIGTERM', sigtermHandler)

    if (bot) {
      try {
        await bot.stop(reason)
      } catch (error) {
        app?.log.error({ phase: 'shutdown', ...errorMetadata(error, [config.telegramBotToken, config.sessionSecret]) }, 'Telegram shutdown failed')
      }
    }
    await enrichmentWorker?.stop()
    if (app) {
      try {
        await app.close()
      } catch (error) {
        app.log.error({ phase: 'shutdown', ...errorMetadata(error, [config.telegramBotToken, config.sessionSecret]) }, 'HTTP shutdown failed')
      }
    }
    if (db) db.close()
  }

  try {
    db = openDatabase(config.databasePath)
    try {
      runMigrations(db, path.join(__dirname, 'db/migrations'))
    } catch (error) {
      bootstrapLogger.error(
        { phase: 'migration', ...errorMetadata(error, [config.telegramBotToken, config.sessionSecret]) },
        'Database migration failed',
      )
      throw error
    }

    const users = new UserRepository(db)
    const telegramAccounts = new TelegramAccountRepository(db)
    const userSettings = new UserSettingsRepository(db)
    const languagePairs = new LanguagePairRepository(db)
    const vocabulary = new VocabularyRepository(db)
    const reviews = new ReviewRepository(db)
    const userService = new UserService(db, users, telegramAccounts, userSettings)
    const languagePairService = new LanguagePairService(db, languagePairs)
     const dictionaryProvider = config.openAiApiKey
       ? new OpenAiDictionaryProvider({ apiKey: config.openAiApiKey, model: config.openAiModel })
       : new MockDictionaryProvider()
     const vocabularyService = new VocabularyService(vocabulary, dictionaryProvider)
    const reviewService = new ReviewService(db, reviews, vocabulary)

    app = createHttpApp(db)
    app.log.info('Database migrations complete')
    const logger = app.log as unknown as { error: (...args: unknown[]) => void }
    const dependencies = {
      userService,
      db,
      languagePairService,
      vocabularyService,
      reviewService,
      logger,
    }
    bot = createBot(config.telegramBotToken, dependencies)
    enrichmentWorker = new EnrichmentWorker(vocabulary, dictionaryProvider, languagePairs)
    process.once('SIGINT', sigintHandler)
    process.once('SIGTERM', sigtermHandler)

    app.log.info({ phase: 'telegram', port: config.port }, 'Starting Telegram bot')
    await bot.launch()
    if (cleanupStarted) {
      if (shutdownPromise) await shutdownPromise
      return
    }
    try {
      await registerCommandMenu(bot)
    } catch (error) {
      app.log.warn({ errorType: error instanceof Error ? 'Error' : typeof error }, 'Telegram command menu registration failed')
    }
    enrichmentWorker.start()
    if (cleanupStarted) {
      if (shutdownPromise) await shutdownPromise
      return
    }
    await app.listen({ port: config.port, host: '0.0.0.0' })
    if (cleanupStarted) {
      if (shutdownPromise) await shutdownPromise
      return
    }
    app.log.info({ phase: 'startup', port: config.port }, 'Telegram bot and HTTP server started')
  } catch (error) {
    if (shutdownPromise) {
      await shutdownPromise
      return
    }
    await cleanup('startup failure')
    bootstrapLogger.error(
      { phase: 'startup', ...errorMetadata(error, [config.telegramBotToken, config.sessionSecret]) },
      'Startup failed',
    )
    throw error
  }
}

const entrypoint = process.argv[1]
if (entrypoint && path.resolve(entrypoint) === path.resolve(__filename)) {
  start().catch((error: unknown) => {
    process.stderr.write(`Startup failed: ${errorMetadata(error).errorName}\n`)
    process.exitCode = 1
  })
}
