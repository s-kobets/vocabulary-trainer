import type { Telegraf } from 'telegraf'
import type { BotContext } from './telegram.types'

const commands = [
  { command: 'start', description: 'Start setup' },
  { command: 'help', description: 'Show help' },
  { command: 'status', description: 'Show vocabulary status' },
  { command: 'languages', description: 'Manage language pairs' },
  { command: 'inbox', description: 'Show Inbox words' },
  { command: 'learning', description: 'Show learning words' },
  { command: 'review', description: 'Review due words' },
  { command: 'reminder', description: 'Manage daily review reminders' },
  { command: 'timezone', description: 'Set reminder timezone' },
  { command: 'delete', description: 'Delete words' },
  { command: 'edit', description: 'Edit word translations' },
]

export async function registerCommandMenu(bot: Telegraf<BotContext>): Promise<void> {
  await bot.telegram.setMyCommands(commands)
}
