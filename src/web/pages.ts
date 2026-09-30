import type { LanguagePair } from '../languages/language-pair.types'
import type { Language } from '../languages/languages'
import type { DueReview } from '../reviews/review.types'
import type { VocabularyItem, VocabularyStatus } from '../vocabulary/vocabulary.types'

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]!))

function layout(title: string, content: string, active = ''): string {
  const nav = [['/', 'Обзор'], ['/vocabulary', 'Слова'], ['/review', 'Повторение']] as const
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f6f7f5"><title>${escapeHtml(title)} · Лексика</title><link rel="stylesheet" href="/app.css"></head><body><div class="app-shell"><aside class="sidebar"><a class="brand" href="/"><span class="brand-icon">L</span><span>lexi<span class="brand-light">flow</span></span></a><div class="side-label">МЕНЮ</div><nav>${nav.map(([href, label]) => `<a class="nav-link${active === href ? ' active' : ''}" href="${href}"><span class="nav-mark"></span>${label}</a>`).join('')}</nav><div class="side-bottom"><div class="side-note">Маленькие шаги<br><strong>каждый день</strong></div><form method="post" action="/logout"><button class="logout" type="submit">Выйти</button></form></div></aside><main class="main"><header class="topbar"><div class="mobile-brand">lexiflow</div><span class="top-caption">ТВОЙ ЛИЧНЫЙ СЛОВАРЬ</span><span class="avatar">✦</span></header><div class="content">${content}</div><footer>LEXIFLOW <span>·</span> учи в своём ритме</footer></main></div></body></html>`
}

function pairPicker(pairs: LanguagePair[], selected?: string): string {
  return `<form method="post" action="/languages/select" class="pair-form"><select name="pairId" aria-label="Языковая пара" onchange="this.form.submit()">${pairs.map((pair) => `<option value="${escapeHtml(pair.id)}"${pair.id === selected ? ' selected' : ''}>${escapeHtml(pair.sourceLanguage.toUpperCase())} → ${escapeHtml(pair.targetLanguage.toUpperCase())}</option>`).join('')}</select><span>⌄</span></form>`
}

function pairCreateDetails(languages: readonly Language[]): string {
  return `<details class="pair-add"><summary>Добавить языковую пару <span>＋</span></summary><form class="pair-create" method="post" action="/languages"><label>Изучаю<select name="source" required>${languages.map((language) => `<option value="${escapeHtml(language.code)}">${escapeHtml(language.name)}</option>`).join('')}</select></label><label>Перевод<select name="target" required>${languages.map((language) => `<option value="${escapeHtml(language.code)}"${language.code === 'ru' ? ' selected' : ''}>${escapeHtml(language.name)}</option>`).join('')}</select></label><button class="button primary" type="submit">Создать пару <span>→</span></button></form></details>`
}

export function renderLogin(botUsername?: string, authUrl = '/auth/telegram', message?: string): string {
  const widget = botUsername
    ? `<script async src="https://telegram.org/js/telegram-widget.js?22" data-telegram-login="${escapeHtml(botUsername)}" data-size="large" data-auth-url="${escapeHtml(authUrl)}"></script>`
    : '<p class="notice">Добавьте TELEGRAM_BOT_USERNAME в настройки приложения, чтобы включить вход.</p>'
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f6f7f5"><title>Вход · Lexiflow</title><link rel="stylesheet" href="/app.css"></head><body class="login-page"><main class="login-card"><a class="brand login-brand" href="/"><span class="brand-icon">L</span><span>lexi<span class="brand-light">flow</span></span></a><div class="login-orbit">✳</div><p class="eyebrow">ТВОЙ ПРОСТРАНСТВО ДЛЯ СЛОВ</p><h1>Слова остаются.<br><em>Ты растёшь.</em></h1><p class="login-copy">Собирай слова, возвращайся к ним вовремя и замечай, как растёт твой словарь.</p>${message ? `<p class="notice">${escapeHtml(message)}</p>` : ''}<div class="login-action">${widget}</div><p class="login-foot">Войдите через Telegram, чтобы открыть свой словарь.</p></main></body></html>`
}

export function renderDashboard(input: {
  pair: LanguagePair | null
  pairs: LanguagePair[]
  languages: readonly Language[]
  counts: Record<VocabularyStatus, number>
  due: number
  reviewed: number
  message?: string
}): string {
  const { pair, pairs, languages, counts, due, reviewed, message } = input
  const setup = `<section class="panel setup-panel"><div class="panel-kicker">НАЧНИТЕ С ЭТОГО</div><h2>Выберите языки</h2><p>Укажите, какие слова учите и на каком языке хотите видеть перевод.</p><form class="pair-create" method="post" action="/languages"><label>Изучаю<select name="source" required>${languages.map((language) => `<option value="${escapeHtml(language.code)}">${escapeHtml(language.name)}</option>`).join('')}</select></label><label>Перевод<select name="target" required>${languages.map((language) => `<option value="${escapeHtml(language.code)}"${language.code === 'ru' ? ' selected' : ''}>${escapeHtml(language.name)}</option>`).join('')}</select></label><button class="button primary" type="submit">Создать пару <span>→</span></button></form></section>`
  const body = pair ? `<div class="page-heading"><div><p class="eyebrow">СРЕДА, КОТОРАЯ ПОМНИТ ЗА ТЕБЯ</p><h1>С возвращением<span class="heading-dot">.</span></h1><p class="subheading">Продолжим понемногу — этого достаточно.</p></div>${pairPicker(pairs, pair.id)}</div>${message ? `<p class="notice">${escapeHtml(message)}</p>` : ''}<section class="hero-panel"><div class="hero-copy"><span class="hero-tag">ТВОЯ ПАРА · ${escapeHtml(pair.sourceLanguage.toUpperCase())} → ${escapeHtml(pair.targetLanguage.toUpperCase())}</span><h2>${due ? `${due} ${due === 1 ? 'слово ждёт' : 'слов ждут'} тебя` : 'Сегодня всё спокойно'}</h2><p>${due ? 'Время освежить знакомые слова в памяти.' : 'Новые слова и повторения появятся здесь.'}</p><a class="button light" href="/review">${due ? 'Начать повторение' : 'Открыть повторение'} <span>→</span></a></div><div class="hero-art"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><span class="hero-star">✳</span><span class="hero-word">word</span></div><div class="hero-index">01 <span>/ 03</span></div></section><div class="section-title"><div><p class="eyebrow">ТВОЙ ПРОГРЕСС</p><h2>Словарь в движении</h2></div><a class="text-link" href="/vocabulary">Все слова <span>→</span></a></div><section class="stats-grid"><a class="stat-card stat-due" href="/review"><span class="stat-icon">↻</span><span class="stat-label">К повторению</span><strong>${due}</strong><span class="stat-hint">готовы сейчас <b>→</b></span></a><a class="stat-card stat-inbox" href="/vocabulary?status=inbox"><span class="stat-icon">＋</span><span class="stat-label">Входящие</span><strong>${counts.inbox}</strong><span class="stat-hint">новые слова <b>→</b></span></a><a class="stat-card stat-learning" href="/vocabulary?status=learning"><span class="stat-icon">◌</span><span class="stat-label">Изучаю</span><strong>${counts.learning}</strong><span class="stat-hint">в процессе <b>→</b></span></a><a class="stat-card stat-known" href="/vocabulary?status=known"><span class="stat-icon">✓</span><span class="stat-label">Знаю</span><strong>${counts.known}</strong><span class="stat-hint">уже запомнил <b>→</b></span></a></section><section class="daily-note"><span class="note-star">✦</span><div><strong>${reviewed ? `Сегодня уже повторено: ${reviewed}` : 'Пять минут сегодня — меньше повторений завтра.'}</strong><span>Постоянство важнее скорости.</span></div></section>${pairCreateDetails(languages)}` : `<div class="page-heading"><div><p class="eyebrow">LEXIFLOW · ЛИЧНЫЙ СЛОВАРЬ</p><h1>Добро пожаловать<span class="heading-dot">.</span></h1><p class="subheading">Один выбор — и можно начинать.</p></div></div>${setup}`
  return layout('Обзор', body, '/')
}

export function renderVocabulary(input: {
  pair: LanguagePair
  pairs: LanguagePair[]
  items: VocabularyItem[]
  status?: VocabularyStatus
  query?: string
  message?: string
}): string {
  const { pair, pairs, items, status, query = '', message } = input
  const filters: [string, string][] = [['', 'Все'], ['inbox', 'Входящие'], ['learning', 'Изучаю'], ['known', 'Знаю']]
  const rows = items.length ? items.map((item) => `<article class="word-row"><div class="word-main"><span class="word-text">${escapeHtml(item.text)}</span><span class="word-translation">${item.translations.map(escapeHtml).join(' · ') || (item.enrichmentStatus ? 'Перевод подготавливается' : 'Перевод не указан')}</span>${item.transcription ? `<span class="word-transcription">${escapeHtml(item.transcription)}</span>` : ''}</div><span class="status-pill status-${item.status}">${item.status === 'inbox' ? 'Входящее' : item.status === 'learning' ? 'Изучаю' : 'Знаю'}</span>${item.status === 'inbox' ? `<form method="post" action="/vocabulary/${encodeURIComponent(item.id)}/learn"><button class="icon-button" aria-label="Начать учить ${escapeHtml(item.text)}" title="Начать учить">↗</button></form>` : ''}</article>`).join('') : '<div class="empty-state"><span>✳</span><h3>Здесь пока тихо</h3><p>Добавь первое слово — оно появится в словаре.</p></div>'
  const body = `<div class="page-heading"><div><p class="eyebrow">ТВОЯ КОЛЛЕКЦИЯ</p><h1>Слова<span class="heading-dot">.</span></h1><p class="subheading">${escapeHtml(pair.sourceLanguage.toUpperCase())} → ${escapeHtml(pair.targetLanguage.toUpperCase())}</p></div>${pairPicker(pairs, pair.id)}</div>${message ? `<p class="notice">${escapeHtml(message)}</p>` : ''}<section class="add-panel"><div><span class="panel-kicker">ПОПОЛНИТЬ СЛОВАРЬ</span><h2>Новое слово, новая возможность.</h2></div><form method="post" action="/vocabulary" class="add-form"><label class="sr-only" for="new-word">Слова или фразы, по одному на строку</label><textarea id="new-word" name="text" maxlength="10000" rows="2" placeholder="Например, serendipity" required></textarea><button class="button primary" type="submit">Добавить <span>＋</span></button></form><p class="form-hint">До 20 слов или фраз, по одному на строку. Перевод добавится автоматически.</p></section><div class="list-heading"><div><p class="eyebrow">ТВОИ ЗАПИСИ</p><h2>${items.length} ${items.length === 1 ? 'слово' : 'слова'}</h2></div><form class="search-form" method="get" action="/vocabulary"><input type="hidden" name="status" value="${escapeHtml(status ?? '')}"><input name="q" value="${escapeHtml(query)}" placeholder="Найти слово…" aria-label="Найти слово"><button aria-label="Искать">⌕</button></form></div><nav class="filter-tabs">${filters.map(([value, label]) => `<a class="filter-tab${(status ?? '') === value ? ' selected' : ''}" href="/vocabulary?status=${value}">${label}</a>`).join('')}</nav><section class="word-list">${rows}</section>`
  return layout('Слова', body, '/vocabulary')
}

export function renderReview(input: {
  pair: LanguagePair
  pairs: LanguagePair[]
  due: DueReview[]
  itemId?: string
  revealed?: boolean
  message?: string
}): string {
  const { pair, pairs, due, itemId, revealed, message } = input
  const current = due.find((entry) => entry.item.id === itemId) ?? due[0]
  const card = current ? `<div class="review-progress"><span>СЕССИЯ ПОВТОРЕНИЯ</span><span>${due.length} ${due.length === 1 ? 'КАРТОЧКА' : 'КАРТОЧКИ'}</span></div><article class="review-card"><span class="review-language">${escapeHtml(pair.sourceLanguage.toUpperCase())} <span>→</span> ${escapeHtml(pair.targetLanguage.toUpperCase())}</span><div class="review-word">${escapeHtml(current.item.text)}</div>${revealed ? `<div class="review-answer"><span>ПЕРЕВОД</span><strong>${current.item.translations.map(escapeHtml).join(' · ') || 'Перевод пока не добавлен'}</strong>${current.item.transcription ? `<small>${escapeHtml(current.item.transcription)}</small>` : ''}${current.item.examples.map((example) => `<p>${escapeHtml(example.source)}${example.target ? `<br><span>${escapeHtml(example.target)}</span>` : ''}</p>`).join('')}</div><div class="answer-actions"><form method="post" action="/review/${encodeURIComponent(current.item.id)}/answer"><input type="hidden" name="result" value="incorrect"><button class="button answer-wrong">Не вспомнил <span>↺</span></button></form><form method="post" action="/review/${encodeURIComponent(current.item.id)}/answer"><input type="hidden" name="result" value="correct"><button class="button answer-right">Вспомнил <span>✓</span></button></form></div>` : `<form method="post" action="/review/${encodeURIComponent(current.item.id)}/reveal"><button class="button primary reveal-button" type="submit">Показать ответ <span>↓</span></button></form>`}</article><p class="review-tip">Не торопись. Попробуй вспомнить слово до ответа.</p>` : `<div class="empty-state review-empty"><span>✳</span><h2>${message ? escapeHtml(message) : 'На сегодня всё.'}</h2><p>Когда придёт время, карточки появятся здесь.</p><a class="button primary" href="/">На главную <span>→</span></a></div>`
  const body = `<div class="page-heading"><div><p class="eyebrow">ПРАКТИКА С ИНТЕРВАЛАМИ</p><h1>Повторение<span class="heading-dot">.</span></h1><p class="subheading">Вспоминай — так слова остаются с тобой.</p></div>${pairPicker(pairs, pair.id)}</div>${card}`
  return layout('Повторение', body, '/review')
}
