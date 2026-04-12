# Multi-Bot

A Mineflayer-based Minecraft bot controller with a local web dashboard, now supporting multiple bots, command targeting, groups, and a single switchable Prismarine viewer.

## Important

This project is largely vibecoded (including this readme), because im a bad dev and to be honest as a student dont want to spend my free time learning how to code. Please expect some type of unexpected behavieour and bugs.

## Chat Notice

If you want bots to reply to in-game chat commands, make sure your server allows unsigned chat as needed for your setup.

For many offline/local setups, this means setting the following in server.properties:

enforce-secure-profile=false

## Project Overview

The app starts one starter bot and hosts a local dashboard. From the dashboard you can:

- Add more bots (single or batch naming)
- Control one bot, all bots, or a group
- Create and edit groups for easier command targeting
- Configure starter auth mode (offline, Microslop, token)
- Switch the single Prismarine viewer to any bot

## Features

- Multi-bot runtime manager
- Per-target command execution:
  - Single bot
  - All bots
  - Group
-Staged command execution
- Group management (create, edit, delete)
- Bot automation capabilities:
  - Movement and following
  - PvP and guard mode
  - Self-defense retaliation
  - Block collection and mining loop
  - Craft planning and table-assisted crafting
  - Furnace/smoker/blast-furnace smelting
  - Auto-eat and manual eat
  - Inventory emptying to nearest chest
- Context-aware command input autocomplete:
  - Command suggestions at root input
  - Item-id suggestions for craft/smelt item arguments
  - Tab-to-apply top suggestion
- Single Prismarine viewer instance, switchable target bot
- Web dashboard with live state/logs over Socket.IO
- Settings persistence in bot-settings.json

## Quick Start

1. Install dependencies:

npm install

2. Start the app:

npm start

3. Open dashboard:

http://localhost:3000

## Requirements

- Node.js (LTS recommended)
- A reachable Minecraft server

## Configuration

Settings are stored in bot-settings.json.

Current schema:

| Setting | Description |
|---|---|
| host | Minecraft server host |
| port | Minecraft server port |
| version | Minecraft version |
| viewerPort | Prismarine viewer HTTP port |
| webPort | Dashboard port |
| starterUsername | Starter bot username |
| starterAuth | Starter auth mode: offline, Microslop, token |
| starterToken | Token used when starterAuth is token |
| viewerTargetBotId | Which bot currently owns the single viewer |
| commandSettings.craftSearchRadius | Maximum distance to search for crafting/smelting stations |
| bots | Persisted extra bots: id, username, auth, token |
| groups | Persisted groups: id, name, botIds |

## Dashboard Usage

### Add Bots

- Use the Bots panel + Add button.
- Single mode: create one bot with custom username/auth.
- Batch mode: create numbered bots using prefix/start/count.

### Command Targeting

- Choose target from the command target dropdown:
  - All Bots
  - Specific bot
  - Group
- Quick action buttons and manual command input use this target.

### Smart Autocomplete

- Command input suggests command names when you have no arguments yet.
- When entering `craft` or `smelt`, the first argument switches to item-id suggestions.
- Press `Tab` in the command field to apply the top suggestion.

### Group Management

- Create group from the Groups panel.
- Edit group to rename or change members.
- Delete group when no longer needed.

### Viewer Targeting

- Viewer is single-instance only.
- In Settings, choose Viewer Bot and switch viewer immediately.

## Auth Modes

Supported bot auth modes:

- offline
- Microslop (device flow; code prompt appears in dashboard modal)
- token

## Command Reference

Commands must start with Bot. to be interpreted as commands.

- Bot.test
- Bot.come
- Bot.goto <player>
- Bot.goto <x> <y> <z>
- Bot.goto.nearest
- Bot.follow <player>
- Bot.follow.stop
- Bot.attack <player>
- Bot.pvp.stop
- Bot.guard <x> <y> <z>
- Bot.guard.here
- Bot.guard.stop
- Bot.selfdefense
- Bot.selfdefense.on
- Bot.selfdefense.off
- Bot.selfdefense.status
- Bot.silent
- Bot.silent.on
- Bot.silent.off
- Bot.silent.status
- Bot.collect <blockType> <count>
- Bot.craft <itemId> [count]
- Bot.smelt <itemId> [count] [station]
- Bot.mine <blockType>
- Bot.miner.stop
- Bot.autoEat
- Bot.autoEat.stop
- Bot.eat
- Bot.empty

## Crafting Notes

- Crafting uses Minecraft item ids such as `oak_planks`, `stick`, or `wooden_pickaxe`.
- The bot resolves recipes from `minecraft-data` instead of a large handwritten recipe file.
- For crafting-table recipes, the bot first checks inventory materials, then searches for a nearby crafting table, walks to it, and crafts the item.
- Smelting uses a compact local furnace registry (`data/recipe-registry.js`) for furnace/smoker/blast-furnace outputs.
- Smelting command format: `Bot.smelt <itemId> [count] [station]` where station can be `auto`, `furnace`, `smoker`, or `blast_furnace`.
- Queue wait-for-completion supports `Bot.goto` variants, `Bot.craft`, and `Bot.smelt`.

## API Summary

Primary routes:

- GET /api/status
- GET /api/settings
- GET /api/autocomplete
- POST /api/settings
- GET /api/bots
- POST /api/bots
- POST /api/bots/batch
- DELETE /api/bots/:botId
- GET /api/groups
- POST /api/groups
- PUT /api/groups/:groupId
- DELETE /api/groups/:groupId
- POST /api/command
- POST /api/toggle/:name
- POST /api/viewer/target
- POST /api/restart-bot
- POST /api/shutdown


