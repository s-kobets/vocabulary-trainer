import { strict as assert } from 'node:assert'
import test from 'node:test'
import { registerCommandMenu } from './commands'

test('registers the Telegram command menu', async () => {
  let received: unknown
  await registerCommandMenu({ telegram: { setMyCommands: async (commands: unknown) => { received = commands } } } as never)
  assert.deepEqual(received, [
    { command: 'start', description: 'Start setup' },
    { command: 'help', description: 'Show help' },
    { command: 'status', description: 'Show vocabulary status' },
    { command: 'languages', description: 'Manage language pairs' },
    { command: 'inbox', description: 'Show Inbox words' },
    { command: 'learning', description: 'Show learning words' },
    { command: 'review', description: 'Review due words' },
    { command: 'delete', description: 'Delete words' },
  ])
})
