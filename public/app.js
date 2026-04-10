const socket = io()

const statusPill = document.getElementById('statusPill')
const toggleSelfDefense = document.getElementById('toggleSelfDefense')
const toggleAutoEat = document.getElementById('toggleAutoEat')
const commandForm = document.getElementById('commandForm')
const commandInput = document.getElementById('commandInput')
const settingsForm = document.getElementById('settingsForm')
const settingsNotice = document.getElementById('settingsNotice')
const logsView = document.getElementById('logsView')
const viewerFrame = document.getElementById('viewerFrame')
const viewerLink = document.getElementById('viewerLink')
const restartBotBtn = document.getElementById('restartBotBtn')
const shutdownBtn = document.getElementById('shutdownBtn')

let latestState = null

function setStatus(state) {
  latestState = state
  const connected = state.connected ? 'Online' : 'Offline'
  statusPill.textContent = `${connected} | ${state.username} @ ${state.host}:${state.port}`
  statusPill.style.background = state.connected ? 'rgba(28,124,84,0.35)' : 'rgba(166,58,80,0.35)'

  toggleSelfDefense.textContent = `Self Defense: ${state.selfDefenseEnabled ? 'ON' : 'OFF'}`
  toggleSelfDefense.style.background = state.selfDefenseEnabled ? '#1c7c54' : '#a63a50'

  toggleAutoEat.textContent = `Auto Eat: ${state.autoEatEnabled ? 'ON' : 'OFF'}`
  toggleAutoEat.style.background = state.autoEatEnabled ? '#1c7c54' : '#a63a50'

  viewerFrame.src = state.viewerUrl
  viewerLink.href = state.viewerUrl
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
