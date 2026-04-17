const test = require('node:test')
const assert = require('node:assert/strict')

const {
  canonicalizeItemToken,
  resolveCraftItemName,
  FURNACE_BLOCKS_BY_STATION,
  FURNACE_RECIPES_BY_OUTPUT
} = require('../data/recipe-registry')

test('canonicalizeItemToken normalizes separators and case', () => {
  assert.equal(canonicalizeItemToken('  Wood Pickaxe  '), 'wood_pickaxe')
  assert.equal(canonicalizeItemToken('IRON-INGOT'), 'iron_ingot')
})

test('resolveCraftItemName resolves aliases and keeps canonical names', () => {
  assert.equal(resolveCraftItemName('workbench'), 'crafting_table')
  assert.equal(resolveCraftItemName('woodpickaxe'), 'wooden_pickaxe')
  assert.equal(resolveCraftItemName('oak_planks'), 'oak_planks')
})

test('furnace registries expose expected stations and outputs', () => {
  assert.deepEqual(FURNACE_BLOCKS_BY_STATION.any, ['furnace', 'smoker', 'blast_furnace'])
  assert.ok(Array.isArray(FURNACE_RECIPES_BY_OUTPUT.iron_ingot))
  assert.ok(FURNACE_RECIPES_BY_OUTPUT.iron_ingot.length > 0)
})
