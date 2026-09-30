import Fastify, { type FastifyInstance } from 'fastify'
import { isDatabaseHealthy, type SqliteDatabase } from './db/database'

export function createHttpApp(db: SqliteDatabase): FastifyInstance {
  const app = Fastify({ logger: true })

  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (request, body, done) => {
    const values: Record<string, string> = {}
    new URLSearchParams(body as string).forEach((value, key) => { values[key] = value })
    done(null, values)
  })

  app.get('/health', async (_request, reply) => {
    if (!isDatabaseHealthy(db)) {
      return reply.code(503).send({ status: 'error' })
    }
    return { status: 'ok' }
  })

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ message: 'Something went wrong.' })
  })

  app.setErrorHandler((error, request, reply) => {
    request.log.error(
      {
        errorType: error instanceof Error ? 'Error' : typeof error,
        statusCode: error !== null && typeof error === 'object' && 'statusCode' in error
          && typeof error.statusCode === 'number' ? error.statusCode : undefined,
      },
      'HTTP request failed',
    )
    reply.code(500).send({ message: 'Something went wrong.' })
  })

  return app
}
