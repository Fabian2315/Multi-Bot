const socket = io()

const statusPill = document.getElementById('statusPill')
const toggleSelfDefense = document.getElementById('toggleSelfDefense')
const toggleAutoEat = document.getElementById('toggleAutoEat')
const toggleSilentMode = document.getElementById('toggleSilentMode')
const commandForm = document.getElementById('commandForm')
const commandInput = document.getElementById('commandInput')
const settingsForm = document.getElementById('settingsForm')
const settingsNotice = document.getElementById('settingsNotice')
const logsView = document.getElementById('logsView')
const viewerFrame = document.getElementById('viewerFrame')
const viewerLink = document.getElementById('viewerLink')
const viewerNotice = document.getElementById('viewerNotice')
const toggleViewer = document.getElementById('toggleViewer')
const restartBotBtn = document.getElementById('restartBotBtn')
const shutdownBtn = document.getElementById('shutdownBtn')
const healthFill = document.getElementById('healthFill')
const healthValue = document.getElementById('healthValue')
const hungerFill = document.getElementById('hungerFill')
const hungerValue = document.getElementById('hungerValue')
const coordValue = document.getElementById('coordValue')
const inventorySummary = document.getElementById('inventorySummary')
const inventoryEmpty = document.getElementById('inventoryEmpty')
const inventoryList = document.getElementById('inventoryList')

let latestState = null

function clampToPercent(value, max) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0
  if (max <= 0) return 0
  return Math.max(0, Math.min(100, (value / max) * 100))
}

function formatStackName(name) {
  return String(name || 'unknown_item').replace(/_/g, ' ')
}

function renderVitals(state) {
  const health = typeof state.health === 'number' ? state.health : null
  const hunger = typeof state.hunger === 'number' ? state.hunger : null

  healthFill.style.width = `${clampToPercent(health, 20)}%`
  hungerFill.style.width = `${clampToPercent(hunger, 20)}%`

  healthValue.textContent = health === null ? '-- / 20' : `${health.toFixed(1)} / 20`
  hungerValue.textContent = hunger === null ? '-- / 20' : `${hunger} / 20`

  const pos = state.position
  coordValue.textContent = pos
    ? `${pos.x.toFixed(1)},  ${pos.y.toFixed(1)},  ${pos.z.toFixed(1)}`
    : '-- / -- / --'
}

function renderInventory(state) {
  const inventory = Array.isArray(state.inventory) ? state.inventory : []
  const totalItems = inventory.reduce((sum, item) => sum + (Number(item.count) || 0), 0)
  inventorySummary.textContent = `${inventory.length} stacks | ${totalItems} items`
  inventoryEmpty.style.display = inventory.length ? 'none' : 'block'
  inventoryList.innerHTML = ''

  inventory.forEach((item) => {
    const line = document.createElement('li')
    line.innerHTML = `<span>${formatStackName(item.name)}</span><strong>x${item.count}</strong>`
    inventoryList.appendChild(line)
  })
}

function setStatus(state) {
  latestState = state
  const connected = state.connected ? 'Online' : 'Offline'
  statusPill.textContent = `${connected} | ${state.username} @ ${state.host}:${state.port}`
  statusPill.style.background = state.connected ? 'rgba(28,124,84,0.35)' : 'rgba(166,58,80,0.35)'

  toggleSelfDefense.textContent = `Self Defense: ${state.selfDefenseEnabled ? 'ON' : 'OFF'}`
  toggleSelfDefense.style.background = state.selfDefenseEnabled ? '#1c7c54' : '#a63a50'

  toggleAutoEat.textContent = `Auto Eat: ${state.autoEatEnabled ? 'ON' : 'OFF'}`
  toggleAutoEat.style.background = state.autoEatEnabled ? '#1c7c54' : '#a63a50'

  toggleSilentMode.textContent = `Silent Mode: ${state.silentModeEnabled ? 'ON' : 'OFF'}`
  toggleSilentMode.style.background = state.silentModeEnabled ? '#1c7c54' : '#a63a50'

  toggleViewer.textContent = `Viewer: ${state.viewerEnabled ? 'ON' : 'OFF'}`
  toggleViewer.style.background = state.viewerEnabled ? '#1c7c54' : '#a63a50'

  if (state.viewerEnabled) {
    if (viewerFrame.src !== state.viewerUrl) {
      viewerFrame.src = state.viewerUrl
    }
    viewerNotice.textContent = `Viewer is live at ${state.viewerUrl}`
  } else {
    viewerFrame.src = 'about:blank'
    viewerNotice.textContent = 'Viewer is disabled. Toggle it ON to start Prismarine Viewer.'
  }

  viewerLink.href = state.viewerUrl
  renderVitals(state)
  renderInventory(state)
}

function appendLog(log) {
  logsView.textContent += `[${log.ts}] [${log.type}] ${log.message}\n`
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

function readSettingsForm() {
  const data = new FormData(settingsForm)
  return {
    host: String(data.get('host') || '').trim(),
    port: Number(data.get('port')),
    username: String(data.get('username') || '').trim(),
    version: String(data.get('version') || '').trim(),
    viewerPort: Number(data.get('viewerPort')),
    webPort: Number(data.get('webPort'))
  }
}

function fillSettingsForm(settings) {
  settingsForm.host.value = settings.host
  settingsForm.port.value = settings.port
  settingsForm.username.value = settings.username
  settingsForm.version.value = settings.version
  settingsForm.viewerPort.value = settings.viewerPort
  settingsForm.webPort.value = settings.webPort
}

document.querySelectorAll('.tab').forEach((button) => {
  button.addEventListener('click', () => {
    const target = button.dataset.tab
    document.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'))
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'))
    button.classList.add('active')
    document.getElementById(target).classList.add('active')
  })
})

document.querySelectorAll('[data-command]').forEach((button) => {
  button.addEventListener('click', async () => {
    try {
      await postJson('/api/command', { command: button.dataset.command, username: 'WebUI' })
    } catch (error) {
      appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
    }
  })
})

toggleSelfDefense.addEventListener('click', async () => {
  try {
    await postJson('/api/toggle/selfDefense')
  } catch (error) {
    appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
  }
})

toggleAutoEat.addEventListener('click', async () => {
  try {
    await postJson('/api/toggle/autoEat')
  } catch (error) {
    appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
  }
})

toggleSilentMode.addEventListener('click', async () => {
  try {
    await postJson('/api/toggle/silent')
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

commandForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const command = commandInput.value.trim()
  if (!command) return

  try {
    await postJson('/api/command', { command, username: 'WebUI' })
    commandInput.value = ''
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

restartBotBtn.addEventListener('click', async () => {
  if (!confirm('Restart the bot? The webserver will keep running.')) return
  try {
    await postJson('/api/restart-bot')
    appendLog({ ts: new Date().toISOString(), type: 'system', message: 'Bot restart initiated' })
  } catch (error) {
    appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
  }
})

shutdownBtn.addEventListener('click', async () => {
  if (!confirm('Shutdown the entire server? This will stop both the bot and webserver.')) return
  try {
    await postJson('/api/shutdown')
    appendLog({ ts: new Date().toISOString(), type: 'system', message: 'Server shutting down...' })
  } catch (error) {
    appendLog({ ts: new Date().toISOString(), type: 'error', message: error.message })
  }
})

socket.on('bootstrap', ({ state, settings, logs }) => {
  logsView.textContent = ''
  logs.forEach(appendLog)
  setStatus(state)
  fillSettingsForm(settings)
})

socket.on('state', (state) => {
  setStatus(state)
})

socket.on('log', (log) => {
  appendLog(log)
})
