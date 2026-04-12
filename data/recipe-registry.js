const ITEM_ALIASES = {
  craftingtable: 'crafting_table',
  workbench: 'crafting_table',
  planks: 'oak_planks',
  woodplanks: 'oak_planks',
  wood_pickaxe: 'wooden_pickaxe',
  woodpickaxe: 'wooden_pickaxe',
  wood_axe: 'wooden_axe',
  woodaxe: 'wooden_axe',
  wood_shovel: 'wooden_shovel',
  woodshovel: 'wooden_shovel',
  wood_hoe: 'wooden_hoe',
  woodhoe: 'wooden_hoe',
  wood_sword: 'wooden_sword',
  woodsword: 'wooden_sword'
}

const BLOCKED_ITEM_IDS = new Set([])

function canonicalizeItemToken(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

function resolveCraftItemName(input) {
  const canonical = canonicalizeItemToken(input)
  return ITEM_ALIASES[canonical] || canonical
}

module.exports = {
  BLOCKED_ITEM_IDS,
  ITEM_ALIASES,
  canonicalizeItemToken,
  resolveCraftItemName
}