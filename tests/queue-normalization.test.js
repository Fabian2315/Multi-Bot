const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizeQueueSettings,
  normalizeQueueStep,
  isWaitableQueueCommand,
  normalizeSavedQueueName,
  normalizeSavedQueueSlot,
  makeSavedQueueSlotName,
  parseSavedQueueSlotName,
  QUEUE_SAVE_SLOT_COUNT
} = require('../index')

test('normalizeQueueSettings clamps and sanitizes values', () => {
  const settings = normalizeQueueSettings({
    onFailure: 'not-valid',
    retryCount: 999,
    completionTimeoutSec: 1
  })

  assert.deepEqual(settings, {
    onFailure: 'stop',
    retryCount: 10,
    completionTimeoutSec: 5
  })
})

test('normalizeQueueStep supports force_wait variants', () => {
  const step = normalizeQueueStep({ type: 'wait', seconds: 4.2 })
  assert.equal(step.type, 'force_wait')
  assert.equal(step.seconds, 4.2)
})

test('normalizeQueueStep enforces waitable commands when waitForCompletion is true', () => {
  assert.throws(() => {
    normalizeQueueStep({
      type: 'command',
      command: 'Bot.attack Steve',
      waitForCompletion: true
    })
  }, /cannot wait for completion/i)

  const step = normalizeQueueStep({
    type: 'command',
    command: 'goto.nearest',
    waitForCompletion: true
  })

  assert.equal(step.command, 'Bot.goto.nearest')
  assert.equal(step.waitForCompletion, true)
})

test('isWaitableQueueCommand only accepts supported command families', () => {
  assert.equal(isWaitableQueueCommand('Bot.goto 1 2 3'), true)
  assert.equal(isWaitableQueueCommand('Bot.goto.nearest'), true)
  assert.equal(isWaitableQueueCommand('Bot.craft stick 4'), true)
  assert.equal(isWaitableQueueCommand('Bot.smelt iron_ingot 2'), true)
  assert.equal(isWaitableQueueCommand('Bot.collect dirt 2'), false)
})

test('saved queue name and slot validation works', () => {
  assert.equal(normalizeSavedQueueName('  Loop A  '), 'Loop A')
  assert.throws(() => normalizeSavedQueueName('   '), /required/i)

  assert.equal(normalizeSavedQueueSlot(1), 1)
  assert.equal(normalizeSavedQueueSlot(String(QUEUE_SAVE_SLOT_COUNT)), QUEUE_SAVE_SLOT_COUNT)
  assert.throws(() => normalizeSavedQueueSlot(0), /between 1/i)
  assert.throws(() => normalizeSavedQueueSlot(QUEUE_SAVE_SLOT_COUNT + 1), /between 1/i)

  const slotName = makeSavedQueueSlotName(2)
  assert.equal(slotName, '__slot_2')
  assert.equal(parseSavedQueueSlotName(slotName), 2)
  assert.equal(parseSavedQueueSlotName('normal-name'), null)
})
