import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Config } from '../config'
import { getLanguages } from '../languages/languages'
import type { LanguagePairService } from '../languages/language-pair.service'
import type { ReviewService } from '../reviews/review.service'
import type { UserService } from '../users/user.service'
import type { TelegramAccountRepository } from '../users/telegram-account.repository'
import type { VocabularyService } from '../vocabulary/vocabulary.service'
import type { VocabularyStatus } from '../vocabulary/vocabulary.types'
import { verifyTelegramAuth } from './auth'
import { renderDashboard, renderLogin, renderReview, renderVocabulary } from './pages'
import { SessionRepository } from './session.repository'

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string
  }
}

const COOKIE_NAME = 'vocabulary_session'
const SESSION_DAYS = 30

type WebDependencies = {
  config: Config
  userService: UserService
  telegramAccounts: TelegramAccountRepository
  sessions: SessionRepository
  languagePairService: LanguagePairService
  vocabularyService: VocabularyService
  reviewService: ReviewService
}

function cookieValue(request: FastifyRequest, name: string): string | undefined {
  const header = request.headers.cookie
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) {
      try { return decodeURIComponent(value.join('=')) } catch { return undefined }
    }
  }
  return undefined
}

function setSessionCookie(reply: FastifyReply, sessionId: string, secure: boolean): void {
  const maxAge = SESSION_DAYS * 24 * 60 * 60
  reply.header('set-cookie', `${COOKIE_NAME}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`)
}

function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.header('set-cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`)
}

function queryString(request: FastifyRequest): Record<string, string> {
  const query = request.query as Record<string, unknown>
  return Object.fromEntries(Object.entries(query).flatMap(([key, value]) =>
    typeof value === 'string' ? [[key, value]] : [],
  ))
}

function bodyString(request: FastifyRequest, key: string): string {
  const body = request.body as Record<string, unknown> | undefined
  return typeof body?.[key] === 'string' ? body[key] as string : ''
}

function redirect(reply: FastifyReply, path: string, message?: string): FastifyReply {
  const target = message ? `${path}${path.includes('?') ? '&' : '?'}notice=${encodeURIComponent(message)}` : path
  return reply.code(303).header('location', target).send()
}

export function registerWebRoutes(app: FastifyInstance, dependencies: WebDependencies): void {
  const { config, userService, sessions, languagePairService, vocabularyService, reviewService } = dependencies
  const secureCookie = config.nodeEnv === 'production'

  app.get('/app.css', async (_request, reply) => reply.type('text/css').send(
    readFileSync(path.resolve(process.cwd(), 'public/app.css'), 'utf8'),
  ))

  app.get('/login', async (request, reply) => {
    const sessionId = cookieValue(request, COOKIE_NAME)
    if (sessionId && sessions.findUserId(sessionId)) return reply.redirect('/')
    const message = queryString(request).notice
    const authUrl = config.appUrl
      ? new URL('/auth/telegram', config.appUrl).toString()
      : new URL('/auth/telegram', `${request.protocol}://${request.hostname}`).toString()
    return reply.type('text/html; charset=utf-8').send(renderLogin(config.telegramBotUsername, authUrl, message))
  })

  app.get('/auth/telegram', async (request, reply) => {
    const profile = verifyTelegramAuth(queryString(request), config.telegramBotToken)
    if (!profile) return redirect(reply, '/login', 'Не удалось подтвердить вход. Попробуйте ещё раз.')
    const user = userService.ensureFromTelegram(profile)
    dependencies.telegramAccounts.updateTelegramProfile(user.id, profile.telegramUserId, profile)
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const sessionId = sessions.create(user.id, expiresAt)
    setSessionCookie(reply, sessionId, secureCookie)
    return reply.redirect('/')
  })

  app.addHook('preHandler', async (request, reply) => {
    if (request.url.startsWith('/health') || request.url.startsWith('/login') || request.url.startsWith('/auth/telegram') || request.url === '/app.css') return
    const sessionId = cookieValue(request, COOKIE_NAME)
    const userId = sessionId ? sessions.findUserId(sessionId) : null
    if (!userId) {
      if (sessionId) sessions.delete(sessionId)
      clearSessionCookie(reply, secureCookie)
      return reply.redirect('/login')
    }
    request.userId = userId
  })

  app.post('/logout', async (request, reply) => {
    const sessionId = cookieValue(request, COOKIE_NAME)
    if (sessionId) sessions.delete(sessionId)
    clearSessionCookie(reply, secureCookie)
    return reply.redirect('/login')
  })

  app.get('/', async (request, reply) => {
    const userId = request.userId!
    const pairs = languagePairService.listForUser(userId)
    const pair = languagePairService.findDefaultForUser(userId)
    const counts = { inbox: 0, learning: 0, known: 0 }
    if (pair) {
      for (const status of Object.keys(counts) as VocabularyStatus[]) {
        counts[status] = vocabularyService.countByStatus(userId, status, pair.id)
      }
    }
    const now = new Date()
    const due = pair ? reviewService.countDue(userId, now, pair.id) : 0
    return reply.type('text/html; charset=utf-8').send(renderDashboard({
      pair, pairs, languages: getLanguages(), counts, due,
      reviewed: reviewService.countReviewedToday(userId, now),
      message: queryString(request).notice,
    }))
  })

  app.post('/languages', async (request, reply) => {
    const userId = request.userId!
    const source = bodyString(request, 'source')
    const target = bodyString(request, 'target')
    if (source === target) return redirect(reply, '/', 'Выберите разные языки.')
    try {
      const pair = languagePairService.createDefault(userId, source, target)
      return redirect(reply, '/', `Пара ${pair.sourceLanguage.toUpperCase()} → ${pair.targetLanguage.toUpperCase()} создана.`)
    } catch {
      return redirect(reply, '/', 'Не удалось создать языковую пару.')
    }
  })

  app.post('/languages/select', async (request, reply) => {
    try {
      languagePairService.selectForUser(request.userId!, bodyString(request, 'pairId'))
      let returnTo = '/'
      try {
        if (request.headers.referer && new URL(request.headers.referer).pathname === '/vocabulary') returnTo = '/vocabulary'
      } catch { /* Ignore malformed referrers. */ }
      return redirect(reply, returnTo)
    } catch {
      return redirect(reply, '/', 'Языковая пара не найдена.')
    }
  })

  app.get('/vocabulary', async (request, reply) => {
    const userId = request.userId!
    const pair = languagePairService.findDefaultForUser(userId)
    if (!pair) return reply.redirect('/')
    const query = queryString(request)
    const status = ['inbox', 'learning', 'known'].includes(query.status) ? query.status as VocabularyStatus : undefined
    const items = vocabularyService.listForUser(userId, { languagePairId: pair.id, ...(status ? { status } : {}) })
      .filter((item) => !query.q || item.text.toLocaleLowerCase().includes(query.q.toLocaleLowerCase()))
    return reply.type('text/html; charset=utf-8').send(renderVocabulary({
      pair, pairs: languagePairService.listForUser(userId), items, status, query: query.q,
      message: query.notice,
    }))
  })

  app.post('/vocabulary', async (request, reply) => {
    const userId = request.userId!
    const pair = languagePairService.findDefaultForUser(userId)
    if (!pair) return reply.redirect('/')
    const texts = bodyString(request, 'text').split(/\r?\n/).map((text) => text.trim()).filter(Boolean).slice(0, 20)
    if (!texts.length) return redirect(reply, '/vocabulary', 'Введите слово или фразу.')
    if (texts.some((text) => text.length > 500)) return redirect(reply, '/vocabulary', 'Ограничение — 500 символов на слово или фразу.')
    let added = 0
    let duplicates = 0
    for (const text of texts) {
      const result = await vocabularyService.addText(userId, pair, text)
      if (result.duplicate) duplicates += 1
      else added += 1
    }
    const summary = `${added} добавлено${duplicates ? `, ${duplicates} уже было` : ''}.`
    return redirect(reply, '/vocabulary', summary)
  })

  app.post('/vocabulary/:id/learn', async (request, reply) => {
    const pair = languagePairService.findDefaultForUser(request.userId!)
    if (!pair) return reply.redirect('/')
    const { id } = request.params as { id: string }
    const started = reviewService.startLearningItem(request.userId!, pair.id, id, new Date())
    return redirect(reply, '/vocabulary', started ? 'Слово перенесено в изучение.' : 'Слово больше недоступно во входящих.')
  })

  app.get('/review', async (request, reply) => {
    const userId = request.userId!
    const pair = languagePairService.findDefaultForUser(userId)
    if (!pair) return reply.redirect('/')
    const due = reviewService.getDue(userId, new Date(), 50, pair.id)
    return reply.type('text/html; charset=utf-8').send(renderReview({
      pair, pairs: languagePairService.listForUser(userId), due,
      message: queryString(request).notice,
    }))
  })

  app.post('/review/:id/reveal', async (request, reply) => {
    const userId = request.userId!
    const pair = languagePairService.findDefaultForUser(userId)
    if (!pair) return reply.redirect('/')
    const { id } = request.params as { id: string }
    const due = reviewService.getDue(userId, new Date(), 50, pair.id)
    if (!due.some((entry) => entry.item.id === id)) return redirect(reply, '/review', 'Карточка уже не ожидает повторения.')
    return reply.type('text/html; charset=utf-8').send(renderReview({
      pair, pairs: languagePairService.listForUser(userId), due, itemId: id, revealed: true,
    }))
  })

  app.post('/review/:id/answer', async (request, reply) => {
    const userId = request.userId!
    const pair = languagePairService.findDefaultForUser(userId)
    if (!pair) return reply.redirect('/')
    const { id } = request.params as { id: string }
    const result = bodyString(request, 'result')
    if (result !== 'correct' && result !== 'incorrect') return redirect(reply, '/review', 'Выберите один из вариантов ответа.')
    const currentDue = reviewService.getDue(userId, new Date(), 50, pair.id)
    if (!currentDue.some((entry) => entry.item.id === id)) return redirect(reply, '/review', 'Карточка уже не ожидает повторения.')
    reviewService.answer(userId, id, result, new Date())
    return redirect(reply, '/review')
  })
}
