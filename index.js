const fs = require('fs')
const path = require('path')
const http = require('http')
const express = require('express')
const { Server } = require('socket.io')
const mineflayer = require('mineflayer')
const tpsPlugin = require('mineflayer-tps')(mineflayer)
const mineflayerViewer = require('prismarine-viewer').mineflayer
const {
  pathfinder,
  Movements,
  goals: { GoalNear, GoalFollow, GoalBlock }
} = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const collectBlock = require('mineflayer-collectblock').plugin
const autoEat = require('mineflayer-auto-eat').loader
const armorManager = require('mineflayer-armor-manager')
const nbt = require('prismarine-nbt')
const recipeRegistry = require('./data/recipe-registry')

const SETTINGS_FILE = path.join(__dirname, 'bot-settings.json')
const STARTER_BOT_ID = 'starter'

const DEFAULT_COMMAND_SETTINGS = {
  rangeGoal: 1,
  craftSearchRadius: 32,
  emptyInventoryRadius: 50,
  collectRadius: 64,
  mineSearchRadius: 64,
  mineRoamMinDistance: 50,
  mineRoamMaxDistance: 100,
  guardProtectRadius: 16,
  guardContinuePursuitRadius: 20,
  selfDefenseTargetDistance: 12,
  selfDefenseChaseDistance: 14
}

const DEFAULT_QUEUE_SETTINGS = {
  onFailure: 'stop',
  retryCount: 1,
  completionTimeoutSec: 60
}

const DEFAULT_BOT_SETTINGS = {
  host: 'localhost',
  port: 25565,
  version: '1.21.11',
  viewerPort: 3008,
  webPort: 3000,
  starterUsername: 'Bot',
  starterAuth: 'offline',
  starterToken: '',
  viewerEnabled: true,
  tpsDashboardEnabled: true,
  viewerTargetBotId: STARTER_BOT_ID,
  commandSettings: { ...DEFAULT_COMMAND_SETTINGS },
  queueSettings: { ...DEFAULT_QUEUE_SETTINGS },
  bots: [],
  groups: []
}

function safeArray(value) {
  return Array.isArray(value) ? value : []
}

function normalizeAuth(value) {
  const auth = String(value || 'offline').toLowerCase()
  if (auth === 'microsoft' || auth === 'token') return auth
  return 'offline'
}

function normalizeNumber(value, fallback, options = {}) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback

  let normalized = number
  if (options.integer) normalized = Math.round(normalized)
  if (typeof options.min === 'number') normalized = Math.max(options.min, normalized)
  if (typeof options.max === 'number') normalized = Math.min(options.max, normalized)
  return normalized
}

function normalizeCommandSettings(settings) {
  const input = settings || {}
  return {
    rangeGoal: normalizeNumber(input.rangeGoal, DEFAULT_COMMAND_SETTINGS.rangeGoal, { min: 0, integer: true }),
    craftSearchRadius: normalizeNumber(input.craftSearchRadius, DEFAULT_COMMAND_SETTINGS.craftSearchRadius, { min: 1, integer: true }),
    emptyInventoryRadius: normalizeNumber(input.emptyInventoryRadius, DEFAULT_COMMAND_SETTINGS.emptyInventoryRadius, { min: 1, integer: true }),
    collectRadius: normalizeNumber(input.collectRadius, DEFAULT_COMMAND_SETTINGS.collectRadius, { min: 1, integer: true }),
    mineSearchRadius: normalizeNumber(input.mineSearchRadius, DEFAULT_COMMAND_SETTINGS.mineSearchRadius, { min: 1, integer: true }),
    mineRoamMinDistance: normalizeNumber(input.mineRoamMinDistance, DEFAULT_COMMAND_SETTINGS.mineRoamMinDistance, { min: 1 }),
    mineRoamMaxDistance: normalizeNumber(input.mineRoamMaxDistance, DEFAULT_COMMAND_SETTINGS.mineRoamMaxDistance, { min: 1 }),
    guardProtectRadius: normalizeNumber(input.guardProtectRadius, DEFAULT_COMMAND_SETTINGS.guardProtectRadius, { min: 1, integer: true }),
    guardContinuePursuitRadius: normalizeNumber(input.guardContinuePursuitRadius, DEFAULT_COMMAND_SETTINGS.guardContinuePursuitRadius, { min: 1, integer: true }),
    selfDefenseTargetDistance: normalizeNumber(input.selfDefenseTargetDistance, DEFAULT_COMMAND_SETTINGS.selfDefenseTargetDistance, { min: 1, integer: true }),
    selfDefenseChaseDistance: normalizeNumber(input.selfDefenseChaseDistance, DEFAULT_COMMAND_SETTINGS.selfDefenseChaseDistance, { min: 1, integer: true })
  }
}

function normalizeQueueSettings(settings) {
  const input = settings || {}
  const onFailureRaw = String(input.onFailure || DEFAULT_QUEUE_SETTINGS.onFailure).toLowerCase()
  const onFailure = ['stop', 'skip', 'retry'].includes(onFailureRaw) ? onFailureRaw : DEFAULT_QUEUE_SETTINGS.onFailure

  return {
    onFailure,
    retryCount: normalizeNumber(input.retryCount, DEFAULT_QUEUE_SETTINGS.retryCount, { min: 0, max: 10, integer: true }),
    completionTimeoutSec: normalizeNumber(input.completionTimeoutSec, DEFAULT_QUEUE_SETTINGS.completionTimeoutSec, { min: 5, max: 600, integer: true })
  }
}

function loadBotSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8')
    const parsed = JSON.parse(raw)

    return {
      ...DEFAULT_BOT_SETTINGS,
      ...parsed,
      host: String(parsed.host || DEFAULT_BOT_SETTINGS.host),
      version: String(parsed.version || DEFAULT_BOT_SETTINGS.version),
      port: Number(parsed.port) || DEFAULT_BOT_SETTINGS.port,
      viewerPort: Number(parsed.viewerPort) || DEFAULT_BOT_SETTINGS.viewerPort,
      webPort: Number(parsed.webPort) || DEFAULT_BOT_SETTINGS.webPort,
      starterUsername: String(parsed.starterUsername || parsed.username || DEFAULT_BOT_SETTINGS.starterUsername),
      starterAuth: normalizeAuth(parsed.starterAuth),
      starterToken: String(parsed.starterToken || ''),
      viewerEnabled: typeof parsed.viewerEnabled === 'boolean' ? parsed.viewerEnabled : DEFAULT_BOT_SETTINGS.viewerEnabled,
      tpsDashboardEnabled: typeof parsed.tpsDashboardEnabled === 'boolean' ? parsed.tpsDashboardEnabled : DEFAULT_BOT_SETTINGS.tpsDashboardEnabled,
      viewerTargetBotId: String(parsed.viewerTargetBotId || STARTER_BOT_ID),
      commandSettings: normalizeCommandSettings(parsed.commandSettings),
      queueSettings: normalizeQueueSettings(parsed.queueSettings),
      bots: safeArray(parsed.bots)
        .map((bot) => ({
          id: String(bot.id || ''),
          username: String(bot.username || '').trim(),
          auth: normalizeAuth(bot.auth),
          token: String(bot.token || '')
        }))
        .filter((bot) => bot.id && bot.username),
      groups: safeArray(parsed.groups)
        .map((group) => ({
          id: String(group.id || ''),
          name: String(group.name || '').trim(),
          botIds: safeArray(group.botIds).map((id) => String(id))
        }))
        .filter((group) => group.id && group.name)
    }
  } catch {
    return { ...DEFAULT_BOT_SETTINGS }
  }
}

function saveBotSettings(settings) {
  const normalized = {
    ...DEFAULT_BOT_SETTINGS,
    ...settings,
    host: String(settings.host || DEFAULT_BOT_SETTINGS.host),
    version: String(settings.version || DEFAULT_BOT_SETTINGS.version),
    port: Number(settings.port) || DEFAULT_BOT_SETTINGS.port,
    viewerPort: Number(settings.viewerPort) || DEFAULT_BOT_SETTINGS.viewerPort,
    webPort: Number(settings.webPort) || DEFAULT_BOT_SETTINGS.webPort,
    starterUsername: String(settings.starterUsername || DEFAULT_BOT_SETTINGS.starterUsername),
    starterAuth: normalizeAuth(settings.starterAuth),
    starterToken: String(settings.starterToken || ''),
    viewerEnabled: typeof settings.viewerEnabled === 'boolean' ? settings.viewerEnabled : DEFAULT_BOT_SETTINGS.viewerEnabled,
    tpsDashboardEnabled: typeof settings.tpsDashboardEnabled === 'boolean' ? settings.tpsDashboardEnabled : DEFAULT_BOT_SETTINGS.tpsDashboardEnabled,
    viewerTargetBotId: String(settings.viewerTargetBotId || STARTER_BOT_ID),
    commandSettings: normalizeCommandSettings(settings.commandSettings),
    queueSettings: normalizeQueueSettings(settings.queueSettings),
    bots: safeArray(settings.bots)
      .map((bot) => ({
        id: String(bot.id || ''),
        username: String(bot.username || '').trim(),
        auth: normalizeAuth(bot.auth),
        token: String(bot.token || '')
      }))
      .filter((bot) => bot.id && bot.username),
    groups: safeArray(settings.groups)
      .map((group) => ({
        id: String(group.id || ''),
        name: String(group.name || '').trim(),
        botIds: safeArray(group.botIds).map((id) => String(id))
      }))
      .filter((group) => group.id && group.name)
  }

  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(normalized, null, 2) + '\n', 'utf8')
}

const botSettings = loadBotSettings()
const runtimes = new Map()
const webLogs = []
let io = null
let lastStateSignature = ''
let viewerEnabled = Boolean(botSettings.viewerEnabled)
let tpsDashboardEnabled = typeof botSettings.tpsDashboardEnabled === 'boolean' ? botSettings.tpsDashboardEnabled : true
let viewerAttachedBotId = null
const queueByTarget = new Map()

const HOSTILE_ENTITY_NAMES = new Set([
  'zombie',
  'husk',
  'drowned',
  'zombie_villager',
  'skeleton',
  'stray',
  'wither_skeleton',
  'spider',
  'cave_spider',
  'creeper',
  'enderman',
  'witch',
  'slime',
  'magma_cube',
  'pillager',
  'vindicator',
  'evoker',
  'ravager',
  'phantom',
  'hoglin',
  'zoglin',
  'piglin_brute',
  'silverfish',
  'endermite',
  'blaze',
  'ghast',
  'guardian',
  'elder_guardian',
  'shulker',
  'warden'
])

function pushWebLog(type, message, botId = null) {
  const entry = {
    ts: new Date().toISOString(),
    type,
    botId,
    message
  }

  webLogs.push(entry)
  if (webLogs.length > 400) webLogs.shift()
  if (io) io.emit('log', entry)
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'bot'
}

function makeUniqueBotId(username) {
  const base = slugify(username)
  let id = base
  let i = 1

  while (id === STARTER_BOT_ID || runtimes.has(id) || botSettings.bots.some((bot) => bot.id === id)) {
    i += 1
    id = `${base}-${i}`
  }

  return id
}

function normalizeCommand(input) {
  const raw = String(input || '').trim()
  if (!raw) return ''
  return raw.startsWith('Bot.') ? raw : `Bot.${raw}`
}

function getViewerUrl() {
  return `http://localhost:${botSettings.viewerPort}`
}

function getBotsState() {
  return Array.from(runtimes.values()).map((runtime) => runtime.getState())
}

function getDashboardState() {
  return {
    host: botSettings.host,
    port: botSettings.port,
    viewerEnabled,
    tpsDashboardEnabled,
    viewerTargetBotId: botSettings.viewerTargetBotId,
    viewerActiveBotId: viewerAttachedBotId,
    viewerUrl: getViewerUrl(),
    bots: getBotsState(),
    groups: botSettings.groups,
    queueSettings: normalizeQueueSettings(botSettings.queueSettings)
  }
}

function makeQueueStepId() {
  return `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function isWaitableQueueCommand(command) {
  const normalized = normalizeCommand(command)
  if (!normalized) return false
  return normalized.startsWith('Bot.goto ') || normalized === 'Bot.goto.nearest' || normalized.startsWith('Bot.craft ')
}

function normalizeQueueStep(stepInput) {
  const step = stepInput || {}
  const type = String(step.type || '').toLowerCase()
  const id = String(step.id || makeQueueStepId())

  if (type === 'wait') {
    const seconds = normalizeNumber(step.seconds, 1, { min: 1, max: 3600 })
    return { id, type: 'wait', seconds }
  }

  if (type === 'command') {
    const command = normalizeCommand(step.command)
    if (!command) throw new Error('Queue command step is missing command text')

    const waitForCompletion = Boolean(step.waitForCompletion)
    if (waitForCompletion && !isWaitableQueueCommand(command)) {
      throw new Error('This command cannot wait for completion. Only Bot.goto variants and Bot.craft are supported.')
    }

    return { id, type: 'command', command, waitForCompletion }
  }

  throw new Error('Queue step type must be "command" or "wait"')
}

function getQueueDefaultSettings() {
  return normalizeQueueSettings(botSettings.queueSettings)
}

function ensureTargetQueue(target) {
  const targetKey = String(target || STARTER_BOT_ID)
  let queue = queueByTarget.get(targetKey)

  if (!queue) {
    queue = {
      target: targetKey,
      steps: [],
      running: false,
      stopRequested: false,
      currentStepIndex: -1,
      settings: getQueueDefaultSettings(),
      perBot: {},
      lastError: null
    }
    queueByTarget.set(targetKey, queue)
  }

  return queue
}

function serializeTargetQueue(queue) {
  return {
    target: queue.target,
    steps: queue.steps,
    running: queue.running,
    stopRequested: queue.stopRequested,
    currentStepIndex: queue.currentStepIndex,
    settings: queue.settings,
    perBot: queue.perBot,
    lastError: queue.lastError
  }
}

function emitQueueState(target) {
  if (!io) return
  const queue = ensureTargetQueue(target)
  io.emit('queue_state', { target: queue.target, queue: serializeTargetQueue(queue) })
}

async function waitMsWithStop(ms, shouldStop) {
  const started = Date.now()

  while (Date.now() - started < ms) {
    if (shouldStop()) {
      throw new Error('Queue stopped')
    }

    const remaining = ms - (Date.now() - started)
    const chunk = Math.max(10, Math.min(250, remaining))
    await new Promise((resolve) => setTimeout(resolve, chunk))
  }
}

async function runQueueForBot({ queue, botId, username }) {
  queue.perBot[botId] = {
    status: 'running',
    stepIndex: 0,
    error: null,
    retries: 0
  }
  emitQueueState(queue.target)

  for (let stepIndex = 0; stepIndex < queue.steps.length; stepIndex += 1) {
    if (queue.stopRequested) {
      queue.perBot[botId] = {
        ...queue.perBot[botId],
        status: 'stopped',
        stepIndex,
        error: 'Queue stopped'
      }
      emitQueueState(queue.target)
      return
    }

    queue.currentStepIndex = stepIndex
    queue.perBot[botId] = {
      ...queue.perBot[botId],
      status: 'running',
      stepIndex,
      error: null,
      retries: 0
    }
    emitQueueState(queue.target)

    const step = queue.steps[stepIndex]
    let attempt = 0

    while (true) {
      try {
        if (step.type === 'wait') {
          await waitMsWithStop(step.seconds * 1000, () => queue.stopRequested)
        } else {
          const runtime = runtimes.get(botId)
          if (!runtime) throw new Error(`Bot ${botId} is not available`)

          await runtime.runQueueCommand({
            username,
            command: step.command,
            waitForCompletion: step.waitForCompletion,
            timeoutMs: queue.settings.completionTimeoutSec * 1000,
            shouldStop: () => queue.stopRequested
          })
        }
        break
      } catch (error) {
        const message = error?.message || String(error)
        attempt += 1

        if (queue.settings.onFailure === 'retry' && attempt <= queue.settings.retryCount) {
          queue.perBot[botId] = {
            ...queue.perBot[botId],
            retries: attempt,
            error: message
          }
          emitQueueState(queue.target)
          await waitMsWithStop(1000, () => queue.stopRequested)
          continue
        }

        if (queue.settings.onFailure === 'skip') {
          queue.perBot[botId] = {
            ...queue.perBot[botId],
            status: 'running',
            error: `Skipped: ${message}`,
            retries: attempt
          }
          emitQueueState(queue.target)
          break
        }

        queue.perBot[botId] = {
          ...queue.perBot[botId],
          status: 'failed',
          error: message,
          retries: attempt
        }
        queue.lastError = `Bot ${botId}: ${message}`
        queue.stopRequested = true
        emitQueueState(queue.target)
        return
      }
    }
  }

  if (queue.perBot[botId]?.status !== 'failed' && queue.perBot[botId]?.status !== 'stopped') {
    queue.perBot[botId] = {
      ...queue.perBot[botId],
      status: 'completed',
      stepIndex: queue.steps.length - 1,
      error: null
    }
  }
  emitQueueState(queue.target)
}

async function startTargetQueue({ target, username = 'WebUI' }) {
  const queue = ensureTargetQueue(target)
  if (queue.running) throw new Error('Queue is already running for this target')
  if (!queue.steps.length) throw new Error('Queue is empty')

  const targetIds = resolveTargetBotIds(queue.target)
  if (!targetIds.length) throw new Error('No bots resolved for target')

  queue.running = true
  queue.stopRequested = false
  queue.currentStepIndex = 0
  queue.lastError = null
  queue.perBot = {}
  emitQueueState(queue.target)

  pushWebLog('command', `${username} started queue [target=${queue.target}]`)

  try {
    await Promise.all(targetIds.map((botId) => runQueueForBot({ queue, botId, username })))
  } finally {
    queue.running = false
    queue.stopRequested = false
    queue.currentStepIndex = -1
    emitQueueState(queue.target)
  }

  return { targetIds }
}

function stopTargetQueue(target) {
  const queue = ensureTargetQueue(target)
  queue.stopRequested = true
  emitQueueState(queue.target)
}

function broadcastState(force = false) {
  if (!io) return

  const state = getDashboardState()
  const signature = JSON.stringify(state)
  if (!force && signature === lastStateSignature) return
  lastStateSignature = signature
  io.emit('state', state)
}

setInterval(() => {
  broadcastState()
}, 1000)

function stopViewer() {
  if (!viewerAttachedBotId) return false

  const runtime = runtimes.get(viewerAttachedBotId)
  const viewer = runtime?.bot?.viewer

  if (!viewer || typeof viewer.close !== 'function') {
    viewerAttachedBotId = null
    return false
  }

  viewer.close()
  delete runtime.bot.viewer
  pushWebLog('system', `Prismarine viewer stopped (was targeting ${viewerAttachedBotId})`)
  viewerAttachedBotId = null
  return true
}

function startViewerFor(botId) {
  if (!viewerEnabled) return false

  const runtime = runtimes.get(botId)
  if (!runtime?.bot?.player) return false

  if (viewerAttachedBotId === botId && runtime.bot.viewer && typeof runtime.bot.viewer.close === 'function') {
    return true
  }

  if (viewerAttachedBotId && viewerAttachedBotId !== botId) {
    stopViewer()
  }

  if (runtime.bot.viewer && typeof runtime.bot.viewer.close === 'function') {
    viewerAttachedBotId = botId
    return true
  }

  mineflayerViewer(runtime.bot, {
    port: botSettings.viewerPort,
    firstPerson: true,
    viewDistance: 5
  }) 
  viewerAttachedBotId = botId
  pushWebLog('system', `Prismarine viewer active on ${botId} at ${getViewerUrl()}`, botId)
  return true
}

function setViewerTarget(botId) {
  if (!runtimes.has(botId)) {
    throw new Error(`Unknown bot id: ${botId}`)
  }

  botSettings.viewerTargetBotId = botId
  saveBotSettings(botSettings)

  if (viewerEnabled) {
    startViewerFor(botId)
  }

  broadcastState(true)
}

function setViewerEnabled(enabled) {
  viewerEnabled = Boolean(enabled)
  botSettings.viewerEnabled = viewerEnabled

  if (!viewerEnabled) {
    stopViewer()
  } else {
    startViewerFor(botSettings.viewerTargetBotId)
  }

  broadcastState(true)
}

function setTpsDashboardEnabled(enabled) {
  tpsDashboardEnabled = Boolean(enabled)
  botSettings.tpsDashboardEnabled = tpsDashboardEnabled
  saveBotSettings(botSettings)
  broadcastState(true)
}

function installChatProxy(runtime, silentModeRef) {
  const targetBot = runtime.bot
  if (!targetBot || targetBot.__chatProxyInstalled) return

  const tryInstallProxy = () => {
    if (targetBot.__chatProxyInstalled) return true
    if (typeof targetBot.chat !== 'function') return false

    const originalChat = targetBot.chat.bind(targetBot)
    targetBot.chat = (message, ...args) => {
      const text = String(message)
      pushWebLog('bot', text, runtime.id)
      if (silentModeRef.value) return
      return originalChat(message, ...args)
    }

    targetBot.__chatProxyInstalled = true
    targetBot.removeListener('login', tryInstallProxy)
    targetBot.removeListener('spawn', tryInstallProxy)
    return true
  }

  if (tryInstallProxy()) return
  targetBot.once('login', tryInstallProxy)
  targetBot.once('spawn', tryInstallProxy)
}

function createBotRuntime({ id, username, auth = 'offline', token = '', isStarter = false }) {
  const silentModeRef = { value: false }
  let defaultMove = null
  let mcData = null
  let miningEnabled = false
  let guardPos = null
  let guardAttackInProgress = false
  let selfDefenseEnabled = true
  let selfDefenseInProgress = false
  let recentDamagerEntityId = null
  let recentDamagerAt = 0
  let trackedGoalState = {
    goal: null,
    dynamic: false,
    meta: null
  }
  let autoEatEnabled = false

  const botOptions = {
    host: botSettings.host,
    port: botSettings.port,
    username,
    version: botSettings.version
  }

  if (auth === 'microsoft') {
    botOptions.auth = 'microsoft'
    botOptions.onMsaCode = (data) => {
      io?.emit('auth_required', {
        botId: id,
        url: data?.verification_uri || data?.verificationUri || 'https://www.microsoft.com/link',
        userCode: data?.user_code || data?.userCode || ''
      })
      pushWebLog('system', `Microsoft auth code ready for ${id}`, id)
    }
  } else if (auth === 'token' && token) {
    botOptions.auth = 'microsoft'
    botOptions.session = {
      accessToken: token,
      selectedProfile: {
        id: '00000000000000000000000000000000',
        name: username
      }
    }
  }

  const bot = mineflayer.createBot(botOptions)

  // Load a fresh pathfinder session for this specific bot instance.
  // Each bot gets its own pathfinder state and separate search settings.
  bot.loadPlugin(pathfinder)
  bot.once('inject_allowed', () => {
    if (!bot.pathfinder) return
    bot.pathfinder.thinkTimeout = 1000
    bot.pathfinder.tickTimeout = 15
    bot.pathfinder.searchRadius = 64
    bot.pathfinder.enablePathShortcut = true
  })

  bot.loadPlugin(pvp)
  bot.loadPlugin(collectBlock)
  bot.loadPlugin(autoEat)
  bot.loadPlugin(armorManager)
  bot.loadPlugin(tpsPlugin)

  const runtime = {
    id,
    isStarter,
    auth,
    token,
    username,
    bot,
    getState,
    processCommand,
    toggleByName,
    setSelfDefense,
    setAutoEat,
    setSilent,
    runQueueCommand,
    async shutdown() {
      miningEnabled = false
      guardPos = null
      if (viewerAttachedBotId === id) stopViewer()
      try {
        bot.quit('disconnect')
      } catch {
        // Ignore disconnect errors.
      }
    }
  }

  installChatProxy(runtime, silentModeRef)

  function getInventory() {
    if (!bot.player) return []

    const inventory = bot.inventory.items().map((item) => ({
      name: item.displayName || item.name || `item_${item.type}`,
      count: item.count,
      slot: item.slot
    }))

    inventory.sort((a, b) => {
      if (a.name === b.name) return a.slot - b.slot
      return a.name.localeCompare(b.name)
    })

    return inventory
  }

  function getState() {
    const connected = Boolean(bot.player)
    const currentTps = (tpsDashboardEnabled && connected && typeof bot.getTps === 'function')
      ? Number(bot.getTps())
      : null

    const state = {
      id,
      username,
      auth,
      connected,
      selfDefenseEnabled,
      autoEatEnabled,
      miningEnabled,
      guardEnabled: Boolean(guardPos),
      silentModeEnabled: silentModeRef.value,
      viewerEnabled,
      viewerTarget: botSettings.viewerTargetBotId === id,
      viewerActive: viewerAttachedBotId === id,
      viewerUrl: getViewerUrl(),
      tps: Number.isFinite(currentTps) ? Math.round(currentTps * 100) / 100 : null,
      health: connected && typeof bot.health === 'number' ? bot.health : null,
      hunger: connected && typeof bot.food === 'number' ? bot.food : null,
      inventory: getInventory()
    }

    state.position = connected && bot.entity
      ? {
          x: Math.round(bot.entity.position.x * 10) / 10,
          y: Math.round(bot.entity.position.y * 10) / 10,
          z: Math.round(bot.entity.position.z * 10) / 10
        }
      : null

    return state
  }

  function getCommandSettings() {
    return {
      ...DEFAULT_COMMAND_SETTINGS,
      ...(botSettings.commandSettings || {})
    }
  }

  function say(text) {
    if (typeof bot.chat === 'function') {
      bot.chat(text)
    }
  }

  function setSelfDefense(enabled) {
    selfDefenseEnabled = Boolean(enabled)
    say(`Self defense ${selfDefenseEnabled ? 'enabled' : 'disabled'}`)
    broadcastState(true)
    return selfDefenseEnabled
  }

  function setTrackedGoal(goal, dynamic = false, meta = null) {
    trackedGoalState = { goal, dynamic, meta }
    bot.pathfinder.setGoal(goal, dynamic)
  }

  function captureCurrentIntent() {
    const currentGoal = trackedGoalState.goal
    const currentMeta = trackedGoalState.meta
    let goalIntent = {
      goal: currentGoal,
      dynamic: trackedGoalState.dynamic,
      type: 'generic'
    }

    if (currentMeta?.type === 'follow') {
      const commandSettings = getCommandSettings()
      goalIntent = {
        type: 'follow',
        dynamic: true,
        entity: currentMeta.entity || null,
        username: currentMeta.username || null,
        range: typeof currentMeta.range === 'number' ? currentMeta.range : commandSettings.rangeGoal
      }
    }

    if (goalIntent.type !== 'follow' && currentGoal && currentGoal.constructor?.name === 'GoalFollow' && currentGoal.entity) {
      const commandSettings = getCommandSettings()
      goalIntent = {
        type: 'follow',
        dynamic: true,
        entity: currentGoal.entity,
        range: typeof currentGoal.range === 'number' ? currentGoal.range : commandSettings.rangeGoal
      }
    }

    return {
      goal: goalIntent,
      pvpTarget: bot.pvp.target || null
    }
  }

  function restoreIntent(intent) {
    if (!intent) return

    if (intent.goal.type === 'follow') {
      const targetFromName = intent.goal.username ? bot.players[intent.goal.username]?.entity : null
      const targetEntity = targetFromName || intent.goal.entity
      if (targetEntity && targetEntity.isValid !== false) {
        setTrackedGoal(new GoalFollow(targetEntity, intent.goal.range), true, {
          type: 'follow',
          entity: targetEntity,
          username: intent.goal.username || targetEntity.username || null,
          range: intent.goal.range
        })
      } else {
        setTrackedGoal(null)
      }
    } else if (intent.goal.goal) {
      setTrackedGoal(intent.goal.goal, intent.goal.dynamic)
    } else {
      setTrackedGoal(null)
    }

    if (intent.pvpTarget && intent.pvpTarget.isValid !== false) {
      bot.pvp.attack(intent.pvpTarget)
    }
  }

  function waitMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  function formatItemName(name) {
    return String(name || 'unknown_item').replace(/_/g, ' ')
  }

  function getItemDataById(itemType) {
    if (!mcData) return null
    return mcData.items[itemType] || null
  }

  function getItemLabel(itemType, metadata = null) {
    const itemData = getItemDataById(itemType)
    if (itemData?.displayName) return itemData.displayName
    if (itemData?.name) return formatItemName(itemData.name)
    if (typeof metadata === 'number') return `item ${itemType}:${metadata}`
    return `item ${itemType}`
  }

  function countInventoryItem(itemType, metadata = null) {
    return bot.inventory.items().reduce((total, item) => {
      if (item.type !== itemType) return total
      if (metadata != null && item.metadata !== metadata) return total
      return total + item.count
    }, 0)
  }

  function buildRecipeIngredientPlan(recipe, craftCount) {
    const requiredByKey = new Map()

    for (const delta of recipe.delta || []) {
      if (!delta || delta.count >= 0) continue

      const metadata = delta.metadata == null ? null : delta.metadata
      const key = `${delta.id}:${metadata == null ? '*' : metadata}`
      const requiredCount = Math.abs(delta.count) * craftCount
      const existing = requiredByKey.get(key)

      if (existing) {
        existing.required += requiredCount
      } else {
        requiredByKey.set(key, {
          itemType: delta.id,
          metadata,
          required: requiredCount
        })
      }
    }

    return Array.from(requiredByKey.values()).map((entry) => {
      const available = countInventoryItem(entry.itemType, entry.metadata)
      const missing = Math.max(0, entry.required - available)

      return {
        ...entry,
        available,
        missing,
        label: getItemLabel(entry.itemType, entry.metadata)
      }
    })
  }

  function buildRecipePlan({ recipe, itemData, requestedCount }) {
    const resultPerCraft = Math.max(1, recipe.result?.count || 1)
    const craftCount = Math.max(1, Math.ceil(requestedCount / resultPerCraft))
    const ingredients = buildRecipeIngredientPlan(recipe, craftCount)
    const missing = ingredients.filter((ingredient) => ingredient.missing > 0)
    const missingTotal = missing.reduce((total, ingredient) => total + ingredient.missing, 0)

    return {
      recipe,
      craftCount,
      requestedCount,
      producedCount: craftCount * resultPerCraft,
      resultPerCraft,
      ingredients,
      missing,
      missingTotal,
      requiresTable: Boolean(recipe.requiresTable),
      station: recipe.requiresTable ? 'crafting_table' : 'inventory',
      resultLabel: itemData.displayName || formatItemName(itemData.name)
    }
  }

  function chooseRecipePlan(recipePlans) {
    if (!recipePlans.length) return null

    return recipePlans.slice().sort((left, right) => {
      if (left.missingTotal === 0 && right.missingTotal > 0) return -1
      if (right.missingTotal === 0 && left.missingTotal > 0) return 1
      if (left.missingTotal !== right.missingTotal) return left.missingTotal - right.missingTotal
      if (left.requiresTable !== right.requiresTable) return left.requiresTable ? 1 : -1
      if (left.craftCount !== right.craftCount) return left.craftCount - right.craftCount
      return left.ingredients.length - right.ingredients.length
    })[0]
  }

  function formatIngredientProgress(ingredient) {
    return `${ingredient.label} ${ingredient.available}/${ingredient.required}`
  }

  function formatMissingIngredients(missing) {
    if (!missing.length) return 'none'
    return missing
      .map((ingredient) => `${ingredient.label} ${ingredient.available}/${ingredient.required}`)
      .join(', ')
  }

  function resolveCraftTarget(rawName) {
    if (!mcData) throw new Error('Bot is not ready to craft yet')

    const normalizedName = recipeRegistry.resolveCraftItemName(rawName)
    if (!normalizedName) {
      throw new Error('Usage: Bot.craft <itemId> [count]')
    }

    if (recipeRegistry.BLOCKED_ITEM_IDS.has(normalizedName)) {
      throw new Error(`Crafting for ${normalizedName} is disabled in the local recipe registry`)
    }

    const itemData = mcData.itemsByName[normalizedName]
    if (!itemData) {
      throw new Error(`Unknown item id: ${normalizedName}`)
    }

    return {
      normalizedName,
      itemData,
      label: itemData.displayName || formatItemName(itemData.name)
    }
  }

  function planCraft(itemName, requestedCount) {
    const target = resolveCraftTarget(itemName)
    if (typeof bot.recipesAll !== 'function') {
      throw new Error('This Mineflayer build does not expose recipe lookup')
    }

    const recipes = bot.recipesAll(target.itemData.id, null, true)
    if (!recipes.length) {
      throw new Error(`No crafting recipe found for ${target.normalizedName}`)
    }

    const plans = recipes.map((recipe) => buildRecipePlan({
      recipe,
      itemData: target.itemData,
      requestedCount
    }))

    const selected = chooseRecipePlan(plans)
    if (!selected) {
      throw new Error(`No usable crafting recipe found for ${target.normalizedName}`)
    }

    return {
      ...target,
      ...selected,
      allPlans: plans
    }
  }

  async function moveNearBlock(block, range = 1, timeoutMs = 30000) {
    if (!block?.position) throw new Error('Target block is missing a position')

    bot.pathfinder.setMovements(defaultMove)
    bot.pathfinder.setGoal(new GoalNear(block.position.x, block.position.y, block.position.z, range))

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error(`Timeout reaching ${block.name || 'target block'}`))
      }, timeoutMs)

      const onReached = () => {
        cleanup()
        resolve()
      }

      function cleanup() {
        clearTimeout(timeout)
        bot.removeListener('goal_reached', onReached)
      }

      bot.on('goal_reached', onReached)
    })
  }

  function findNearbyCraftingTable() {
    return bot.findBlock({
      matching: (block) => block && block.name === 'crafting_table',
      maxDistance: getCommandSettings().craftSearchRadius
    })
  }

  async function handleCraftCommand(itemName, requestedCount) {
    if (!bot.player || !bot.entity) {
      throw new Error('Bot must be connected before it can craft')
    }

    const plan = planCraft(itemName, requestedCount)

    if (plan.missing.length) {
      throw new Error(`Missing materials for ${plan.label}: ${formatMissingIngredients(plan.missing)}`)
    }

    let craftingTableBlock = null
    if (plan.requiresTable) {
      craftingTableBlock = findNearbyCraftingTable()
      if (!craftingTableBlock) {
        throw new Error(`No crafting table found within ${getCommandSettings().craftSearchRadius} blocks`)
      }

      await moveNearBlock(craftingTableBlock, 1)
    }

    const beforeCount = countInventoryItem(plan.itemData.id, plan.recipe.result?.metadata == null ? null : plan.recipe.result.metadata)
    await bot.craft(plan.recipe, plan.craftCount, craftingTableBlock)
    const afterCount = countInventoryItem(plan.itemData.id, plan.recipe.result?.metadata == null ? null : plan.recipe.result.metadata)
    const craftedCount = Math.max(plan.producedCount, afterCount - beforeCount)
    const stationLabel = plan.requiresTable ? 'crafting table' : 'inventory crafting'

    say(`SUCCESS: Crafted ${craftedCount} ${plan.label} using ${stationLabel}`)
  }

  async function executeCommand(usernameFromChat, input) {
    const message = normalizeCommand(input)
    const commandSettings = getCommandSettings()

    try {
      switch (true) {
        case message === 'Bot.test':
          say('TEST: success')
          break
        case message === 'Bot.come': {
          const target = bot.players[usernameFromChat]?.entity
          if (!target) {
            say(`ERROR: I cannot see ${usernameFromChat}`)
            break
          }
          bot.pathfinder.setMovements(defaultMove)
          setTrackedGoal(new GoalNear(target.position.x, target.position.y, target.position.z, commandSettings.rangeGoal))
          say(`Coming to ${usernameFromChat}`)
          break
        }
        case message.startsWith('Bot.goto '): {
          const args = message.slice(9).trim().split(' ').filter(Boolean)

          if (args.length === 1) {
            const target = bot.players[args[0]]?.entity
            if (!target) {
              say(`ERROR: I cannot see ${args[0]}`)
              break
            }
            bot.pathfinder.setMovements(defaultMove)
            setTrackedGoal(new GoalFollow(target, commandSettings.rangeGoal), true, {
              type: 'follow',
              entity: target,
              username: args[0],
              range: commandSettings.rangeGoal
            })
            say(`Going to ${args[0]}`)
            break
          }

          if (args.length === 3) {
            const [x, y, z] = args.map(Number)
            if ([x, y, z].some(Number.isNaN)) {
              say('ERROR: usage Bot.goto <player> or Bot.goto <x> <y> <z>')
              break
            }
            bot.pathfinder.setMovements(defaultMove)
            setTrackedGoal(new GoalNear(x, y, z, commandSettings.rangeGoal), false)
            say(`Going to position ${x} ${y} ${z}`)
            break
          }

          say('ERROR: usage Bot.goto <player> or Bot.goto <x> <y> <z>')
          break
        }
        case message === 'Bot.goto.nearest': {
          const nearest = bot.nearestEntity((entity) => {
            if (!entity) return false
            if (entity.type !== 'player') return false
            if (entity.username === bot.username) return false
            return true
          })

          if (!nearest) {
            say('ERROR: No players found')
            break
          }

          bot.pathfinder.setMovements(defaultMove)
          setTrackedGoal(new GoalFollow(nearest, commandSettings.rangeGoal), true, {
            type: 'follow',
            entity: nearest,
            username: nearest.username,
            range: commandSettings.rangeGoal
          })
          say(`Going to nearest player: ${nearest.username}`)
          break
        }
        case message.startsWith('Bot.follow '): {
          const targetName = message.slice(11).trim()
          const target = bot.players[targetName]?.entity
          if (!target) {
            say(`ERROR: I cannot see ${targetName}`)
            break
          }
          bot.pathfinder.setMovements(defaultMove)
          setTrackedGoal(new GoalFollow(target, commandSettings.rangeGoal), true, {
            type: 'follow',
            entity: target,
            username: targetName,
            range: commandSettings.rangeGoal
          })
          say(`Following ${targetName}`)
          break
        }
        case message.startsWith('Bot.attack '): {
          const targetName = message.slice(11).trim()
          const target = bot.players[targetName]?.entity
          if (!target) {
            say(`ERROR: I cannot see ${targetName}`)
            break
          }
          bot.pathfinder.setMovements(defaultMove)
          setTrackedGoal(new GoalFollow(target, commandSettings.rangeGoal), true)
          bot.pvp.attack(target)
          say(`Attacking ${targetName}`)
          break
        }
        case message === 'Bot.guard':
          say('ERROR: usage Bot.guard <x> <y> <z> or Bot.guard.here')
          break
        case message === 'Bot.guard.here':
          handleGuardHere(usernameFromChat)
          break
        case message.startsWith('Bot.guard '): {
          const args = message.slice(10).trim().split(' ').filter(Boolean)
          if (args.length !== 3) {
            say('ERROR: usage Bot.guard <x> <y> <z>')
            break
          }

          const [x, y, z] = args.map(Number)
          if ([x, y, z].some(Number.isNaN)) {
            say('ERROR: coordinates must be numbers')
            break
          }

          handleGuardAtCoordinates(x, y, z)
          break
        }
        case message === 'Bot.guard.stop':
          stopGuard()
          break
        case message === 'Bot.pvp.stop':
          handleStopPvp()
          break
        case message === 'Bot.follow.stop':
          handleStopFollow()
          break
        case message === 'Bot.miner.stop':
          handleStopMiner()
          break
        case message === 'Bot.selfdefense':
          setSelfDefense(!selfDefenseEnabled)
          break
        case message === 'Bot.selfdefense.on':
          setSelfDefense(true)
          break
        case message === 'Bot.selfdefense.off':
          setSelfDefense(false)
          break
        case message === 'Bot.selfdefense.status':
          say(`Self defense is currently ${selfDefenseEnabled ? 'enabled' : 'disabled'}`)
          break
        case message === 'Bot.silent':
          setSilent(!silentModeRef.value)
          break
        case message === 'Bot.silent.on':
          setSilent(true)
          break
        case message === 'Bot.silent.off':
          setSilent(false)
          break
        case message === 'Bot.silent.status':
          say(`Silent mode is currently ${silentModeRef.value ? 'enabled' : 'disabled'}`)
          break
        case message.startsWith('Bot.collect '): {
          const args = message.slice(12).trim().split(' ').filter(Boolean)
          if (args.length !== 2) {
            say('ERROR: usage Bot.collect <blockType> <count>')
            break
          }

          const blockType = args[0]
          const count = Number(args[1])

          if (!Number.isInteger(count) || count <= 0) {
            say('ERROR: count must be a positive integer')
            break
          }

          await handleBlockCollection(blockType, count)
          break
        }
        case message === 'Bot.craft':
          throw new Error('Usage: Bot.craft <itemId> [count]')
        case message.startsWith('Bot.craft '): {
          const args = message.slice(10).trim().split(' ').filter(Boolean)
          if (args.length < 1 || args.length > 2) {
            throw new Error('Usage: Bot.craft <itemId> [count]')
          }

          const itemName = args[0]
          const count = args.length === 2 ? Number(args[1]) : 1
          if (!Number.isInteger(count) || count <= 0) {
            throw new Error('Craft count must be a positive integer')
          }

          await handleCraftCommand(itemName, count)
          break
        }
        case message === 'Bot.autoEat':
          setAutoEat(true)
          break
        case message === 'Bot.autoEat.stop':
          setAutoEat(false)
          break
        case message === 'Bot.eat':
          await bot.autoEat.eat()
          say('Ate food successfully')
          break
        case message === 'Bot.empty':
          await handleEmptyInventory()
          break
        case message.startsWith('Bot.mine '): {
          const blockType = message.slice(9).trim()
          handleMine(blockType).catch((error) => say(`ERROR: ${error.message}`))
          break
        }
        default:
          say('ERROR: unknown command')
          break
      }
    } finally {
      broadcastState(true)
    }
  }

  async function waitForQueueAsyncCompletion(command, timeoutMs = 60000, shouldStop = () => false) {
    const started = Date.now()

    while (Date.now() - started < timeoutMs) {
      if (shouldStop()) throw new Error('Queue stopped')
      await waitMs(150)
    }

    throw new Error(`Timed out waiting for completion of ${normalizeCommand(command)}`)
  }

  async function waitForQueueGotoCompletion(command, timeoutMs = 60000, shouldStop = () => false) {
    const normalized = normalizeCommand(command)
    const commandSettings = getCommandSettings()
    const started = Date.now()

    const parseCoordinateGoal = () => {
      if (!normalized.startsWith('Bot.goto ')) return null
      const args = normalized.slice(9).trim().split(' ').filter(Boolean)
      if (args.length !== 3) return null
      const xyz = args.map(Number)
      if (xyz.some((value) => Number.isNaN(value))) return null
      return { x: xyz[0], y: xyz[1], z: xyz[2], range: commandSettings.rangeGoal }
    }

    const coordinateGoal = parseCoordinateGoal()

    while (Date.now() - started < timeoutMs) {
      if (shouldStop()) {
        throw new Error('Queue stopped')
      }

      if (!bot.entity?.position) {
        await waitMs(150)
        continue
      }

      if (coordinateGoal) {
        const distance = bot.entity.position.distanceTo(coordinateGoal)
        if (distance <= coordinateGoal.range + 0.2) return
      } else {
        const followMeta = trackedGoalState.meta?.type === 'follow' ? trackedGoalState.meta : null
        const targetFromName = followMeta?.username ? bot.players[followMeta.username]?.entity : null
        const targetEntity = targetFromName || followMeta?.entity || null
        if (targetEntity?.position) {
          const range = typeof followMeta?.range === 'number' ? followMeta.range : commandSettings.rangeGoal
          if (bot.entity.position.distanceTo(targetEntity.position) <= range + 0.4) return
        }
      }

      await waitMs(150)
    }

    throw new Error(`Timed out waiting for completion of ${normalized}`)
  }

  async function runQueueCommand({ username = 'WebUI', command, waitForCompletion = false, timeoutMs = 60000, shouldStop = () => false }) {
    const normalized = normalizeCommand(command)
    if (!normalized) throw new Error('Missing command')

    if (waitForCompletion && !isWaitableQueueCommand(normalized)) {
      throw new Error('This command cannot wait for completion')
    }

    if (waitForCompletion && normalized.startsWith('Bot.craft')) {
      await Promise.race([
        executeCommand(username, normalized),
        waitForQueueAsyncCompletion(normalized, timeoutMs, shouldStop)
      ])
      return
    }

    if (waitForCompletion) {
      await executeCommand(username, normalized)
    } else {
      processCommand(username, normalized)
    }

    if (waitForCompletion && (normalized.startsWith('Bot.goto ') || normalized === 'Bot.goto.nearest')) {
      await waitForQueueGotoCompletion(normalized, timeoutMs, shouldStop)
    }
  }

  async function equipBestSword(options = {}) {
    const { silent = false } = options
    if (!mcData) return

    const swords = bot.inventory.items().filter((item) => {
      const itemName = item.name || (mcData.items[item.type] && mcData.items[item.type].name)
      return itemName && itemName.endsWith('_sword')
    })

    if (!swords.length) {
      if (!silent) say('No swords found in inventory')
      return
    }

    const swordPriority = {
      netherite_sword: 1,
      diamond_sword: 2,
      iron_sword: 3,
      stone_sword: 4,
      wooden_sword: 5,
      golden_sword: 6
    }

    let bestSword = null
    let bestScore = -Infinity
    for (const sword of swords) {
      const itemName = sword.name || (mcData.items[sword.type] && mcData.items[sword.type].name)
      const itemData = itemName ? mcData.itemsByName[itemName] || mcData.items[sword.type] : null
      const damage = itemData ? (itemData.attackDamage || 0) : 0
      const priority = itemName && swordPriority[itemName] ? swordPriority[itemName] : 999
      const score = damage * 100 - priority
      if (score > bestScore) {
        bestScore = score
        bestSword = sword
      }
    }

    if (!bestSword) return
    await bot.equip(bestSword, 'hand')
    if (!silent) {
      say(`Equipped ${bestSword.name || mcData.items[bestSword.type]?.name}`)
    }
  }

  function isValidSelfDefenseTarget(entity) {
    if (!entity) return false
    if (!bot.entity) return false
    if (entity.isValid === false) return false
    if (entity.type === 'player') return false
    if (!entity.position || typeof entity.position.distanceTo !== 'function') return false
    const commandSettings = getCommandSettings()
    if (entity.position.distanceTo(bot.entity.position) > commandSettings.selfDefenseTargetDistance) return false

    const entityName = (entity.name || '').toLowerCase()
    const displayName = (entity.displayName || '').toLowerCase().replace(/\s+/g, '_')
    const kind = (entity.type || '').toLowerCase()
    if (HOSTILE_ENTITY_NAMES.has(entityName)) return true
    if (HOSTILE_ENTITY_NAMES.has(displayName)) return true
    return kind === 'hostile'
  }

  function trackRecentDamager(packet) {
    if (!packet || !bot.entity) return
    const victimId = packet.entityId ?? packet.victimId ?? packet.targetId
    if (victimId !== bot.entity.id) return

    const attackerId = packet.sourceCauseId ?? packet.sourceDirectId ?? packet.attackerId ?? packet.sourceEntityId
    if (typeof attackerId !== 'number' || attackerId < 0) return
    recentDamagerEntityId = attackerId
    recentDamagerAt = Date.now()
  }

  function getDamagerEntity() {
    const now = Date.now()
    if (recentDamagerEntityId !== null && now - recentDamagerAt <= 2500) {
      const entity = bot.entities[recentDamagerEntityId]
      if (isValidSelfDefenseTarget(entity)) return entity
    }

    return bot.nearestEntity((entity) => {
      if (!isValidSelfDefenseTarget(entity)) return false
      return entity.position.distanceTo(bot.entity.position) <= 6
    })
  }

  function waitForEntityToBeDead(entity, options = {}) {
    const timeoutMs = options.timeoutMs ?? 20000
    const maxDistance = options.maxDistance ?? null

    return new Promise((resolve) => {
      if (!entity || entity.isValid === false) {
        resolve()
        return
      }

      const done = () => {
        cleanup()
        resolve()
      }

      const onEntityDead = (deadEntity) => {
        if (deadEntity?.id === entity.id) done()
      }

      const onEntityGone = (goneEntity) => {
        if (goneEntity?.id === entity.id) done()
      }

      const interval = setInterval(() => {
        const current = bot.entities[entity.id]
        if (!current || current.isValid === false || current.health <= 0) {
          done()
          return
        }

        if (typeof maxDistance === 'number' && current.position && bot.entity?.position) {
          if (current.position.distanceTo(bot.entity.position) > maxDistance) {
            done()
          }
        }
      }, 200)

      const timeout = setTimeout(done, timeoutMs)

      function cleanup() {
        clearInterval(interval)
        clearTimeout(timeout)
        bot.removeListener('entityDead', onEntityDead)
        bot.removeListener('entityGone', onEntityGone)
      }

      bot.on('entityDead', onEntityDead)
      bot.on('entityGone', onEntityGone)
    })
  }

  function waitForStoppedAttacking(timeoutMs = 1500) {
    return new Promise((resolve) => {
      let finished = false

      const done = () => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        bot.removeListener('stoppedAttacking', onStoppedAttacking)
        resolve()
      }

      const onStoppedAttacking = () => done()
      const timeout = setTimeout(done, timeoutMs)
      bot.on('stoppedAttacking', onStoppedAttacking)

      setImmediate(() => {
        if (!bot.pvp.target) done()
      })
    })
  }

  async function retaliateAgainstAttacker() {
    if (!selfDefenseEnabled || selfDefenseInProgress) return

    const attacker = getDamagerEntity()
    if (!attacker) return
    if (attacker.type === 'player') return

    const originalIntent = captureCurrentIntent()
    selfDefenseInProgress = true

    try {
      await equipBestSword({ silent: true })
      bot.pathfinder.setMovements(defaultMove)
      const commandSettings = getCommandSettings()
      setTrackedGoal(new GoalFollow(attacker, commandSettings.rangeGoal), true)
      bot.pvp.attack(attacker)
      await waitForEntityToBeDead(attacker, { maxDistance: commandSettings.selfDefenseChaseDistance })
    } catch (error) {
      say(`ERROR: Self defense failed: ${error.message}`)
    } finally {
      bot.pvp.stop()
      await waitForStoppedAttacking()
      await waitMs(1000)
      selfDefenseInProgress = false
      restoreIntent(originalIntent)

      setTimeout(() => {
        if (selfDefenseInProgress) return
        if (bot.pvp.target) return
        restoreIntent(originalIntent)
      }, 1000)
    }
  }

  function setAutoEat(enabled) {
    if (!bot.autoEat) throw new Error('Auto-eat plugin not loaded')

    autoEatEnabled = Boolean(enabled)
    if (autoEatEnabled) {
      bot.autoEat.enableAuto()
      say('Auto eat enabled')
    } else {
      bot.autoEat.disableAuto()
      say('Auto eat disabled')
    }

    broadcastState(true)
    return autoEatEnabled
  }

  function setSilent(enabled) {
    silentModeRef.value = Boolean(enabled)
    pushWebLog('system', `Silent mode ${silentModeRef.value ? 'enabled' : 'disabled'}`, id)
    broadcastState(true)
    return silentModeRef.value
  }

  function toggleByName(name) {
    if (name === 'selfDefense') return { selfDefenseEnabled: setSelfDefense(!selfDefenseEnabled) }
    if (name === 'autoEat') return { autoEatEnabled: setAutoEat(!autoEatEnabled) }
    if (name === 'silent') return { silentModeEnabled: setSilent(!silentModeRef.value) }
    throw new Error(`Unknown toggle ${name}`)
  }

  async function handleEmptyInventory() {
    const commandSettings = getCommandSettings()
    const chestBlock = bot.findBlock({
      matching: (block) => block && block.name === 'chest',
      maxDistance: commandSettings.emptyInventoryRadius
    })

    if (!chestBlock) {
      say('ERROR: No chest found nearby')
      return
    }

    bot.pathfinder.setMovements(defaultMove)
    bot.pathfinder.setGoal(new GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 1))

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout reaching chest')), 30000)
      bot.once('goal_reached', () => {
        clearTimeout(timeout)
        resolve()
      })
    })

    const chest = await bot.openChest(chestBlock)
    const items = bot.inventory.items()

    if (!items.length) {
      say('INFO: Inventory is already empty')
      chest.close()
      return
    }

    for (const item of items) {
      await chest.deposit(item.type, item.metadata || null, item.count)
    }

    chest.close()
    say(`SUCCESS: Emptied ${items.length} item types into chest`)
  }

  function pickCorrectTool(block) {
    const bestTool = bot.pathfinder.bestHarvestTool(block)
    if (!bestTool) return
    bot.equip(bestTool, 'hand').catch(() => {})
  }

  async function collectBlockType(blockType, options = {}) {
    const commandSettings = getCommandSettings()
    const radius = options.radius || commandSettings.collectRadius

    const block = bot.findBlock({
      matching: (candidate) => candidate && candidate.name === blockType,
      maxDistance: radius
    })

    if (!block) {
      say(`ERROR: Could not find block type ${blockType}`)
      return
    }

    pickCorrectTool(block)
    await bot.collectBlock.collect(block)
    say(`SUCCESS: Collected ${blockType}`)
  }

  async function handleBlockCollection(blockType, repeats) {
    for (let i = 0; i < repeats; i += 1) {
      await collectBlockType(blockType)
    }
  }

  async function handleMine(blockType) {
    miningEnabled = true
    broadcastState(true)

    const originalPos = bot.entity?.position?.clone ? bot.entity.position.clone() : null
    say(`Starting miner, searching for ${blockType}`)

    try {
      while (miningEnabled) {
        if (selfDefenseInProgress) {
          await waitMs(200)
          continue
        }

        const block = bot.findBlock({
          matching: (candidate) => candidate && candidate.name === blockType,
          maxDistance: getCommandSettings().mineSearchRadius
        })

        if (block) {
          if (selfDefenseInProgress) continue
          say(`Found ${blockType} at ${block.position}`)
          pickCorrectTool(block)
          try {
            await bot.collectBlock.collect(block)
            say(`Mined ${blockType}`)
            await waitMs(50)
          } catch (error) {
            if (selfDefenseInProgress) continue
            say(`Failed to mine ${blockType}: ${error.message}`)
          }
          continue
        }

        if (!originalPos) {
          await waitMs(300)
          continue
        }

        const angle = Math.random() * 2 * Math.PI
        const commandSettings = getCommandSettings()
        const distanceWindow = Math.max(0, commandSettings.mineRoamMaxDistance - commandSettings.mineRoamMinDistance)
        const distance = commandSettings.mineRoamMinDistance + Math.random() * distanceWindow
        const newX = originalPos.x + distance * Math.cos(angle)
        const newZ = originalPos.z + distance * Math.sin(angle)
        const newY = originalPos.y
        bot.pathfinder.setMovements(defaultMove)
        setTrackedGoal(new GoalNear(newX, newY, newZ, 1))

        const movementResult = await new Promise((resolve) => {
          const onReached = () => {
            cleanup()
            resolve('reached')
          }

          const onInterruptedTick = setInterval(() => {
            if (!miningEnabled || selfDefenseInProgress) {
              cleanup()
              resolve('interrupted')
            }
          }, 150)

          const timeout = setTimeout(() => {
            cleanup()
            resolve('timeout')
          }, 30000)

          function cleanup() {
            clearInterval(onInterruptedTick)
            clearTimeout(timeout)
            bot.removeListener('goal_reached', onReached)
          }

          bot.on('goal_reached', onReached)
        })

        if (movementResult !== 'reached') {
          continue
        }
      }
    } finally {
      miningEnabled = false
      broadcastState(true)
    }
  }

  function handleGuardAtCoordinates(x, y, z) {
    guardPos = bot.entity?.position.clone() || null
    if (!guardPos) return

    guardPos.x = x
    guardPos.y = y
    guardPos.z = z

    bot.pathfinder.setMovements(defaultMove)
    setTrackedGoal(new GoalBlock(Math.floor(x), Math.floor(y), Math.floor(z)))
    say(`Guarding position ${x} ${y} ${z}`)
  }

  function handleGuardHere(usernameFromChat) {
    const player = bot.players[usernameFromChat]?.entity
    if (!player) {
      say('ERROR: I cannot see you')
      return
    }

    handleGuardAtCoordinates(player.position.x, player.position.y, player.position.z)
  }

  function stopGuard() {
    guardPos = null
    bot.pvp.stop()
    setTrackedGoal(null)
    say('Guard stopped')
    broadcastState(true)
  }

  function handleStopPvp() {
    bot.pvp.stop()
    say('Stopped PvP actions')
  }

  function handleStopFollow() {
    setTrackedGoal(null)
    say('Stopped following target')
  }

  function handleStopMiner() {
    miningEnabled = false
    setTrackedGoal(null)
    say('Stopped miner')
    broadcastState(true)
  }

  function processCommand(usernameFromChat, input) {
    executeCommand(usernameFromChat, input).catch((error) => {
      say(`ERROR: ${error.message}`)
      broadcastState(true)
    })
  }

  bot.on('spawn', () => {
    mcData = require('minecraft-data')(bot.version)
    defaultMove = new Movements(bot)
    for (const name of ['seagrass', 'tall_seagrass']) {
      const block = mcData.blocksByName[name]
      if (block) defaultMove.blocksToAvoid.add(block.id)
    }

    bot.pathfinder.setMovements(defaultMove)

    // Smooth multi-bot movement by reducing per-bot pathfinder tick workload.
    // This keeps each bot from using too much time in a single main loop pass.
    bot.pathfinder.tickTimeout = 10
    bot.pathfinder.enablePathShortcut = true

    pushWebLog('system', `Spawned as ${username} on ${botSettings.host}:${botSettings.port}`, id)
    io?.emit('auth_done', { botId: id })

    if (viewerEnabled && botSettings.viewerTargetBotId === id) {
      startViewerFor(id)
    }

    broadcastState(true)
  })

  bot.on('chat', (usernameFromChat, message) => {
    pushWebLog('chat', `${usernameFromChat}: ${message}`, id)
    if (usernameFromChat === bot.username) return
    if (!String(message).startsWith('Bot.')) return
    processCommand(usernameFromChat, message)
  })

  bot.on('physicsTick', () => {
    if (!guardPos) return
    if (selfDefenseInProgress) return

    const currentTarget = bot.pvp.target
    if (currentTarget) {
      const commandSettings = getCommandSettings()
      const hasPos = currentTarget.position && typeof currentTarget.position.distanceTo === 'function'
      const stillValid = currentTarget.isValid !== false
      const stillNearGuard = hasPos && currentTarget.position.distanceTo(guardPos) < commandSettings.guardContinuePursuitRadius
      if (stillValid && stillNearGuard) return
      bot.pvp.stop()
    }

    const entity = bot.nearestEntity((candidate) => {
      const commandSettings = getCommandSettings()
      if (!candidate) return false
      if (candidate.type === 'player') return false
      if (candidate.isValid === false) return false
      if (!candidate.position || typeof candidate.position.distanceTo !== 'function') return false
      if (candidate.position.distanceTo(guardPos) >= commandSettings.guardProtectRadius) return false
      if (candidate.displayName === 'Armor Stand') return false
      if (candidate.name === 'item' || candidate.name === 'experience_orb') return false
      return true
    })

    if (!entity || guardAttackInProgress) return

    guardAttackInProgress = true
    ;(async () => {
      try {
        await equipBestSword({ silent: true })
        bot.pvp.attack(entity)
      } catch (error) {
        say(`ERROR: Failed to attack guard target: ${error.message}`)
      } finally {
        guardAttackInProgress = false
      }
    })()
  })

  bot.on('stoppedAttacking', () => {
    if (selfDefenseInProgress) return
    if (guardPos) {
      bot.pathfinder.setMovements(defaultMove)
      setTrackedGoal(new GoalBlock(
        Math.floor(guardPos.x),
        Math.floor(guardPos.y),
        Math.floor(guardPos.z)
      ))
    }
  })

  bot._client.on('damage_event', (packet) => {
    trackRecentDamager(packet)
  })

  bot.on('entityHurt', (entity) => {
    if (entity?.id !== bot.entity?.id) return
    retaliateAgainstAttacker()
  })

  bot.on('kicked', (reason, loggedIn) => {
    let readableReason = reason
    try {
      if (reason && typeof reason === 'object') {
        readableReason = JSON.stringify(nbt.simplify(reason))
      }
    } catch {
      readableReason = String(reason)
    }

    pushWebLog('error', `KICKED: ${readableReason} | loggedIn=${loggedIn}`, id)
    broadcastState(true)
  })

  bot.on('error', (err) => {
    const code = err && err.code ? ` code=${err.code}` : ''
    const syscall = err && err.syscall ? ` syscall=${err.syscall}` : ''
    pushWebLog('error', `BOT ERROR:${code}${syscall} message=${err?.message || String(err)}`, id)
    broadcastState(true)
  })

  bot.on('end', () => {
    pushWebLog('system', 'Bot disconnected', id)
    if (viewerAttachedBotId === id) {
      viewerAttachedBotId = null
      if (viewerEnabled) {
        startViewerFor(botSettings.viewerTargetBotId)
      }
    }
    broadcastState(true)
  })

  return runtime
}

function addRuntime(runtime) {
  runtimes.set(runtime.id, runtime)
  for (const queue of queueByTarget.values()) {
    emitQueueState(queue.target)
  }
  broadcastState(true)
}

async function removeRuntime(botId) {
  const runtime = runtimes.get(botId)
  if (!runtime) return

  await runtime.shutdown()
  runtimes.delete(botId)

  botSettings.groups = botSettings.groups.map((group) => ({
    ...group,
    botIds: group.botIds.filter((id) => id !== botId)
  }))

  if (botSettings.viewerTargetBotId === botId) {
    botSettings.viewerTargetBotId = STARTER_BOT_ID
    if (viewerEnabled) {
      startViewerFor(STARTER_BOT_ID)
    }
  }

  saveBotSettings(botSettings)
  for (const queue of queueByTarget.values()) {
    emitQueueState(queue.target)
  }
  broadcastState(true)
}

function ensureGroupIdsExist() {
  const validIds = new Set([STARTER_BOT_ID, ...botSettings.bots.map((bot) => bot.id)])
  botSettings.groups = botSettings.groups.map((group) => ({
    ...group,
    botIds: group.botIds.filter((id) => validIds.has(id))
  }))
}

function resolveTargetBotIds(target) {
  const allIds = Array.from(runtimes.keys())
  if (!target || target === STARTER_BOT_ID) return [STARTER_BOT_ID]
  if (target === 'all') return allIds

  if (target.startsWith('group:')) {
    const groupId = target.slice(6)
    const group = botSettings.groups.find((candidate) => candidate.id === groupId)
    if (!group) return []
    return group.botIds.filter((id) => runtimes.has(id))
  }

  return runtimes.has(target) ? [target] : []
}

function runCommandOnTargets({ target, command, username = 'WebUI' }) {
  const targetIds = resolveTargetBotIds(target)
  if (!targetIds.length) throw new Error('No bots resolved for target')

  const normalizedCommand = normalizeCommand(command)
  if (!normalizedCommand) throw new Error('Missing command')

  for (const botId of targetIds) {
    const runtime = runtimes.get(botId)
    runtime.processCommand(username, normalizedCommand)
  }

  pushWebLog('command', `${username} -> ${normalizedCommand} [target=${target}]`)
  return { targetIds, normalizedCommand }
}

function toggleTargets({ target, toggleName }) {
  const targetIds = resolveTargetBotIds(target)
  if (!targetIds.length) throw new Error('No bots resolved for target')

  const results = {}
  for (const botId of targetIds) {
    const runtime = runtimes.get(botId)
    results[botId] = runtime.toggleByName(toggleName)
  }

  return { targetIds, results }
}

async function restartAllBots() {
  pushWebLog('system', 'Restarting bots...')

  for (const runtime of Array.from(runtimes.values())) {
    await runtime.shutdown()
  }

  runtimes.clear()
  stopViewer()
  await bootstrapBots()
  startViewerFor(botSettings.viewerTargetBotId)
  pushWebLog('system', 'Bots restarted successfully')
  broadcastState(true)
}

function startWebServer() {
  const app = express()
  const server = http.createServer(app)

  io = new Server(server, {
    cors: { origin: '*' }
  })

  app.use(express.json({ limit: '1mb' }))
  app.use(express.static(path.join(__dirname, 'public')))

  app.get('/api/status', (req, res) => {
    res.json(getDashboardState())
  })

  app.get('/api/settings', (req, res) => {
    res.json({ ...botSettings, viewerEnabled, tpsDashboardEnabled })
  })

  app.post('/api/settings', (req, res) => {
    const nextCommandSettings = normalizeCommandSettings(req.body?.commandSettings ?? botSettings.commandSettings)
    const nextSettings = {
      ...botSettings,
      ...req.body,
      host: String(req.body?.host ?? botSettings.host),
      port: Number(req.body?.port ?? botSettings.port) || botSettings.port,
      version: String(req.body?.version ?? botSettings.version),
      viewerPort: Number(req.body?.viewerPort ?? botSettings.viewerPort) || botSettings.viewerPort,
      webPort: Number(req.body?.webPort ?? botSettings.webPort) || botSettings.webPort,
      starterUsername: String(req.body?.starterUsername ?? botSettings.starterUsername),
      starterAuth: normalizeAuth(req.body?.starterAuth ?? botSettings.starterAuth),
      starterToken: String(req.body?.starterToken ?? botSettings.starterToken),
      tpsDashboardEnabled: typeof req.body?.tpsDashboardEnabled === 'boolean'
        ? req.body.tpsDashboardEnabled
        : tpsDashboardEnabled,
      viewerTargetBotId: String(req.body?.viewerTargetBotId || botSettings.viewerTargetBotId),
      commandSettings: nextCommandSettings,
      queueSettings: normalizeQueueSettings(req.body?.queueSettings ?? botSettings.queueSettings)
    }

    if (!runtimes.has(nextSettings.viewerTargetBotId)) {
      return res.status(400).json({ ok: false, error: 'Viewer target bot does not exist' })
    }

    Object.assign(botSettings, nextSettings)
    tpsDashboardEnabled = Boolean(nextSettings.tpsDashboardEnabled)
    saveBotSettings(botSettings)

    pushWebLog('system', 'Saved settings. Restart bots to apply connection/auth changes.')
    broadcastState(true)

    return res.json({
      ok: true,
      settings: botSettings,
      note: 'Saved. Use Restart Bot Only to apply connection/auth updates.'
    })
  })

  app.get('/api/bots', (req, res) => {
    res.json({ ok: true, bots: getBotsState(), persistedBots: botSettings.bots })
  })

  app.post('/api/bots', (req, res) => {
    const username = String(req.body?.username || '').trim()
    const auth = normalizeAuth(req.body?.auth)
    const token = String(req.body?.token || '')

    if (!username) {
      return res.status(400).json({ ok: false, error: 'Missing username' })
    }

    const id = makeUniqueBotId(username)
    const config = { id, username, auth, token }

    try {
      const runtime = createBotRuntime(config)
      addRuntime(runtime)
      botSettings.bots.push(config)
      saveBotSettings(botSettings)
      pushWebLog('system', `Added bot ${username} (${id})`, id)
      return res.json({ ok: true, bot: runtime.getState() })
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message })
    }
  })

  app.post('/api/bots/batch', (req, res) => {
    const prefix = String(req.body?.prefix || 'Bot').trim() || 'Bot'
    const start = Number(req.body?.start ?? 1)
    const count = Number(req.body?.count ?? 1)
    const auth = normalizeAuth(req.body?.auth)
    const token = String(req.body?.token || '')

    if (!Number.isInteger(start) || start < 0) {
      return res.status(400).json({ ok: false, error: 'start must be a non-negative integer' })
    }

    if (!Number.isInteger(count) || count <= 0 || count > 50) {
      return res.status(400).json({ ok: false, error: 'count must be an integer between 1 and 50' })
    }

    const created = []
    const failed = []

    for (let i = 0; i < count; i += 1) {
      const username = `${prefix}${start + i}`
      const id = makeUniqueBotId(username)
      const config = { id, username, auth, token }

      try {
        const runtime = createBotRuntime(config)
        addRuntime(runtime)
        botSettings.bots.push(config)
        created.push(id)
      } catch (error) {
        failed.push({ username, error: error.message })
      }
    }

    saveBotSettings(botSettings)
    broadcastState(true)

    return res.json({ ok: true, created, failed })
  })

  app.delete('/api/bots/:botId', async (req, res) => {
    const botId = String(req.params.botId)

    if (botId === STARTER_BOT_ID) {
      return res.status(400).json({ ok: false, error: 'Starter bot cannot be deleted' })
    }

    const exists = botSettings.bots.some((bot) => bot.id === botId)
    if (!exists) {
      return res.status(404).json({ ok: false, error: 'Bot not found' })
    }

    botSettings.bots = botSettings.bots.filter((bot) => bot.id !== botId)
    await removeRuntime(botId)
    saveBotSettings(botSettings)

    return res.json({ ok: true })
  })

  app.get('/api/groups', (req, res) => {
    res.json({ ok: true, groups: botSettings.groups })
  })

  app.post('/api/groups', (req, res) => {
    const name = String(req.body?.name || '').trim()
    const botIds = safeArray(req.body?.botIds).map((id) => String(id))

    if (!name) {
      return res.status(400).json({ ok: false, error: 'Missing group name' })
    }

    const id = `group-${slugify(name)}-${Date.now().toString(36)}`
    const uniqueBotIds = Array.from(new Set(botIds)).filter((botId) => runtimes.has(botId))
    const group = { id, name, botIds: uniqueBotIds }

    botSettings.groups.push(group)
    saveBotSettings(botSettings)
    broadcastState(true)

    return res.json({ ok: true, group })
  })

  app.put('/api/groups/:groupId', (req, res) => {
    const groupId = String(req.params.groupId)
    const index = botSettings.groups.findIndex((group) => group.id === groupId)
    if (index === -1) {
      return res.status(404).json({ ok: false, error: 'Group not found' })
    }

    const name = String(req.body?.name || '').trim() || botSettings.groups[index].name
    const botIds = Array.from(new Set(safeArray(req.body?.botIds).map((id) => String(id))))
      .filter((botId) => runtimes.has(botId))

    botSettings.groups[index] = {
      ...botSettings.groups[index],
      name,
      botIds
    }

    saveBotSettings(botSettings)
    broadcastState(true)

    return res.json({ ok: true, group: botSettings.groups[index] })
  })

  app.delete('/api/groups/:groupId', (req, res) => {
    const groupId = String(req.params.groupId)
    const before = botSettings.groups.length
    botSettings.groups = botSettings.groups.filter((group) => group.id !== groupId)

    if (before === botSettings.groups.length) {
      return res.status(404).json({ ok: false, error: 'Group not found' })
    }

    saveBotSettings(botSettings)
    broadcastState(true)
    return res.json({ ok: true })
  })

  app.post('/api/command', (req, res) => {
    try {
      const target = String(req.body?.target || STARTER_BOT_ID)
      const command = String(req.body?.command || '')
      const username = String(req.body?.username || 'WebUI')
      const result = runCommandOnTargets({ target, command, username })
      return res.json({ ok: true, ...result })
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message })
    }
  })

  app.post('/api/bots/:botId/command', (req, res) => {
    try {
      const botId = String(req.params.botId)
      const command = String(req.body?.command || '')
      const username = String(req.body?.username || 'WebUI')
      const result = runCommandOnTargets({ target: botId, command, username })
      return res.json({ ok: true, ...result })
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message })
    }
  })

  app.get('/api/queue', (req, res) => {
    try {
      const target = String(req.query?.target || STARTER_BOT_ID)
      const queue = ensureTargetQueue(target)
      return res.json({ ok: true, queue: serializeTargetQueue(queue) })
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message })
    }
  })

  app.post('/api/queue/step', (req, res) => {
    try {
      const target = String(req.body?.target || STARTER_BOT_ID)
      const queue = ensureTargetQueue(target)
      if (queue.running) throw new Error('Cannot edit queue while running')

      const step = normalizeQueueStep(req.body?.step)
      queue.steps.push(step)
      emitQueueState(target)
      return res.json({ ok: true, queue: serializeTargetQueue(queue) })
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message })
    }
  })

  app.put('/api/queue/steps', (req, res) => {
    try {
      const target = String(req.body?.target || STARTER_BOT_ID)
      const queue = ensureTargetQueue(target)
      if (queue.running) throw new Error('Cannot reorder queue while running')

      const orderedIds = safeArray(req.body?.stepIds).map((id) => String(id))
      const known = new Map(queue.steps.map((step) => [step.id, step]))
      if (orderedIds.length !== queue.steps.length) {
        throw new Error('Invalid step order payload')
      }

      const reordered = []
      for (const stepId of orderedIds) {
        const step = known.get(stepId)
        if (!step) throw new Error('Step order includes unknown id')
        reordered.push(step)
      }

      queue.steps = reordered
      emitQueueState(target)
      return res.json({ ok: true, queue: serializeTargetQueue(queue) })
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message })
    }
  })

  app.delete('/api/queue/steps/:stepId', (req, res) => {
    try {
      const target = String(req.query?.target || STARTER_BOT_ID)
      const stepId = String(req.params.stepId)
      const queue = ensureTargetQueue(target)
      if (queue.running) throw new Error('Cannot edit queue while running')

      const before = queue.steps.length
      queue.steps = queue.steps.filter((step) => step.id !== stepId)
      if (before === queue.steps.length) {
        return res.status(404).json({ ok: false, error: 'Step not found' })
      }

      emitQueueState(target)
      return res.json({ ok: true, queue: serializeTargetQueue(queue) })
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message })
    }
  })

  app.post('/api/queue/clear', (req, res) => {
    try {
      const target = String(req.body?.target || STARTER_BOT_ID)
      const queue = ensureTargetQueue(target)
      if (queue.running) throw new Error('Cannot clear queue while running')
      queue.steps = []
      queue.lastError = null
      queue.currentStepIndex = -1
      queue.perBot = {}
      emitQueueState(target)
      return res.json({ ok: true, queue: serializeTargetQueue(queue) })
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message })
    }
  })

  app.post('/api/queue/settings', (req, res) => {
    try {
      const target = String(req.body?.target || STARTER_BOT_ID)
      const queue = ensureTargetQueue(target)
      if (queue.running) throw new Error('Cannot update queue settings while running')

      queue.settings = normalizeQueueSettings(req.body?.settings)
      emitQueueState(target)
      return res.json({ ok: true, queue: serializeTargetQueue(queue) })
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message })
    }
  })

  app.post('/api/queue/start', async (req, res) => {
    try {
      const target = String(req.body?.target || STARTER_BOT_ID)
      const username = String(req.body?.username || 'WebUI')
      const result = await startTargetQueue({ target, username })
      return res.json({ ok: true, ...result })
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message })
    }
  })

  app.post('/api/queue/stop', (req, res) => {
    try {
      const target = String(req.body?.target || STARTER_BOT_ID)
      stopTargetQueue(target)
      return res.json({ ok: true })
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message })
    }
  })

  app.post('/api/toggle/:name', (req, res) => {
    const toggleName = String(req.params.name)

    if (toggleName === 'viewer') {
      setViewerEnabled(!viewerEnabled)
      return res.json({ ok: true, viewerEnabled })
    }

    if (toggleName === 'tpsDashboard') {
      setTpsDashboardEnabled(!tpsDashboardEnabled)
      return res.json({ ok: true, tpsDashboardEnabled })
    }

    try {
      const target = String(req.body?.target || STARTER_BOT_ID)
      const result = toggleTargets({ target, toggleName })
      return res.json({ ok: true, ...result })
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message })
    }
  })

  app.post('/api/bots/:botId/toggle/:name', (req, res) => {
    try {
      const botId = String(req.params.botId)
      const toggleName = String(req.params.name)
      const runtime = runtimes.get(botId)
      if (!runtime) {
        return res.status(404).json({ ok: false, error: 'Bot not found' })
      }
      const result = runtime.toggleByName(toggleName)
      return res.json({ ok: true, botId, result })
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message })
    }
  })

  app.post('/api/viewer/target', (req, res) => {
    const botId = String(req.body?.botId || '').trim()
    if (!botId) {
      return res.status(400).json({ ok: false, error: 'Missing botId' })
    }

    try {
      setViewerTarget(botId)
      return res.json({ ok: true, viewerTargetBotId: botId, viewerUrl: getViewerUrl() })
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message })
    }
  })

  app.post('/api/restart-bot', async (req, res) => {
    try {
      await restartAllBots()
      return res.json({ ok: true, message: 'Bots restarted successfully' })
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message })
    }
  })

  app.post('/api/shutdown', async (req, res) => {
    res.json({ ok: true, message: 'Shutting down...' })

    for (const runtime of Array.from(runtimes.values())) {
      await runtime.shutdown()
    }

    setTimeout(() => process.exit(0), 500)
  })

  io.on('connection', (socket) => {
    socket.emit('bootstrap', {
      state: getDashboardState(),
      settings: { ...botSettings, viewerEnabled },
      logs: webLogs
    })

    for (const queue of queueByTarget.values()) {
      socket.emit('queue_state', { target: queue.target, queue: serializeTargetQueue(queue) })
    }
  })

  server.listen(botSettings.webPort, () => {
    const message = `Web dashboard running at http://localhost:${botSettings.webPort}`
    console.log(message)
    pushWebLog('system', message)
  })
}

async function bootstrapBots() {
  const starterRuntime = createBotRuntime({
    id: STARTER_BOT_ID,
    username: botSettings.starterUsername,
    auth: botSettings.starterAuth,
    token: botSettings.starterToken,
    isStarter: true
  })
  addRuntime(starterRuntime)

  for (const config of botSettings.bots) {
    try {
      const runtime = createBotRuntime(config)
      addRuntime(runtime)
    } catch (error) {
      pushWebLog('error', `Failed to create bot ${config.id}: ${error.message}`)
    }
  }

  if (!runtimes.has(botSettings.viewerTargetBotId)) {
    botSettings.viewerTargetBotId = STARTER_BOT_ID
  }

  ensureGroupIdsExist()
  saveBotSettings(botSettings)
}

async function main() {
  await bootstrapBots()
  startWebServer()
  startViewerFor(botSettings.viewerTargetBotId)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
