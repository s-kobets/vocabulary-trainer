import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('dictionary check exits clearly without making a request when key is missing', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/dictionary/check.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, OPENAI_API_KEY: '' },
    encoding: 'utf8',
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /OPENAI_API_KEY is required/)
  assert.doesNotMatch(result.stderr, /Cannot find module/)
})
