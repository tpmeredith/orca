import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'vitest'

const require = createRequire(import.meta.url)
const { isPackagedExternalSpecifier } = require('../packaged-runtime-node-modules.cjs')

test('packaging accepts Node prefix-only SQLite while retaining missing-package checks', () => {
  assert.equal(isPackagedExternalSpecifier('node:sqlite'), false)
  assert.equal(isPackagedExternalSpecifier('node:fs'), false)
  assert.equal(isPackagedExternalSpecifier('fs'), false)
  assert.equal(isPackagedExternalSpecifier('sqlite'), true)
  assert.equal(isPackagedExternalSpecifier('node:not-a-builtin'), true)
  assert.equal(isPackagedExternalSpecifier('missing-runtime-package'), true)
})
