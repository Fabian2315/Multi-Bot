const fs = require('fs')
const path = require('path')
const http = require('http')
const express = require('express')
const { Server } = require('socket.io')
const mineflayer = require('mineflayer')
const mineflayerViewer = require('prismarine-viewer').mineflayer
const { pathfinder, Movements, goals: { GoalNear, GoalFollow, GoalBlock }} = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const collectBlock = require('mineflayer-collectblock').plugin
const autoEat = require('mineflayer-auto-eat').loader
const armorManager = require('mineflayer-armor-manager')
const nbt = require('prismarine-nbt')

const SETTINGS_FILE = path.join(__dirname, 'bot-settings.json')
const DEFAULT_BOT_SETTINGS = {
  host: 'localhost',
  port: 25565,
  username: 'Bot',
  version: '1.21.11',
  viewerPort: 3008,
  webPort: 3000
}

function loadBotSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_BOT_SETTINGS,
      ...parsed,
      port: Number(parsed.port) || DEFAULT_BOT_SETTINGS.port,
      viewerPort: Number(parsed.viewerPort) || DEFAULT_BOT_SETTINGS.viewerPort,
      webPort: Number(parsed.webPort) || DEFAULT_BOT_SETTINGS.webPort
    }
  } catch {
    return { ...DEFAULT_BOT_SETTINGS }
  }
}

function saveBotSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n', 'utf8')
}

const botSettings = loadBotSettings()

let bot = null

function createAndSetupBot() {
  bot = mineflayer.createBot({
    host: botSettings.host,
    port: botSettings.port,
    username: botSettings.username,
    version: botSettings.version
  })

  bot.loadPlugin(pathfinder)
  bot.loadPlugin(pvp)
  bot.loadPlugin(collectBlock)
  bot.loadPlugin(autoEat)
  bot.loadPlugin(armorManager)
  
  return bot
}

createAndSetupBot()

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
let defaultMove
let mcData
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
let io = null
const webLogs = []

function pushWebLog(type, message) {
  const entry = {
    ts: new Date().toISOString(),
    type,
    message
  }

  webLogs.push(entry)
  if (webLogs.length > 200) {
    webLogs.shift()
  }

  if (io) {
    io.emit('log', entry)
  }
}

function getRuntimeState() {
  return {
    username: bot.username,
    host: botSettings.host,
    port: botSettings.port,
    connected: Boolean(bot.player),
    selfDefenseEnabled,
    autoEatEnabled,
    miningEnabled,
    guardEnabled: Boolean(guardPos),
    viewerUrl: `http://localhost:${botSettings.viewerPort}`
  }
}

function broadcastState() {
  if (!io) return
  io.emit('state', getRuntimeState())
}

bot.once('spawn', () => {
  mineflayerViewer(bot, { port: botSettings.viewerPort, firstPerson: true })
  mcData = require('minecraft-data')(bot.version)
  defaultMove = new Movements(bot)
  handleAutoEat(true)
  handleSelfDefenseStatus()
  pushWebLog('system', `Spawned as ${bot.username} on ${botSettings.host}:${botSettings.port}`)
  broadcastState()
})

function processBotCommand(username, message) {
  switch (true) {
    case message === 'Bot.test':
      handleTest()
      break
    case message === 'Bot.come':
      handleCome(username)
      break
    case message.startsWith('Bot.goto '): {
      const gotoArgs = message.slice(9).trim().split(' ')
      if (gotoArgs.length === 1) {
        handleGoto(gotoArgs[0])
      } else if (gotoArgs.length === 3) {
        const [x, y, z] = gotoArgs.map(arg => parseInt(arg, 10))
        if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) {
          bot.chat('ERROR: usage Bot.goto <player> or Bot.goto <x> <y> <z>')
        } else {
          handleGoToPosition(x, y, z)
        }
      } else {
        bot.chat('ERROR: usage Bot.goto <player> or Bot.goto <x> <y> <z>')
      }
      break
    }
    case message === 'Bot.goto.nearest':
      handleGotoNearest()
      break
    case message.startsWith('Bot.follow '): {
      const targetUsernameFollow = message.slice(11).trim()
      handleFollow(targetUsernameFollow)
      break
    }
    case message.startsWith('Bot.attack '): {
      const targetUsernameAttack = message.slice(11).trim()
      handleAttack(targetUsernameAttack)
      break
    }
    case message === 'Bot.guard.here':
      handleGuardHere(username)
      break
    case message.startsWith('Bot.guard '): {
      const guardArgs = message.slice(10).trim().split(' ')
      if (guardArgs.length !== 3) {
        bot.chat('ERROR: usage Bot.guard <x> <y> <z>')
      } else {
        const [x, y, z] = guardArgs.map(arg => parseInt(arg, 10))
        if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) {
          bot.chat('ERROR: coordinates must be numbers')
        } else {
          handleGuardAtCoordinates(x, y, z)
        }
      }
      break
    }
    case message === 'Bot.guard':
      bot.chat('ERROR: usage Bot.guard <x> <y> <z> or Bot.guard.here')
      break
    case message === 'Bot.guard.stop':
      handleStopGuard()
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
      handleToggleSelfDefense()
      break
    case message === 'Bot.selfdefense.on':
      handleSetSelfDefense(true)
      break
    case message === 'Bot.selfdefense.off':
      handleSetSelfDefense(false)
      break
    case message === 'Bot.selfdefense.status':
      handleSelfDefenseStatus()
      break
    case message.startsWith('Bot.collect '): {
      const collectArgs = message.slice(12).trim().split(' ')
      if (collectArgs.length !== 2) {
        bot.chat('ERROR: usage Bot.collect <blockType> <number>')
      } else {
        const blockType = collectArgs[0]
        const number = parseInt(collectArgs[1], 10)
        if (Number.isNaN(number)) {
          bot.chat('ERROR: number must be a number')
        } else {
          handleBlockCollection(blockType, number)
        }
      }
      break
    }
    case message === 'Bot.autoEat':
      handleAutoEat(true)
      break
    case message === 'Bot.autoEat.stop':
      handleAutoEat(false)
      break
    case message === 'Bot.eat':
      handleEat()
      break
    case message === 'Bot.empty':
      handleEmptyInventory()
      break
    case message.startsWith('Bot.mine '): {
      const blockTypeMine = message.slice(9).trim()
      handleMiner(blockTypeMine)
      break
    }
    default:
      bot.chat('ERROR: unknown command')
      break
  }

  broadcastState()
}

// Listen for chat messages and handle commands. syntax: Bot.<command> [args]
bot.on('chat', (username, message) => {
  console.log(`chat event: ${username}: ${message}`)
  pushWebLog('chat', `${username}: ${message}`)
  if (username === bot.username) return
  processBotCommand(username, message)
})

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

  // Recreate follow goals on restore to avoid stale state after temporary PvP overrides.
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


function handleTest() {
  bot.chat('TEST: success')
}

function guardArea(pos) {
  guardPos = pos.clone()
  bot.pvp.stop()
  moveToGuardPos()
}

function moveToGuardPos() {
  if (!guardPos) return

  bot.pathfinder.setMovements(defaultMove)
  setTrackedGoal(new GoalBlock(
    Math.floor(guardPos.x),
    Math.floor(guardPos.y),
    Math.floor(guardPos.z)
  ))
}

function stopGuarding() {
  guardPos = null
  bot.pvp.stop()
  setTrackedGoal(null)
  broadcastState()
}

function handleGuardAtCoordinates(x, y, z) {
  const guardTarget = bot.entity.position.clone()
  guardTarget.x = x
  guardTarget.y = y
  guardTarget.z = z
  guardArea(guardTarget)
  bot.chat(`Guarding position ${x} ${y} ${z}`)
}

function handleGuardHere(username) {
  const player = bot.players[username]?.entity
  if (!player) {
    bot.chat("ERROR: I can't see you")
    return
  }

  guardArea(player.position)
  bot.chat('Guarding your current position')
}

function handleStopGuard() {
  if (!guardPos) {
    bot.chat('I am not guarding any area right now')
    return
  }

  stopGuarding()
  bot.chat('I will no longer guard this area')
}

//Go to a player and stop within 1 block of them
function handleCome(username) {
  const target = bot.players[username]?.entity
  if (!target) {
    bot.chat(`ERROR: I can't see ${username}`)
    return
  }

  bot.pathfinder.setMovements(defaultMove)
  setTrackedGoal(new GoalNear(target.position.x, target.position.y, target.position.z, RANGE_GOAL))
  bot.chat(`Coming to ${username}`)
}
//Go to a specified player
function handleGoto(targetUsername) {
  const target = bot.players[targetUsername]?.entity
  if (!target) {
    bot.chat(`ERROR: I can't see ${targetUsername}`)
    return
  }

  bot.pathfinder.setMovements(defaultMove)
  setTrackedGoal(new GoalFollow(target, RANGE_GOAL))
  bot.chat(`Going to ${targetUsername}`)
}

//Go to the nearest player
function handleGotoNearest() {
  const nearestPlayer = bot.nearestEntity((entity) => {
    if (!entity) return false
    if (entity.type !== 'player') return false
    if (entity.username === bot.username) return false
    if (entity.isValid === false) return false
    return true
  })

  if (!nearestPlayer) {
    bot.chat('ERROR: No players found')
    return
  }

  bot.pathfinder.setMovements(defaultMove)
  setTrackedGoal(new GoalFollow(nearestPlayer, RANGE_GOAL))
  bot.chat(`Going to nearest player: ${nearestPlayer.username}`)
}

//Follow a specified player, updating the goal as they move
function handleFollow(targetUsername) {
  const target = bot.players[targetUsername]?.entity
  if (!target) {
    bot.chat(`ERROR: I can't see ${targetUsername}`)
    return
  }

  bot.pathfinder.setMovements(defaultMove)
  setTrackedGoal(new GoalFollow(target, RANGE_GOAL), true, {
    type: 'follow',
    entity: target,
    username: targetUsername,
    range: RANGE_GOAL
  })
  bot.chat(`Following ${targetUsername}`)
}
//Attack a specified player, following them and hitting them when in range
async function handleAttack(targetUsername) {
  const target = bot.players[targetUsername]?.entity
  if (!target) {
    bot.chat(`ERROR: I can't see ${targetUsername}`)
    return
  }

  printInventoryDebug()
  await equipBestSword()

  bot.pathfinder.setMovements(defaultMove)
  setTrackedGoal(new GoalFollow(target, RANGE_GOAL), true)

  bot.pvp.attack(target)
  bot.pvp.followRange = RANGE_GOAL
  bot.chat(`Attacking ${targetUsername}`)
}
//Collect a specified block type a certain number of times, equipping the correct tool for the block before collecting it. Usage: Bot.collect <blockType> <number>
async function handleBlockCollection(blockType, repeats) {
  for (let i = 0; i < repeats; i++) {
    await collectBlockType(blockType)
  }
}
async function handleMiner(blockType) {
  miningEnabled = true
  broadcastState()
  const originalPos = bot.entity.position.clone()
  bot.chat('Starting miner, searching for ' + blockType)
  while (miningEnabled) {
    // Pause miner actions while self-defense is running so combat keeps sword equipped.
    if (selfDefenseInProgress) {
      await waitMs(200)
      continue
    }

    const block = bot.findBlock({
      matching: (b) => b && b.name === blockType,
      maxDistance: 64
    })
    if (block) {
      if (selfDefenseInProgress) continue
      bot.chat(`Found ${blockType} at ${block.position}`)
      PickCorrectTool(block)
      try {
        await bot.collectBlock.collect(block)
        bot.chat(`Mined ${blockType}`)
        // Add mandatory 1 tick pause after mining
        await new Promise(resolve => setTimeout(resolve, 50))
      } catch (e) {
        if (selfDefenseInProgress) continue
        bot.chat(`Failed to mine ${blockType}: ${e.message}`)
      }
    } else {
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
  }
}
//Empty the bot's inventory into the nearest chest within the specified radius
async function handleEmptyInventory() {
  const radius = EMPTY_INVENTORY_RADIUS
  try {
    // Find a chest within the radius
    const chestBlock = bot.findBlock({
      matching: (block) => {
        if (!block) return false
        return block.name === 'chest'
      },
      maxDistance: radius
    })

    if (!chestBlock) {
      bot.chat(`ERROR: No chest found within ${radius} blocks`)
      return
    }

    // Move to the chest
    bot.pathfinder.setMovements(defaultMove)
    setTrackedGoal(new GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 1))

    // Wait for the bot to reach the chest
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout reaching chest')), 30000) // 30 second timeout
      bot.once('goal_reached', () => {
        clearTimeout(timeout)
        resolve()
      })
    })

    // Open the chest
    const chest = await bot.openChest(chestBlock)

    // Get all items in the bot's inventory
    const items = bot.inventory.items()

    if (items.length === 0) {
      bot.chat('INFO: Inventory is already empty')
      chest.close()
      return
    }

    // Deposit each item into the chest
    for (const item of items) {
      await chest.deposit(item.type, item.metadata || null, item.count)
    }

    // Close the chest
    chest.close()

    bot.chat(`SUCCESS: Emptied ${items.length} item types into chest`)
  } catch (error) {
    bot.chat(`ERROR: Failed to empty inventory: ${error.message}`)
  }
}

//Stop attacking and following the current target
function handleStopPvp() {
  bot.pvp.stop()
  bot.chat('Stopped PvP actions')
}
//Stop following the current target
function handleStopFollow() {
  setTrackedGoal(null)
  bot.chat('Stopped following target')
}
function handleStopMiner() {
  miningEnabled = false
  setTrackedGoal(null)
  bot.chat('Stopped miner')
  broadcastState()
}
function handleAutoEat(enable) {
  if (!bot.autoEat) {
    bot.chat('ERROR: Auto-eat plugin not loaded')
    return
  }

  autoEatEnabled = Boolean(enable)
  if (enable) {
    bot.autoEat.enableAuto()
    bot.chat('Auto eat enabled')
  } else {
    bot.autoEat.disableAuto()
    bot.chat('Auto eat disabled')
  }

  broadcastState()
}
async function handleEat() {
  if (!bot.autoEat) {
    bot.chat('ERROR: Auto-eat plugin not loaded')
    return
  }

  try {
    await bot.autoEat.eat()
    bot.chat('Ate food successfully')
  } catch (error) {
    bot.chat(`ERROR: Failed to eat: ${error.message}`)
  }
}

async function equipBestSword(options = {}) {
  const { silent = false } = options
  const swords = bot.inventory.items().filter((item) => {
    const itemName = item.name || (mcData.items[item.type] && mcData.items[item.type].name)
    return itemName && itemName.endsWith('_sword')
  })
  if (swords.length === 0) {
    if (!silent) bot.chat('No swords found in inventory')
    return
  }

  const swordPriority = {
    netherite_sword: 1,
    diamond_sword: 2,
    iron_sword: 3,
    stone_sword: 4,
    wooden_sword: 5,
    golden_sword: 6,
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

  if (bestSword) {
    await bot.equip(bestSword, 'hand')
    if (!silent) {
      bot.chat(`Equipped ${bestSword.name || mcData.items[bestSword.type]?.name} (damage: ${Math.max(bestScore, 0)})`)
    }
  } else {
    if (!silent) bot.chat('No suitable sword found')
  }
}

async function handleGuardEntityAttack(entity) {
  if (!entity || entity.isValid === false || guardAttackInProgress) return

  guardAttackInProgress = true
  try {
    await equipBestSword({ silent: true })
    bot.pvp.attack(entity)
  } catch (error) {
    bot.chat(`ERROR: Failed to attack guard target: ${error.message}`)
  } finally {
    guardAttackInProgress = false
  }
}

function printInventoryDebug() {
  const items = bot.inventory.items()
  bot.chat(`DEBUG: inventory count=${items.length}`)
  for (const item of items) {
    const itemName = item.name || (mcData.items[item.type] && mcData.items[item.type].name)
    bot.chat(`DEBUG: slot=${item.slot} id=${item.type} name=${itemName} count=${item.count} meta=${item.metadata}`)
  }
}

//Go to a specific set of coordinates
function handleGoToPosition(x, y, z) {
  bot.pathfinder.setMovements(defaultMove)
  setTrackedGoal(new GoalNear(x, y, z, RANGE_GOAL), false)
  bot.chat(`Going to position ${x} ${y} ${z}`)
}

function handleToggleSelfDefense() {
  selfDefenseEnabled = !selfDefenseEnabled
  bot.chat(`Self defense ${selfDefenseEnabled ? 'enabled' : 'disabled'}`)
  broadcastState()
}

function handleSetSelfDefense(enabled) {
  selfDefenseEnabled = enabled
  bot.chat(`Self defense ${selfDefenseEnabled ? 'enabled' : 'disabled'}`)
  broadcastState()
}

function handleSelfDefenseStatus() {
  bot.chat(`Self defense is currently ${selfDefenseEnabled ? 'enabled' : 'disabled'}`)
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
    if (isValidSelfDefenseTarget(entity)) {
      return entity
    }
  }

  // Fallback: if packet attacker is unavailable (common with some damage sources),
  // pick the nearest valid hostile very close to the bot.
  return bot.nearestEntity((entity) => {
    if (!isValidSelfDefenseTarget(entity)) return false
    return entity.position.distanceTo(bot.entity.position) <= 6
  })
}

function isValidSelfDefenseTarget(entity) {
  if (!entity) return false
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

    // If attack already ended by the time listener is attached, continue quickly.
    setImmediate(() => {
      if (!bot.pvp.target) done()
    })
  })
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
    bot.chat(`ERROR: Self defense failed: ${error.message}`)
  } finally {
    bot.pvp.stop()
    await waitForStoppedAttacking()
    await waitMs(1000)
    selfDefenseInProgress = false
    restoreIntent(originalIntent)

    // Some plugins can clear goals shortly after combat state changes.
    // Reapply intent once more to make recovery deterministic across modes.
    setTimeout(() => {
      if (selfDefenseInProgress) return
      if (bot.pvp.target) return
      restoreIntent(originalIntent)
    }, 1000)
  }
}

//Helper function to equip the best tool for harvesting a block before collecting it
function PickCorrectTool(block) {
  const bestTool = bot.pathfinder.bestHarvestTool(block)
  if (bestTool) {
    bot.equip(bestTool, 'hand')
    bot.chat(`Equipped ${bestTool.name || mcData.items[bestTool.type]?.name} to harvest ${block.name}`)
  }
}


//Find and collect a block of the specified type within a certain radius. Equipts the correct tool for the block before collecting it.
async function collectBlockType(blockType, options = {}) {
  const radius = options.radius || 64
  
  try {
    // Find the block matching the specified type within the radius
    const block = bot.findBlock({
      matching: (block) => {
        if (!block) return false
        return block.name === blockType
      },
      maxDistance: radius
    })

    if (!block) {
      bot.chat(`ERROR: Could not find block type "${blockType}" within radius ${radius}`)
      return false
    }

    // Equip the correct tool for this block
    PickCorrectTool(block)

    // Collect the block using the collectblock plugin
    await bot.collectBlock.collect(block)
    bot.chat(`SUCCESS: Collected ${blockType}`)
    return true
  } catch (error) {
    bot.chat(`ERROR: Failed to collect ${blockType}: ${error.message}`)
    return false
  }

}

bot.on('stoppedAttacking', () => {
  if (selfDefenseInProgress) return

  if (guardPos) {
    moveToGuardPos()
  }
})

bot.on('physicsTick', () => {
  if (!guardPos) return
  if (selfDefenseInProgress) return

  const currentTarget = bot.pvp.target
  if (currentTarget) {
    // Keep current combat target only while it is still valid and near the guarded area.
    const hasPos = currentTarget.position && typeof currentTarget.position.distanceTo === 'function'
    const stillValid = currentTarget.isValid !== false
    const stillNearGuard = hasPos && currentTarget.position.distanceTo(guardPos) < 20
    if (stillValid && stillNearGuard) return

    bot.pvp.stop()
  }

  const entity = bot.nearestEntity((e) => {
    if (!e) return false
    if (e.isValid === false) return false
    if (e.type === 'player') return false
    if (!e.position || typeof e.position.distanceTo !== 'function') return false
    if (e.position.distanceTo(guardPos) >= 16) return false
    // Avoid non-combat entities that often cause attack failures.
    if (e.displayName === 'Armor Stand') return false
    if (e.name === 'item' || e.name === 'experience_orb') return false

    return true
  })

  if (entity) {
    handleGuardEntityAttack(entity)
  }
})

bot._client.on('damage_event', (packet) => {
  trackRecentDamager(packet)
})

bot.on('entityHurt', (entity) => {
  if (entity?.id !== bot.entity?.id) return
  retaliateAgainstAttacker()
})

// Log errors and kick reasons:
bot.on('kicked', (reason, loggedIn) => {
  let readableReason = reason
  try {
    if (reason && typeof reason === 'object') {
      readableReason = JSON.stringify(nbt.simplify(reason))
    }
  } catch {
    readableReason = String(reason)
  }

  const kickText = `KICKED: ${readableReason} | loggedIn=${loggedIn}`
  pushWebLog('error', kickText)
  console.log(kickText)
  broadcastState()
})

bot.on('error', (err) => {
  const code = err && err.code ? ` code=${err.code}` : ''
  const syscall = err && err.syscall ? ` syscall=${err.syscall}` : ''
  const errorText = `BOT ERROR:${code}${syscall} message=${err?.message || String(err)}`
  pushWebLog('error', errorText)
  console.log(errorText)
  broadcastState()
})

bot.on('end', () => {
  pushWebLog('system', 'Bot disconnected')
  broadcastState()
})

async function restartBot() {
  pushWebLog('system', 'Restarting bot...')
  
  try {
    // Disconnect the old bot
    if (bot && bot.player) {
      bot.quit()
      // Wait a bit for the bot to disconnect
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  } catch (err) {
    pushWebLog('error', `Error disconnecting old bot: ${err.message}`)
  }
  
  // Reset state variables
  miningEnabled = false
  guardPos = null
  guardAttackInProgress = false
  selfDefenseEnabled = true
  selfDefenseInProgress = false
  recentDamagerEntityId = null
  recentDamagerAt = 0
  trackedGoalState = {
    goal: null,
    dynamic: false,
    meta: null
  }
  autoEatEnabled = false
  mcData = null
  defaultMove = null
  
  // Create and setup new bot
  createAndSetupBot()
  pushWebLog('system', 'Bot restarted successfully')
  broadcastState()
}

function startWebServer() {
  const app = express()
  const server = http.createServer(app)

  io = new Server(server, {
    cors: {
      origin: '*'
    }
  })

  app.use(express.json())
  app.use(express.static(path.join(__dirname, 'public')))

  app.get('/api/status', (req, res) => {
    res.json(getRuntimeState())
  })

  app.get('/api/settings', (req, res) => {
    res.json({ ...botSettings })
  })

  app.post('/api/settings', (req, res) => {
    const nextSettings = {
      ...botSettings,
      ...req.body,
      port: Number(req.body?.port ?? botSettings.port) || botSettings.port,
      viewerPort: Number(req.body?.viewerPort ?? botSettings.viewerPort) || botSettings.viewerPort,
      webPort: Number(req.body?.webPort ?? botSettings.webPort) || botSettings.webPort
    }

    botSettings.host = nextSettings.host
    botSettings.port = nextSettings.port
    botSettings.username = nextSettings.username
    botSettings.version = nextSettings.version
    botSettings.viewerPort = nextSettings.viewerPort
    botSettings.webPort = nextSettings.webPort

    saveBotSettings(botSettings)
    pushWebLog('system', 'Saved settings. Restart bot process to apply connection changes.')

    res.json({
      ok: true,
      settings: botSettings,
      note: 'Saved. Restart this process to apply host/port/username/version changes.'
    })
  })

  app.post('/api/command', (req, res) => {
    const rawCommand = String(req.body?.command || '').trim()
    const username = String(req.body?.username || 'WebUI')

    if (!rawCommand) {
      res.status(400).json({ ok: false, error: 'Missing command' })
      return
    }

    const normalizedCommand = rawCommand.startsWith('Bot.') ? rawCommand : `Bot.${rawCommand}`
    pushWebLog('command', `${username} -> ${normalizedCommand}`)
    processBotCommand(username, normalizedCommand)

    res.json({ ok: true, command: normalizedCommand })
  })

  app.post('/api/toggle/:name', (req, res) => {
    const toggleName = req.params.name

    if (toggleName === 'selfDefense') {
      handleToggleSelfDefense()
      return res.json({ ok: true, selfDefenseEnabled })
    }

    if (toggleName === 'autoEat') {
      handleAutoEat(!autoEatEnabled)
      return res.json({ ok: true, autoEatEnabled })
    }

    return res.status(404).json({ ok: false, error: `Unknown toggle ${toggleName}` })
  })

  app.post('/api/restart-bot', async (req, res) => {
    try {
      await restartBot()
      res.json({ ok: true, message: 'Bot restarted successfully' })
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message })
    }
  })

  app.post('/api/shutdown', (req, res) => {
    res.json({ ok: true, message: 'Shutting down...' })
    setTimeout(() => {
      process.exit(0)
    }, 500)
  })

  io.on('connection', (socket) => {
    socket.emit('bootstrap', {
      state: getRuntimeState(),
      settings: botSettings,
      logs: webLogs
    })
  })

  server.listen(botSettings.webPort, () => {
    const message = `Web dashboard running at http://localhost:${botSettings.webPort}`
    console.log(message)
    pushWebLog('system', message)
  })
}

startWebServer()
