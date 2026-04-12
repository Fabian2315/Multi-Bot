const socket = io()

const statusPill = document.getElementById('statusPill')
const botList = document.getElementById('botList')
const groupList = document.getElementById('groupList')
const commandTarget = document.getElementById('commandTarget')
const commandForm = document.getElementById('commandForm')
const commandInput = document.getElementById('commandInput')
const commandAutocompleteList = document.getElementById('commandAutocompleteList')
const craftForm = document.getElementById('craftForm')
const craftItemInput = document.getElementById('craftItemInput')
const craftCountInput = document.getElementById('craftCountInput')
const toggleSelfDefense = document.getElementById('toggleSelfDefense')
const toggleAutoEat = document.getElementById('toggleAutoEat')
const toggleSilentMode = document.getElementById('toggleSilentMode')
const toggleTpsDashboard = document.getElementById('toggleTpsDashboard')
const toggleViewer = document.getElementById('toggleViewer')
const restartBotBtn = document.getElementById('restartBotBtn')
const shutdownBtn = document.getElementById('shutdownBtn')
const logsView = document.getElementById('logsView')
const viewerFrame = document.getElementById('viewerFrame')
const viewerLink = document.getElementById('viewerLink')
const viewerNotice = document.getElementById('viewerNotice')
const settingsForm = document.getElementById('settingsForm')
const settingsNotice = document.getElementById('settingsNotice')
const healthFill = document.getElementById('healthFill')
const healthValue = document.getElementById('healthValue')
const hungerFill = document.getElementById('hungerFill')
const hungerValue = document.getElementById('hungerValue')
const coordValue = document.getElementById('coordValue')
const tpsValue = document.getElementById('tpsValue')
const inventorySummary = document.getElementById('inventorySummary')
const inventoryEmpty = document.getElementById('inventoryEmpty')
const inventoryList = document.getElementById('inventoryList')
const queueStepForm = document.getElementById('queueStepForm')
const queueStepType = document.getElementById('queueStepType')
const queueCommandRow = document.getElementById('queueCommandRow')
const queueCommandInput = document.getElementById('queueCommandInput')
const queueWaitCompletionRow = document.getElementById('queueWaitCompletionRow')
const queueWaitCompletionInput = document.getElementById('queueWaitCompletionInput')
const queueWaitSecondsRow = document.getElementById('queueWaitSecondsRow')
const queueWaitSecondsInput = document.getElementById('queueWaitSecondsInput')
const queueSettingsForm = document.getElementById('queueSettingsForm')
const queueOnFailureInput = document.getElementById('queueOnFailureInput')
const queueRetryCountInput = document.getElementById('queueRetryCountInput')
const queueTimeoutSecInput = document.getElementById('queueTimeoutSecInput')
const queueStatusBadge = document.getElementById('queueStatusBadge')
const queueRunInfo = document.getElementById('queueRunInfo')
const queuePerBotStatus = document.getElementById('queuePerBotStatus')
const queueStepsList = document.getElementById('queueStepsList')
const queueStartBtn = document.getElementById('queueStartBtn')
const queueStopBtn = document.getElementById('queueStopBtn')
const queueClearBtn = document.getElementById('queueClearBtn')

const openAddBotBtn = document.getElementById('openAddBotBtn')
const closeAddBotBtn = document.getElementById('closeAddBotBtn')
const addBotModal = document.getElementById('addBotModal')
const singleBotForm = document.getElementById('singleBotForm')
const batchBotForm = document.getElementById('batchBotForm')
const createGroupBtn = document.getElementById('createGroupBtn')
const groupForm = document.getElementById('groupForm')
const cancelGroupBtn = document.getElementById('cancelGroupBtn')
const groupName = document.getElementById('groupName')
const groupBotChecklist = document.getElementById('groupBotChecklist')
const groupFormMode = document.getElementById('groupFormMode')
const groupSaveBtn = document.getElementById('groupSaveBtn')
const starterAuth = document.getElementById('starterAuth')
const starterTokenRow = document.getElementById('starterTokenRow')
const viewerTargetBotId = document.getElementById('viewerTargetBotId')
const switchViewerBtn = document.getElementById('switchViewerBtn')
const authModal = document.getElementById('authModal')
const authModalText = document.getElementById('authModalText')
const closeAuthModalBtn = document.getElementById('closeAuthModalBtn')

let dashboardState = {
  bots: [],
  groups: [],
  viewerEnabled: true,
  tpsDashboardEnabled: true,
  viewerTargetBotId: 'starter',
  viewerActiveBotId: null,
  viewerUrl: 'http://localhost:3008'
}
let selectedTarget = 'starter'
let selectedBotForDetails = 'starter'
let editingGroupId = null
let selectedQueue = {
  target: 'starter',
  steps: [],
  running: false,
  stopRequested: false,
  currentStepIndex: -1,
  settings: {
    onFailure: 'stop',
    retryCount: 1,
    completionTimeoutSec: 60
  },
  perBot: {},
  lastError: null
}
let autocompleteCommands = []
let autocompleteItems = []
let activeAutocompleteOptions = []
let lastViewerFrameUrl = ''

function normalizeUrl(url) {
  if (!url) return ''

  try {
    return new URL(url, window.location.href).href
  } catch {
    return String(url)
  }
}

function clampToPercent(value, max) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0
  if (max <= 0) return 0
  return Math.max(0, Math.min(100, (value / max) * 100))
}

function botById(botId) {
  return dashboardState.bots.find((bot) => bot.id === botId) || null
}

function selectedBot() {
  return botById(selectedBotForDetails) || dashboardState.bots[0] || null
}

function formatStackName(name) {
  return String(name || 'unknown_item').replace(/_/g, ' ')
}

function appendLog(log) {
  const botPart = log.botId ? ` [${log.botId}]` : ''
  logsView.textContent += `[${log.ts}] [${log.type}]${botPart} ${log.message}\n`
  logsView.scrollTop = logsView.scrollHeight
}

async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `Request failed: ${response.status}`)
  }

  return response.json()
}

async function getJson(url) {
  const response = await fetch(url)
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `Request failed: ${response.status}`)
  }
  return response.json()
}

async function deleteJson(url) {
  const response = await fetch(url, { method: 'DELETE' })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `Request failed: ${response.status}`)
  }
  return response.json()
}

async function putJson(url, body = {}) {
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `Request failed: ${response.status}`)
  }

  return response.json()
}

async function loadAutocompleteData() {
  try {
    const result = await getJson('/api/autocomplete')
    autocompleteCommands = Array.isArray(result.commands) ? result.commands : []
    autocompleteItems = Array.isArray(result.items) ? result.items : []
    updateAutocompleteSuggestions(commandInput)
  } catch (error) {
    appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
  }
}

function commandAutocompleteContext(value) {
  const raw = String(value || '')
  const trimmed = raw.trim()
  if (!trimmed) return { mode: 'commands', query: '', prefix: '' }

  const hasTrailingSpace = /\s$/.test(raw)
  const tokens = trimmed.split(/\s+/)
  const firstRaw = (tokens[0] || '').toLowerCase()
  const first = firstRaw.startsWith('bot.') ? firstRaw : `bot.${firstRaw}`
  const craftLike = first === 'bot.craft' || first === 'bot.smelt'

  if (!craftLike) {
    if (tokens.length === 1 && !hasTrailingSpace) {
      return { mode: 'commands', query: tokens[0], prefix: '' }
    }
    return { mode: 'none', query: '', prefix: '' }
  }

  const argumentIndex = hasTrailingSpace ? tokens.length : tokens.length - 1
  if (argumentIndex <= 1) {
    const commandToken = tokens[0] || ''
    const prefix = `${commandToken} `
    return { mode: 'items', query: tokens[1] || '', prefix }
  }

  return { mode: 'none', query: '', prefix: '' }
}

function setAutocompleteOptions(options) {
  if (!commandAutocompleteList) return
  commandAutocompleteList.innerHTML = ''
  activeAutocompleteOptions = options.slice(0, 80)

  activeAutocompleteOptions.forEach((value) => {
    const option = document.createElement('option')
    option.value = value
    commandAutocompleteList.appendChild(option)
  })
}

function updateAutocompleteSuggestions(inputElement) {
  const context = commandAutocompleteContext(inputElement.value)
  if (context.mode === 'none') {
    setAutocompleteOptions([])
    return
  }

  const pool = context.mode === 'items' ? autocompleteItems : autocompleteCommands
  const query = String(context.query || '').trim().toLowerCase()

  const matches = !query
    ? pool
    : pool.filter((entry) => String(entry).toLowerCase().startsWith(query))

  const options = context.mode === 'items'
    ? matches.map((itemId) => `${context.prefix}${itemId}`)
    : matches

  setAutocompleteOptions(options)
}

function maybeApplyAutocomplete(inputElement, event) {
  if (event.key !== 'Tab') return
  if (!activeAutocompleteOptions.length) return

  const candidate = activeAutocompleteOptions[0]
  if (!candidate) return

  event.preventDefault()
  inputElement.value = candidate
  updateAutocompleteSuggestions(inputElement)
}

function renderBots() {
  botList.innerHTML = ''

  const allRow = document.createElement('button')
  allRow.className = `list-row ${selectedTarget === 'all' ? 'active' : ''}`
  allRow.textContent = 'All Bots'
  allRow.addEventListener('click', () => {
    selectedTarget = 'all'
    renderTargets()
    renderBots()
  })
  botList.appendChild(allRow)

  dashboardState.bots.forEach((bot) => {
    const row = document.createElement('div')
    row.className = `list-row ${selectedBotForDetails === bot.id ? 'active' : ''}`

    const left = document.createElement('button')
    left.className = 'linkish'
    left.innerHTML = `<span class="dot ${bot.connected ? 'online' : 'offline'}"></span>${bot.username} <small>(${bot.id})</small>`
    left.addEventListener('click', () => {
      selectedBotForDetails = bot.id
      selectedTarget = bot.id
      renderAll()
    })

    row.appendChild(left)

    if (bot.id !== 'starter') {
      const del = document.createElement('button')
      del.className = 'mini-btn danger'
      del.textContent = 'Delete'
      del.addEventListener('click', async () => {
        if (!confirm(`Delete bot ${bot.username}?`)) return
        try {
          await deleteJson(`/api/bots/${bot.id}`)
        } catch (error) {
          appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
        }
      })
      row.appendChild(del)
    }

    botList.appendChild(row)
  })
}

function renderGroups() {
  groupList.innerHTML = ''
  dashboardState.groups.forEach((group) => {
    const row = document.createElement('div')
    row.className = `list-row ${selectedTarget === `group:${group.id}` ? 'active' : ''}`

    const left = document.createElement('button')
    left.className = 'linkish'
    left.textContent = `${group.name} (${group.botIds.length})`
    left.addEventListener('click', () => {
      selectedTarget = `group:${group.id}`
      renderTargets()
      renderGroups()
    })

    const del = document.createElement('button')
    del.className = 'mini-btn danger'
    del.textContent = 'Delete'
    del.addEventListener('click', async () => {
      try {
        await deleteJson(`/api/groups/${group.id}`)
      } catch (error) {
        appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
      }
    })

    const edit = document.createElement('button')
    edit.className = 'mini-btn'
    edit.textContent = 'Edit'
    edit.addEventListener('click', () => {
      openGroupForm(group)
    })

    row.appendChild(left)
    row.appendChild(edit)
    row.appendChild(del)
    groupList.appendChild(row)
  })
}

function renderTargets() {
  const oldValue = selectedTarget
  commandTarget.innerHTML = ''

  const allOption = document.createElement('option')
  allOption.value = 'all'
  allOption.textContent = 'All Bots'
  commandTarget.appendChild(allOption)

  dashboardState.bots.forEach((bot) => {
    const option = document.createElement('option')
    option.value = bot.id
    option.textContent = `Bot: ${bot.username} (${bot.id})`
    commandTarget.appendChild(option)
  })

  dashboardState.groups.forEach((group) => {
    const option = document.createElement('option')
    option.value = `group:${group.id}`
    option.textContent = `Group: ${group.name}`
    commandTarget.appendChild(option)
  })

  if ([...commandTarget.options].some((option) => option.value === oldValue)) {
    commandTarget.value = oldValue
  } else if ([...commandTarget.options].some((option) => option.value === selectedTarget)) {
    commandTarget.value = selectedTarget
  } else {
    commandTarget.value = 'all'
    selectedTarget = 'all'
  }
}

function renderViewerTargetSelect() {
  const old = viewerTargetBotId.value
  viewerTargetBotId.innerHTML = ''
  dashboardState.bots.forEach((bot) => {
    const option = document.createElement('option')
    option.value = bot.id
    option.textContent = `${bot.username} (${bot.id})`
    viewerTargetBotId.appendChild(option)
  })

  if ([...viewerTargetBotId.options].some((o) => o.value === dashboardState.viewerTargetBotId)) {
    viewerTargetBotId.value = dashboardState.viewerTargetBotId
  } else if ([...viewerTargetBotId.options].some((o) => o.value === old)) {
    viewerTargetBotId.value = old
  }
}

function renderVitals() {
  const bot = selectedBot()
  if (!bot) {
    healthFill.style.width = '0%'
    hungerFill.style.width = '0%'
    healthValue.textContent = '-- / 20'
    hungerValue.textContent = '-- / 20'
    coordValue.textContent = '-- / -- / --'
    tpsValue.textContent = '--'
    inventorySummary.textContent = '0 stacks | 0 items'
    inventoryEmpty.style.display = 'block'
    inventoryList.innerHTML = ''
    return
  }

  const health = typeof bot.health === 'number' ? bot.health : null
  const hunger = typeof bot.hunger === 'number' ? bot.hunger : null

  healthFill.style.width = `${clampToPercent(health, 20)}%`
  hungerFill.style.width = `${clampToPercent(hunger, 20)}%`

  healthValue.textContent = health === null ? '-- / 20' : `${health.toFixed(1)} / 20`
  hungerValue.textContent = hunger === null ? '-- / 20' : `${hunger} / 20`

  const pos = bot.position
  coordValue.textContent = pos ? `${pos.x.toFixed(1)},  ${pos.y.toFixed(1)},  ${pos.z.toFixed(1)}` : '-- / -- / --'
  if (!dashboardState.tpsDashboardEnabled) {
    tpsValue.textContent = 'Disabled'
  } else {
    tpsValue.textContent = typeof bot.tps === 'number' ? bot.tps.toFixed(2) : '--'
  }

  const inventory = Array.isArray(bot.inventory) ? bot.inventory : []
  const totalItems = inventory.reduce((sum, item) => sum + (Number(item.count) || 0), 0)
  inventorySummary.textContent = `${inventory.length} stacks | ${totalItems} items`
  inventoryEmpty.style.display = inventory.length ? 'none' : 'block'
  inventoryList.innerHTML = ''

  inventory.forEach((item) => {
    const line = document.createElement('li')
    line.innerHTML = `<span>${formatStackName(item.name)}</span><strong>x${item.count}</strong>`
    inventoryList.appendChild(line)
  })

  toggleSelfDefense.textContent = `Self Defense: ${bot.selfDefenseEnabled ? 'ON' : 'OFF'}`
  toggleSelfDefense.style.background = bot.selfDefenseEnabled ? '#1c7c54' : '#a63a50'

  toggleAutoEat.textContent = `Auto Eat: ${bot.autoEatEnabled ? 'ON' : 'OFF'}`
  toggleAutoEat.style.background = bot.autoEatEnabled ? '#1c7c54' : '#a63a50'

  toggleSilentMode.textContent = `Silent Mode: ${bot.silentModeEnabled ? 'ON' : 'OFF'}`
  toggleSilentMode.style.background = bot.silentModeEnabled ? '#1c7c54' : '#a63a50'
}

function renderStatusAndViewer() {
  const online = dashboardState.bots.filter((bot) => bot.connected).length
  statusPill.textContent = `${online}/${dashboardState.bots.length} bots online @ ${dashboardState.host}:${dashboardState.port}`
  statusPill.style.background = online ? 'rgba(28,124,84,0.35)' : 'rgba(166,58,80,0.35)'

  toggleViewer.textContent = `Viewer: ${dashboardState.viewerEnabled ? 'ON' : 'OFF'}`
  toggleViewer.style.background = dashboardState.viewerEnabled ? '#1c7c54' : '#a63a50'

  toggleTpsDashboard.textContent = `TPS Dashboard: ${dashboardState.tpsDashboardEnabled ? 'ON' : 'OFF'}`
  toggleTpsDashboard.style.background = dashboardState.tpsDashboardEnabled ? '#1c7c54' : '#a63a50'

  viewerLink.href = dashboardState.viewerUrl

  if (dashboardState.viewerEnabled) {
    const nextViewerUrl = normalizeUrl(dashboardState.viewerUrl)
    if (lastViewerFrameUrl !== nextViewerUrl) {
      viewerFrame.src = nextViewerUrl
      lastViewerFrameUrl = nextViewerUrl
    }
    viewerNotice.textContent = `Viewer target: ${dashboardState.viewerTargetBotId || 'none'} | active: ${dashboardState.viewerActiveBotId || 'none'}`
  } else {
    if (lastViewerFrameUrl !== 'about:blank') {
      viewerFrame.src = 'about:blank'
      lastViewerFrameUrl = 'about:blank'
    }
    viewerNotice.textContent = 'Viewer is disabled.'
  }
}

function renderGroupChecklist() {
  groupBotChecklist.innerHTML = ''
  dashboardState.bots.forEach((bot) => {
    const label = document.createElement('label')
    label.className = 'check-row'
    label.innerHTML = `<input type="checkbox" value="${bot.id}"> ${bot.username} (${bot.id})`
    groupBotChecklist.appendChild(label)
  })
}

function setGroupMode(mode) {
  if (mode === 'edit') {
    groupFormMode.textContent = 'Edit Group'
    groupSaveBtn.textContent = 'Update Group'
  } else {
    groupFormMode.textContent = 'Create Group'
    groupSaveBtn.textContent = 'Save Group'
  }
}

function resetGroupForm() {
  editingGroupId = null
  groupName.value = ''
  renderGroupChecklist()
  setGroupMode('create')
}

function openGroupForm(group = null) {
  groupForm.classList.remove('hidden')
  renderGroupChecklist()

  if (!group) {
    resetGroupForm()
    return
  }

  editingGroupId = group.id
  groupName.value = group.name
  const selected = new Set(group.botIds)
  groupBotChecklist.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.checked = selected.has(input.value)
  })
  setGroupMode('edit')
}

function renderAll() {
  renderTargets()
  renderBots()
  renderGroups()
  renderViewerTargetSelect()
  renderVitals()
  renderStatusAndViewer()
  renderQueueControls()
  renderQueue()
}

function queueIsCommandWaitable(command) {
  const text = String(command || '').trim()
  if (!text) return false
  const normalized = text.startsWith('Bot.') ? text : `Bot.${text}`
  return normalized.startsWith('Bot.goto ') || normalized === 'Bot.goto.nearest' || normalized.startsWith('Bot.craft ') || normalized.startsWith('Bot.smelt ')
}

function renderQueueControls() {
  if (!queueStepType) return

  const commandStep = queueStepType.value === 'command'
  queueCommandRow.classList.toggle('hidden', !commandStep)
  queueWaitCompletionRow.classList.toggle('hidden', !commandStep)
  queueWaitSecondsRow.classList.toggle('hidden', commandStep)

  const canWait = queueIsCommandWaitable(queueCommandInput.value)
  queueWaitCompletionInput.disabled = !canWait
  if (!canWait) {
    queueWaitCompletionInput.checked = false
    queueWaitCompletionRow.title = 'Wait for completion is only available for Bot.goto variants, Bot.craft, and Bot.smelt'
  } else {
    queueWaitCompletionRow.title = ''
  }
}

function queueStepSummary(step) {
  if (step.type === 'wait') {
    return `Wait ${step.seconds}s`
  }

  const waitText = step.waitForCompletion ? ' (wait for completion)' : ''
  return `${step.command}${waitText}`
}

function renderQueue() {
  if (!queueStatusBadge) return

  const stepCount = Array.isArray(selectedQueue.steps) ? selectedQueue.steps.length : 0
  queueStatusBadge.textContent = selectedQueue.running ? 'Running' : 'Idle'
  queueStatusBadge.style.background = selectedQueue.running ? 'rgba(28,124,84,0.35)' : 'rgba(31,42,45,0.2)'

  if (selectedQueue.lastError) {
    queueRunInfo.textContent = `Error: ${selectedQueue.lastError}`
    queueRunInfo.style.color = '#a63a50'
  } else {
    queueRunInfo.style.color = ''
    queueRunInfo.textContent = selectedQueue.running
      ? `Step ${Math.max(0, selectedQueue.currentStepIndex + 1)} of ${stepCount}`
      : `${stepCount} step${stepCount === 1 ? '' : 's'} queued`
  }

  queuePerBotStatus.innerHTML = ''
  for (const [botId, state] of Object.entries(selectedQueue.perBot || {})) {
    const row = document.createElement('div')
    row.className = 'list-row'
    row.innerHTML = `<strong>${botId}</strong><span>${state.status}${state.error ? ` | ${state.error}` : ''}</span>`
    queuePerBotStatus.appendChild(row)
  }

  queueStepsList.innerHTML = ''
  selectedQueue.steps.forEach((step, index) => {
    const row = document.createElement('div')
    const isCurrent = selectedQueue.running && selectedQueue.currentStepIndex === index
    row.className = `list-row queue-step-row ${isCurrent ? 'active' : ''}`

    const text = document.createElement('span')
    text.textContent = `${index + 1}. ${queueStepSummary(step)}`
    row.appendChild(text)

    const actions = document.createElement('div')
    actions.className = 'inline-actions queue-inline-actions'

    const up = document.createElement('button')
    up.className = 'mini-btn'
    up.textContent = 'Up'
    up.disabled = selectedQueue.running || index === 0
    up.addEventListener('click', async () => {
      await reorderQueueStep(index, index - 1)
    })

    const down = document.createElement('button')
    down.className = 'mini-btn'
    down.textContent = 'Down'
    down.disabled = selectedQueue.running || index === selectedQueue.steps.length - 1
    down.addEventListener('click', async () => {
      await reorderQueueStep(index, index + 1)
    })

    const del = document.createElement('button')
    del.className = 'mini-btn danger'
    del.textContent = 'Remove'
    del.disabled = selectedQueue.running
    del.addEventListener('click', async () => {
      try {
        await deleteJson(`/api/queue/steps/${step.id}?target=${encodeURIComponent(selectedTarget)}`)
        await loadSelectedQueue()
      } catch (error) {
        appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
      }
    })

    actions.appendChild(up)
    actions.appendChild(down)
    actions.appendChild(del)
    row.appendChild(actions)
    queueStepsList.appendChild(row)
  })

  queueStartBtn.disabled = selectedQueue.running || !selectedQueue.steps.length
  queueStopBtn.disabled = !selectedQueue.running
  queueClearBtn.disabled = selectedQueue.running || !selectedQueue.steps.length
  queueSettingsForm.querySelectorAll('input,select,button').forEach((el) => {
    el.disabled = selectedQueue.running
  })
}

async function loadSelectedQueue() {
  try {
    const result = await getJson(`/api/queue?target=${encodeURIComponent(selectedTarget)}`)
    if (result?.queue) {
      selectedQueue = result.queue
      queueOnFailureInput.value = selectedQueue.settings?.onFailure || 'stop'
      queueRetryCountInput.value = selectedQueue.settings?.retryCount ?? 1
      queueTimeoutSecInput.value = selectedQueue.settings?.completionTimeoutSec ?? 60
      renderQueue()
    }
  } catch (error) {
    appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
  }
}

async function reorderQueueStep(fromIndex, toIndex) {
  const steps = [...selectedQueue.steps]
  const [moved] = steps.splice(fromIndex, 1)
  steps.splice(toIndex, 0, moved)

  try {
    await putJson('/api/queue/steps', {
      target: selectedTarget,
      stepIds: steps.map((step) => step.id)
    })
    await loadSelectedQueue()
  } catch (error) {
    appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
  }
}

function readSettingsForm() {
  const data = new FormData(settingsForm)

  const commandSettings = {
    rangeGoal: Number(data.get('rangeGoal')),
    craftSearchRadius: Number(data.get('craftSearchRadius')),
    emptyInventoryRadius: Number(data.get('emptyInventoryRadius')),
    collectRadius: Number(data.get('collectRadius')),
    mineSearchRadius: Number(data.get('mineSearchRadius')),
    mineRoamMinDistance: Number(data.get('mineRoamMinDistance')),
    mineRoamMaxDistance: Number(data.get('mineRoamMaxDistance')),
    guardProtectRadius: Number(data.get('guardProtectRadius')),
    guardContinuePursuitRadius: Number(data.get('guardContinuePursuitRadius')),
    selfDefenseTargetDistance: Number(data.get('selfDefenseTargetDistance')),
    selfDefenseChaseDistance: Number(data.get('selfDefenseChaseDistance'))
  }

  return {
    host: String(data.get('host') || '').trim(),
    port: Number(data.get('port')),
    version: String(data.get('version') || '').trim(),
    viewerPort: Number(data.get('viewerPort')),
    webPort: Number(data.get('webPort')),
    starterUsername: String(data.get('starterUsername') || '').trim(),
    starterAuth: String(data.get('starterAuth') || 'offline'),
    starterToken: String(data.get('starterToken') || ''),
    viewerTargetBotId: String(data.get('viewerTargetBotId') || ''),
    commandSettings
  }
}

function fillSettingsForm(settings) {
  settingsForm.host.value = settings.host
  settingsForm.port.value = settings.port
  settingsForm.version.value = settings.version
  settingsForm.viewerPort.value = settings.viewerPort
  settingsForm.webPort.value = settings.webPort
  settingsForm.starterUsername.value = settings.starterUsername || 'Bot'
  settingsForm.starterAuth.value = settings.starterAuth || 'offline'
  settingsForm.starterToken.value = settings.starterToken || ''

  const commandSettings = settings.commandSettings || {}
  settingsForm.rangeGoal.value = commandSettings.rangeGoal ?? 1
  settingsForm.craftSearchRadius.value = commandSettings.craftSearchRadius ?? 32
  settingsForm.emptyInventoryRadius.value = commandSettings.emptyInventoryRadius ?? 50
  settingsForm.collectRadius.value = commandSettings.collectRadius ?? 64
  settingsForm.mineSearchRadius.value = commandSettings.mineSearchRadius ?? 64
  settingsForm.mineRoamMinDistance.value = commandSettings.mineRoamMinDistance ?? 50
  settingsForm.mineRoamMaxDistance.value = commandSettings.mineRoamMaxDistance ?? 100
  settingsForm.guardProtectRadius.value = commandSettings.guardProtectRadius ?? 16
  settingsForm.guardContinuePursuitRadius.value = commandSettings.guardContinuePursuitRadius ?? 20
  settingsForm.selfDefenseTargetDistance.value = commandSettings.selfDefenseTargetDistance ?? 12
  settingsForm.selfDefenseChaseDistance.value = commandSettings.selfDefenseChaseDistance ?? 14

  starterTokenRow.style.display = settingsForm.starterAuth.value === 'token' ? 'grid' : 'none'
}

commandTarget.addEventListener('change', () => {
  selectedTarget = commandTarget.value
  renderBots()
  renderGroups()
  loadSelectedQueue()
})

queueStepType.addEventListener('change', () => {
  renderQueueControls()
})

queueCommandInput.addEventListener('input', () => {
  updateAutocompleteSuggestions(queueCommandInput)
  renderQueueControls()
})

commandInput.addEventListener('input', () => {
  updateAutocompleteSuggestions(commandInput)
})

commandInput.addEventListener('focus', () => {
  updateAutocompleteSuggestions(commandInput)
})

commandInput.addEventListener('keydown', (event) => {
  maybeApplyAutocomplete(commandInput, event)
})

queueCommandInput.addEventListener('focus', () => {
  updateAutocompleteSuggestions(queueCommandInput)
})

queueCommandInput.addEventListener('keydown', (event) => {
  maybeApplyAutocomplete(queueCommandInput, event)
})

document.querySelectorAll('.tab').forEach((button) => {
  if (!button.dataset.tab) return
  button.addEventListener('click', () => {
    const target = button.dataset.tab
    document.querySelectorAll('.tab[data-tab]').forEach((tab) => tab.classList.remove('active'))
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'))
    button.classList.add('active')
    document.getElementById(target).classList.add('active')
  })
})

document.querySelectorAll('[data-command]').forEach((button) => {
  button.addEventListener('click', async () => {
    try {
      await postJson('/api/command', { command: button.dataset.command, username: 'WebUI', target: selectedTarget })
    } catch (error) {
      appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
    }
  })
})

commandForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const command = commandInput.value.trim()
  if (!command) return

  try {
    await postJson('/api/command', { command, username: 'WebUI', target: selectedTarget })
    commandInput.value = ''
  } catch (error) {
    appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
  }
})

craftForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const itemId = craftItemInput.value.trim()
  const count = Math.max(1, Number(craftCountInput.value) || 1)
  if (!itemId) return

  try {
    await postJson('/api/command', { command: `Bot.craft ${itemId} ${count}`, username: 'WebUI', target: selectedTarget })
    craftItemInput.value = ''
    craftCountInput.value = '1'
  } catch (error) {
    appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
  }
})

toggleSelfDefense.addEventListener('click', async () => {
  try {
    await postJson('/api/toggle/selfDefense', { target: selectedTarget })
  } catch (error) {
    appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
  }
})

toggleAutoEat.addEventListener('click', async () => {
  try {
    await postJson('/api/toggle/autoEat', { target: selectedTarget })
  } catch (error) {
    appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
  }
})

toggleSilentMode.addEventListener('click', async () => {
  try {
    await postJson('/api/toggle/silent', { target: selectedTarget })
  } catch (error) {
    appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
  }
})

toggleTpsDashboard.addEventListener('click', async () => {
  try {
    await postJson('/api/toggle/tpsDashboard')
  } catch (error) {
    appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
  }
})

toggleViewer.addEventListener('click', async () => {
  try {
    await postJson('/api/toggle/viewer')
  } catch (error) {
    appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
  }
})

restartBotBtn.addEventListener('click', async () => {
  if (!confirm('Restart all bots?')) return
  try {
    await postJson('/api/restart-bot')
  } catch (error) {
    appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
  }
})

shutdownBtn.addEventListener('click', async () => {
  if (!confirm('Shutdown server?')) return
  try {
    await postJson('/api/shutdown')
  } catch (error) {
    appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
  }
})

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  try {
    const payload = readSettingsForm()
    const result = await postJson('/api/settings', payload)
    settingsNotice.style.color = '#1c7c54'
    settingsNotice.textContent = result.note
  } catch (error) {
    settingsNotice.style.color = '#a63a50'
    settingsNotice.textContent = error.message
  }
})

starterAuth.addEventListener('change', () => {
  starterTokenRow.style.display = starterAuth.value === 'token' ? 'grid' : 'none'
})

switchViewerBtn.addEventListener('click', async () => {
  try {
    await postJson('/api/viewer/target', { botId: viewerTargetBotId.value })
    settingsNotice.style.color = '#1c7c54'
    settingsNotice.textContent = 'Viewer switched successfully.'
  } catch (error) {
    settingsNotice.style.color = '#a63a50'
    settingsNotice.textContent = error.message
  }
})

openAddBotBtn.addEventListener('click', () => {
  addBotModal.classList.remove('hidden')
})

closeAddBotBtn.addEventListener('click', () => {
  addBotModal.classList.add('hidden')
})

createGroupBtn.addEventListener('click', () => {
  openGroupForm()
})

cancelGroupBtn.addEventListener('click', () => {
  groupForm.classList.add('hidden')
  resetGroupForm()
})

groupForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const name = groupName.value.trim()
  if (!name) return

  const botIds = [...groupBotChecklist.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value)

  try {
    if (editingGroupId) {
      await putJson(`/api/groups/${editingGroupId}`, { name, botIds })
    } else {
      await postJson('/api/groups', { name, botIds })
    }
    groupForm.classList.add('hidden')
    resetGroupForm()
  } catch (error) {
    appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
  }
})

singleBotForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const data = new FormData(singleBotForm)
  try {
    await postJson('/api/bots', {
      username: String(data.get('username') || '').trim(),
      auth: String(data.get('auth') || 'offline'),
      token: String(data.get('token') || '')
    })
    singleBotForm.reset()
    addBotModal.classList.add('hidden')
  } catch (error) {
    appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
  }
})

batchBotForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const data = new FormData(batchBotForm)
  try {
    await postJson('/api/bots/batch', {
      prefix: String(data.get('prefix') || 'Bot').trim(),
      start: Number(data.get('start')),
      count: Number(data.get('count')),
      auth: String(data.get('auth') || 'offline'),
      token: String(data.get('token') || '')
    })
    addBotModal.classList.add('hidden')
  } catch (error) {
    appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
  }
})

document.querySelectorAll('[data-add-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    const mode = button.dataset.addTab
    document.querySelectorAll('[data-add-tab]').forEach((tab) => tab.classList.remove('active'))
    document.querySelectorAll('.add-tab').forEach((tab) => tab.classList.remove('active'))
    button.classList.add('active')
    if (mode === 'single') {
      singleBotForm.classList.add('active')
    } else {
      batchBotForm.classList.add('active')
    }
  })
})

function wireAuthSelects() {
  document.querySelectorAll('.auth-select').forEach((select) => {
    const row = select.closest('form').querySelector('.token-row')
    const update = () => {
      row.classList.toggle('hidden', select.value !== 'token')
    }
    select.addEventListener('change', update)
    update()
  })
}
wireAuthSelects()

closeAuthModalBtn.addEventListener('click', () => {
  authModal.classList.add('hidden')
})

socket.on('bootstrap', ({ state, settings, logs }) => {
  dashboardState = state
  logsView.textContent = ''
  logs.forEach(appendLog)

  fillSettingsForm(settings)
  selectedBotForDetails = dashboardState.bots.some((bot) => bot.id === selectedBotForDetails)
    ? selectedBotForDetails
    : (dashboardState.bots[0]?.id || 'starter')

  if (!dashboardState.bots.some((bot) => bot.id === selectedTarget) && !selectedTarget.startsWith('group:')) {
    selectedTarget = 'all'
  }

  renderAll()
  renderQueueControls()
  loadSelectedQueue()
  loadAutocompleteData()
})

socket.on('state', (state) => {
  const previousTarget = selectedTarget
  dashboardState = state

  if (!dashboardState.bots.some((bot) => bot.id === selectedBotForDetails)) {
    selectedBotForDetails = dashboardState.bots[0]?.id || 'starter'
  }

  if (selectedTarget !== 'all' && !selectedTarget.startsWith('group:') && !dashboardState.bots.some((bot) => bot.id === selectedTarget)) {
    selectedTarget = 'all'
  }

  renderAll()

  if (selectedTarget !== previousTarget) {
    loadSelectedQueue()
  }
})

socket.on('queue_state', ({ target, queue }) => {
  if (String(target) !== String(selectedTarget)) return
  selectedQueue = queue
  queueOnFailureInput.value = selectedQueue.settings?.onFailure || 'stop'
  queueRetryCountInput.value = selectedQueue.settings?.retryCount ?? 1
  queueTimeoutSecInput.value = selectedQueue.settings?.completionTimeoutSec ?? 60
  renderQueue()
})

socket.on('log', (log) => {
  appendLog(log)
})

socket.on('auth_required', ({ botId, url, userCode }) => {
  authModalText.textContent = `Bot ${botId} needs Microsoft sign-in. Visit ${url} and enter code: ${userCode}`
  authModal.classList.remove('hidden')
})

socket.on('auth_done', ({ botId }) => {
  if (!authModal.classList.contains('hidden')) {
    authModalText.textContent = `Microsoft sign-in completed for ${botId}.`
    setTimeout(() => {
      authModal.classList.add('hidden')
    }, 1200)
  }
})

queueStepForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const type = queueStepType.value

  try {
    if (type === 'command') {
      const command = queueCommandInput.value.trim()
      if (!command) return
      await postJson('/api/queue/step', {
        target: selectedTarget,
        step: {
          type: 'command',
          command,
          waitForCompletion: queueWaitCompletionInput.checked
        }
      })
      queueCommandInput.value = ''
      queueWaitCompletionInput.checked = false
      renderQueueControls()
    } else {
      const seconds = Number(queueWaitSecondsInput.value)
      if (!Number.isFinite(seconds) || seconds < 1) return
      await postJson('/api/queue/step', {
        target: selectedTarget,
        step: {
          type: 'wait',
          seconds
        }
      })
    }

    await loadSelectedQueue()
  } catch (error) {
    appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
  }
})

queueSettingsForm.addEventListener('submit', async (event) => {
  event.preventDefault()

  try {
    await postJson('/api/queue/settings', {
      target: selectedTarget,
      settings: {
        onFailure: queueOnFailureInput.value,
        retryCount: Number(queueRetryCountInput.value),
        completionTimeoutSec: Number(queueTimeoutSecInput.value)
      }
    })
    await loadSelectedQueue()
  } catch (error) {
    appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
  }
})

queueStartBtn.addEventListener('click', async () => {
  try {
    await postJson('/api/queue/start', { target: selectedTarget, username: 'WebUI' })
    await loadSelectedQueue()
  } catch (error) {
    appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
  }
})

queueStopBtn.addEventListener('click', async () => {
  try {
    await postJson('/api/queue/stop', { target: selectedTarget })
    await loadSelectedQueue()
  } catch (error) {
    appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
  }
})

queueClearBtn.addEventListener('click', async () => {
  try {
    await postJson('/api/queue/clear', { target: selectedTarget })
    await loadSelectedQueue()
  } catch (error) {
    appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
  }
})