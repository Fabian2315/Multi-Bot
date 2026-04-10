const mineflayer = require('mineflayer')
const mineflayerViewer = require('prismarine-viewer').mineflayer
const { pathfinder, Movements, goals: { GoalNear, GoalFollow, GoalBlock }} = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const collectBlock = require('mineflayer-collectblock').plugin
const autoEat = require('mineflayer-auto-eat').loader
const armorManager = require('mineflayer-armor-manager')
const nbt = require('prismarine-nbt')


const bot = mineflayer.createBot({
  host: 'localhost',
  port: 25565,
  username: 'Bot',
  version: '1.21.11'
})

bot.loadPlugin(pathfinder)
bot.loadPlugin(pvp)
bot.loadPlugin(collectBlock)
bot.loadPlugin(autoEat)
bot.loadPlugin(armorManager)

const RANGE_GOAL = 1
const EMPTY_INVENTORY_RADIUS = 50
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
  dynamic: false
}

bot.once('spawn', () => {
  mineflayerViewer(bot, { port: 3008, firstPerson: true })
  mcData = require('minecraft-data')(bot.version)
  defaultMove = new Movements(bot)
  handleAutoEat(true)
})

// Listen for chat messages and handle commands. syntax: Bot.<command> [args]
bot.on('chat', (username, message) => {
  console.log(`chat event: ${username}: ${message}`)
  if (username === bot.username) return

  switch (true) {
    case message === 'Bot.test':
      handleTest()
      break
    case message === 'Bot.come':
      handleCome(username)
      break
    case message.startsWith('Bot.goto '):
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
    case message.startsWith('Bot.follow '):
      const targetUsernameFollow = message.slice(11).trim()
      handleFollow(targetUsernameFollow)
      break
    case message.startsWith('Bot.attack '):
      const targetUsernameAttack = message.slice(11).trim()
      handleAttack(targetUsernameAttack)
      break
    case message === 'Bot.guard.here':
      handleGuardHere(username)
      break
    case message.startsWith('Bot.guard '):
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
    case message.startsWith('Bot.collect '):
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
    case message.startsWith('Bot.mine '):
      const blockTypeMine = message.slice(9).trim()
      handleMiner(blockTypeMine)
      break
  }
})

function setTrackedGoal(goal, dynamic = false) {
  trackedGoalState = { goal, dynamic }
  bot.pathfinder.setGoal(goal, dynamic)
}

function captureCurrentIntent() {
  return {
    goal: {
      goal: trackedGoalState.goal,
      dynamic: trackedGoalState.dynamic
    },
    pvpTarget: bot.pvp.target || null
  }
}

function restoreIntent(intent) {
  if (!intent) return

  if (intent.goal.goal) {
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
//Follow a specified player, updating the goal as they move
function handleFollow(targetUsername) {
  const target = bot.players[targetUsername]?.entity
  if (!target) {
    bot.chat(`ERROR: I can't see ${targetUsername}`)
    return
  }

  bot.pathfinder.setMovements(defaultMove)
  setTrackedGoal(new GoalFollow(target, RANGE_GOAL), true)
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
  const originalPos = bot.entity.position.clone()
  bot.chat('Starting miner, searching for ' + blockType)
  while (miningEnabled) {
    const block = bot.findBlock({
      matching: (b) => b && b.name === blockType,
      maxDistance: 64
    })
    if (block) {
      bot.chat(`Found ${blockType} at ${block.position}`)
      PickCorrectTool(block)
      try {
        await bot.collectBlock.collect(block)
        bot.chat(`Mined ${blockType}`)
        // Add mandatory 1 tick pause after mining
        await new Promise(resolve => setTimeout(resolve, 50))
      } catch (e) {
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
      await new Promise((resolve) => {
        const onReached = () => {
          bot.removeListener('goal_reached', onReached)
          resolve()
        }
        bot.on('goal_reached', onReached)
      })
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
}
function handleAutoEat(enable) {
  if (!bot.autoEat) {
    bot.chat('ERROR: Auto-eat plugin not loaded')
    return
  }

  if (enable) {
    bot.autoEat.enableAuto()
    bot.chat('Auto eat enabled')
  } else {
    bot.autoEat.disableAuto()
    bot.chat('Auto eat disabled')
  }
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
}

function handleSetSelfDefense(enabled) {
  selfDefenseEnabled = enabled
  bot.chat(`Self defense ${selfDefenseEnabled ? 'enabled' : 'disabled'}`)
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
    if (entity && entity.isValid !== false) {
      return entity
    }
  }

  return bot.nearestEntity((entity) => {
    if (!entity) return false
    if (entity.isValid === false) return false
    if (entity.id === bot.entity.id) return false
    if (!entity.position || typeof entity.position.distanceTo !== 'function') return false
    if (entity.position.distanceTo(bot.entity.position) > 6) return false

    return true
  })
}

function waitForEntityToBeDead(entity, timeoutMs = 20000) {
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
    await waitForEntityToBeDead(attacker)
  } catch (error) {
    bot.chat(`ERROR: Self defense failed: ${error.message}`)
  } finally {
    bot.pvp.stop()
    await waitForStoppedAttacking()
    selfDefenseInProgress = false
    restoreIntent(originalIntent)
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

  console.log(`KICKED: ${readableReason} | loggedIn=${loggedIn}`)
})

bot.on('error', (err) => {
  const code = err && err.code ? ` code=${err.code}` : ''
  const syscall = err && err.syscall ? ` syscall=${err.syscall}` : ''
  console.log(`BOT ERROR:${code}${syscall} message=${err?.message || String(err)}`)
})
