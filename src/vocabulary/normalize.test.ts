import { strict as assert } from 'node:assert'
import test from 'node:test'
import { classifyText, normalizeText } from './normalize'

test('normalizeText trims, lowercases, and collapses whitespace', () => {
  assert.equal(normalizeText('  Reliable   Service '), 'reliable service')
  assert.equal(normalizeText('Reliable'), 'reliable')
})

test('classifyText uses whitespace to distinguish phrases', () => {
  assert.equal(classifyText('reliable'), 'word')
  assert.equal(classifyText('figure out'), 'phrase')
})
