# Mineflayer Bot

A customizable Minecraft bot built with Mineflayer and plugins for navigation, PvP, block collection, auto-eating, armor management, and inventory handling.

## Important

This project is vibecoded in large parts (including this readme), due to me being a bad dev and honestly I dont have any idea what I'm really doing. Also this code is kinda messy. Im currently a student and dont have to much motivation on hand to learn coding in my free time, so dont expect any changes in how I handle this project.

## Chat Notice

For the bot to respond in the in game chat, you need to go into the server.properties file and and change enforce-secure-profile to false. 

## Project Overview

This project runs a local Minecraft bot (`Bot`) that listens to in-game chat commands.
You can use commands to move, follow players, fight, guard an area, mine resources, collect blocks, eat automatically, and empty inventory into nearby chests.

## Features

- Player navigation (`come`, `goto`, `follow`)
- Combat (`attack`, guard mode)
- Self-defense retaliation (toggleable, ignores players)
- Resource collection (`collect`, `mine`)
- Survival utility (`autoEat`, manual eat)
- Inventory utility (`empty` into nearest chest)
- Built-in web viewer support via `prismarine-viewer`

## Default Bot Configuration

Current defaults from `index.js`:

- Host: `localhost`
- Port: `25565`
- Username: `Bot`
- Viewer Port: `3008`

## Requirements

- Node.js (LTS recommended)
- A running Minecraft server in offline mode (default in this project: `localhost:25565`)

## Chat Command Reference

Use these commands in Minecraft chat:

- `Bot.test`
  - What it does: Sends a test success response.
  - Syntax: `Bot.test`

- `Bot.come`
  - What it does: Bot walks to the player who sent the command.
  - Syntax: `Bot.come`

- `Bot.goto <player>`
  - What it does: Bot goes to the named player.
  - Syntax: `Bot.goto Steve`

- `Bot.goto <x> <y> <z>`
  - What it does: Bot goes to specific coordinates.
  - Syntax: `Bot.goto 100 64 -20`

- `Bot.follow <player>`
  - What it does: Bot continuously follows a player.
  - Syntax: `Bot.follow Steve`

- `Bot.follow.stop`
  - What it does: Stops following.
  - Syntax: `Bot.follow.stop`

- `Bot.attack <player>`
  - What it does: Equips best sword, follows target, and attacks.
  - Syntax: `Bot.attack Steve`

- `Bot.pvp.stop`
  - What it does: Stops current PvP actions.
  - Syntax: `Bot.pvp.stop`

- `Bot.selfdefense`
  - What it does: Toggles self-defense mode on/off.
  - Syntax: `Bot.selfdefense`

- `Bot.selfdefense.on`
  - What it does: Enables self-defense mode.
  - Syntax: `Bot.selfdefense.on`

- `Bot.selfdefense.off`
  - What it does: Disables self-defense mode.
  - Syntax: `Bot.selfdefense.off`

- `Bot.selfdefense.status`
  - What it does: Shows whether self-defense is enabled.
  - Syntax: `Bot.selfdefense.status`

- `Bot.guard.here`
  - What it does: Guards the current position of the command sender.
  - Syntax: `Bot.guard.here`

- `Bot.guard <x> <y> <z>`
  - What it does: Guards a specific coordinate area and attacks nearby valid entities.
  - Syntax: `Bot.guard 100 64 -20`

- `Bot.guard.stop`
  - What it does: Stops guard mode.
  - Syntax: `Bot.guard.stop`

- `Bot.collect <blockType> <number>`
  - What it does: Collects a specific block type repeatedly.
  - Syntax: `Bot.collect oak_log 5`

- `Bot.mine <blockType>`
  - What it does: Starts a continuous mining loop for the given block type.
  - Syntax: `Bot.mine coal_ore`

- `Bot.miner.stop`
  - What it does: Stops the mining loop.
  - Syntax: `Bot.miner.stop`

- `Bot.autoEat`
  - What it does: Enables automatic eating.
  - Syntax: `Bot.autoEat`

- `Bot.autoEat.stop`
  - What it does: Disables automatic eating.
  - Syntax: `Bot.autoEat.stop`

- `Bot.eat`
  - What it does: Makes the bot try to eat immediately.
  - Syntax: `Bot.eat`

- `Bot.empty`
  - What it does: Empties inventory into the nearest chest (within radius).
  - Syntax: `Bot.empty`


