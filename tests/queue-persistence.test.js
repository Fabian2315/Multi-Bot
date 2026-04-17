const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  ensureTargetQueue,
  ensureTargetSavedQueues,
  normalizeQueueStep,
  normalizeQueueSettings,
  saveQueuePersistence,
  loadQueuePersistence,
  serializeSavedQueues,
  serializeSavedQueueSlots,
  makeSavedQueueSlotName,
  __resetQueueStateForTests,
  __setQueuePersistenceFileForTests,
  __getQueuePersistenceFileForTests
} = require('../index')

function makeSavedEntry(name, settings, steps, ts) {
  return {
    name,
    createdAt: ts,
    updatedAt: ts,
    settings: normalizeQueueSettings(settings),
    steps: steps.map((step) => normalizeQueueStep(step))
  }
}

test('queue persistence round-trips named saves and slot saves', () => {
  const originalPath = __getQueuePersistenceFileForTests()
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mineflayer-queue-test-'))
  const tempFile = path.join(tempDir, 'queue-persistence.json')

  try {
    __setQueuePersistenceFileForTests(tempFile)
    __resetQueueStateForTests()

    const queue = ensureTargetQueue('starter')
    queue.settings = normalizeQueueSettings({ onFailure: 'retry', retryCount: 2, completionTimeoutSec: 90 })
    queue.steps = [
      normalizeQueueStep({ type: 'command', command: 'Bot.goto 10 64 10', waitForCompletion: true }),
      normalizeQueueStep({ type: 'force_wait', seconds: 3 })
    ]

    const saved = ensureTargetSavedQueues('starter')
    saved.set('Tree Farm Loop', makeSavedEntry('Tree Farm Loop', { onFailure: 'stop' }, [
      { type: 'command', command: 'Bot.collect oak_log 12', waitForCompletion: false }
    ], '2026-04-17T09:00:00.000Z'))

    saved.set(makeSavedQueueSlotName(1), makeSavedEntry(makeSavedQueueSlotName(1), { onFailure: 'skip' }, [
      { type: 'command', command: 'Bot.guard.here', waitForCompletion: false }
    ], '2026-04-17T09:01:00.000Z'))

    saved.set(makeSavedQueueSlotName(2), makeSavedEntry(makeSavedQueueSlotName(2), { onFailure: 'retry', retryCount: 1 }, [
      { type: 'command', command: 'Bot.craft stick 8', waitForCompletion: true }
    ], '2026-04-17T09:02:00.000Z'))

    saveQueuePersistence()

    __resetQueueStateForTests()
    loadQueuePersistence()

    const restoredQueue = ensureTargetQueue('starter')
    assert.equal(restoredQueue.steps.length, 2)
    assert.equal(restoredQueue.settings.onFailure, 'retry')

    const visibleSaved = serializeSavedQueues('starter')
    assert.equal(visibleSaved.length, 1)
    assert.equal(visibleSaved[0].name, 'Tree Farm Loop')

    const slots = serializeSavedQueueSlots('starter')
    assert.equal(slots[0].hasQueue, true)
    assert.equal(slots[0].stepCount, 1)
    assert.equal(slots[1].hasQueue, true)
    assert.equal(slots[2].hasQueue, false)
  } finally {
    __setQueuePersistenceFileForTests(originalPath)
    __resetQueueStateForTests()
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('loadQueuePersistence handles version 1 files', () => {
  const originalPath = __getQueuePersistenceFileForTests()
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mineflayer-queue-v1-test-'))
  const tempFile = path.join(tempDir, 'queue-persistence.json')

  try {
    fs.writeFileSync(tempFile, JSON.stringify({
      version: 1,
      queues: {
        starter: {
          settings: { onFailure: 'skip', retryCount: 0, completionTimeoutSec: 30 },
          steps: [
            { id: 'step-old', type: 'command', command: 'Bot.goto.nearest', waitForCompletion: true }
          ]
        }
      }
    }, null, 2), 'utf8')

    __setQueuePersistenceFileForTests(tempFile)
    __resetQueueStateForTests()
    loadQueuePersistence()

    const queue = ensureTargetQueue('starter')
    assert.equal(queue.settings.onFailure, 'skip')
    assert.equal(queue.steps.length, 1)
    assert.equal(queue.steps[0].command, 'Bot.goto.nearest')
  } finally {
    __setQueuePersistenceFileForTests(originalPath)
    __resetQueueStateForTests()
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
