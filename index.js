const fs = require('fs')
const path = require('path')
const http = require('http')
const express = require('express')
const { Server } = require('socket.io')
const mineflayer = require('mineflayer')
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

const SETTINGS_FILE = path.join(__dirname, 'bot-settings.json')
const STARTER_BOT_ID = 'starter'

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
  viewerTargetBotId: STARTER_BOT_ID,
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
      viewerTargetBotId: String(parsed.viewerTargetBotId || STARTER_BOT_ID),
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
    viewerTargetBotId: String(settings.viewerTargetBotId || STARTER_BOT_ID),
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
let viewerAttachedBotId = null

const RANGE_GOAL = 1
const EMPTY_INVENTORY_RADIUS = 50
const SELF_DEFENSE_MAX_TARGET_DISTANCE = 12
const SELF_DEFENSE_MAX_CHASE_DISTANCE = 14
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
    viewerTargetBotId: botSettings.viewerTargetBotId,
    viewerActiveBotId: viewerAttachedBotId,
    viewerUrl: getViewerUrl(),
    bots: getBotsState(),
    groups: botSettings.groups
  }
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
      goalIntent = {
        type: 'follow',
        dynamic: true,
        entity: currentMeta.entity || null,
        username: currentMeta.username || null,
        range: typeof currentMeta.range === 'number' ? currentMeta.range : RANGE_GOAL
      }
    }

    if (goalIntent.type !== 'follow' && currentGoal && currentGoal.constructor?.name === 'GoalFollow' && currentGoal.entity) {
      goalIntent = {
        type: 'follow',
        dynamic: true,
        entity: currentGoal.entity,
        range: typeof currentGoal.range === 'number' ? currentGoal.range : RANGE_GOAL
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
    if (entity.position.distanceTo(bot.entity.position) > SELF_DEFENSE_MAX_TARGET_DISTANCE) return false

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
      setTrackedGoal(new GoalFollow(attacker, RANGE_GOAL), true)
      bot.pvp.attack(attacker)
      await waitForEntityToBeDead(attacker, { maxDistance: SELF_DEFENSE_MAX_CHASE_DISTANCE })
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
    const chestBlock = bot.findBlock({
      matching: (block) => block && block.name === 'chest',
      maxDistance: EMPTY_INVENTORY_RADIUS
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
    const radius = options.radius || 64

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
          maxDistance: 64
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
        const distance = 50 + Math.random() * 50
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
    const message = normalizeCommand(input)

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
        setTrackedGoal(new GoalNear(target.position.x, target.position.y, target.position.z, RANGE_GOAL))
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
          setTrackedGoal(new GoalFollow(target, RANGE_GOAL), true, {
            type: 'follow',
            entity: target,
            username: args[0],
            range: RANGE_GOAL
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
          setTrackedGoal(new GoalNear(x, y, z, RANGE_GOAL), false)
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
        setTrackedGoal(new GoalFollow(nearest, RANGE_GOAL), true, {
          type: 'follow',
          entity: nearest,
          username: nearest.username,
          range: RANGE_GOAL
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
        setTrackedGoal(new GoalFollow(target, RANGE_GOAL), true, {
          type: 'follow',
          entity: target,
          username: targetName,
          range: RANGE_GOAL
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
        setTrackedGoal(new GoalFollow(target, RANGE_GOAL), true)
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

        handleBlockCollection(blockType, count).catch((error) => {
          say(`ERROR: ${error.message}`)
        })
        break
      }
      case message === 'Bot.autoEat':
        setAutoEat(true)
        break
      case message === 'Bot.autoEat.stop':
        setAutoEat(false)
        break
      case message === 'Bot.eat':
        bot.autoEat.eat()
          .then(() => say('Ate food successfully'))
          .catch((error) => say(`ERROR: Failed to eat: ${error.message}`))
        break
      case message === 'Bot.empty':
        handleEmptyInventory().catch((error) => say(`ERROR: ${error.message}`))
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

    broadcastState(true)
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
      const hasPos = currentTarget.position && typeof currentTarget.position.distanceTo === 'function'
      const stillValid = currentTarget.isValid !== false
      const stillNearGuard = hasPos && currentTarget.position.distanceTo(guardPos) < 20
      if (stillValid && stillNearGuard) return
      bot.pvp.stop()
    }

    const entity = bot.nearestEntity((candidate) => {
      if (!candidate) return false
      if (candidate.type === 'player') return false
      if (candidate.isValid === false) return false
      if (!candidate.position || typeof candidate.position.distanceTo !== 'function') return false
      if (candidate.position.distanceTo(guardPos) >= 16) return false
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
    res.json({ ...botSettings, viewerEnabled })
  })

  app.post('/api/settings', (req, res) => {
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
      viewerTargetBotId: String(req.body?.viewerTargetBotId || botSettings.viewerTargetBotId)
    }

    if (!runtimes.has(nextSettings.viewerTargetBotId)) {
      return res.status(400).json({ ok: false, error: 'Viewer target bot does not exist' })
    }

    Object.assign(botSettings, nextSettings)
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

  app.post('/api/toggle/:name', (req, res) => {
    const toggleName = String(req.params.name)

    if (toggleName === 'viewer') {
      setViewerEnabled(!viewerEnabled)
      return res.json({ ok: true, viewerEnabled })
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
