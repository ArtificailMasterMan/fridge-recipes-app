import test from 'node:test'
import assert from 'node:assert/strict'
import {
  groupIngredients,
  ingredientCategory,
  sortIngredients,
} from '../src/ingredient-organization.mjs'

test('sorts ingredients alphabetically without changing the source array', () => {
  const ingredients = ['rice 10', 'Apple', 'rice 2', 'broccoli']
  assert.deepEqual(sortIngredients(ingredients), ['Apple', 'broccoli', 'rice 2', 'rice 10'])
  assert.deepEqual(ingredients, ['rice 10', 'Apple', 'rice 2', 'broccoli'])
})

test('places representative ingredients into practical categories', () => {
  assert.equal(ingredientCategory('fresh broccoli florets'), 'Produce')
  assert.equal(ingredientCategory('boneless chicken breast'), 'Meat & Seafood')
  assert.equal(ingredientCategory('large eggs'), 'Dairy, Eggs & Alternatives')
  assert.equal(ingredientCategory('brown rice'), 'Grains, Pasta & Baking')
  assert.equal(ingredientCategory('canned corn'), 'Canned & Jarred')
  assert.equal(ingredientCategory('Dijon mustard'), 'Condiments & Cooking Staples')
  assert.equal(ingredientCategory('frozen peas'), 'Frozen Foods')
  assert.equal(ingredientCategory('sparkling water'), 'Snacks & Drinks')
})

test('uses Other for unfamiliar ingredients', () => {
  assert.equal(ingredientCategory('homemade mystery leftovers'), 'Other')
})

test('groups in stable category order and alphabetizes each category', () => {
  assert.deepEqual(groupIngredients([
    'mustard',
    'zucchini',
    'chicken breast',
    'apple',
    'rice',
    'eggs',
    'ketchup',
  ]), [
    { category: 'Produce', ingredients: ['apple', 'zucchini'] },
    { category: 'Meat & Seafood', ingredients: ['chicken breast'] },
    { category: 'Dairy, Eggs & Alternatives', ingredients: ['eggs'] },
    { category: 'Grains, Pasta & Baking', ingredients: ['rice'] },
    { category: 'Condiments & Cooking Staples', ingredients: ['ketchup', 'mustard'] },
  ])
})
