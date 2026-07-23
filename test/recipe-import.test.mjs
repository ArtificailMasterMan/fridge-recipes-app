import test from 'node:test'
import assert from 'node:assert/strict'
import { isPublicAddress, parseRecipeDocument, validateRecipeUrl } from '../api/_recipe-import.mjs'

test('extracts a complete Recipe JSON-LD object', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'Recipe',
    name: 'Crispy Chicken &amp; Rice',
    recipeIngredient: ['1 chicken breast', '2 cups rice'],
    recipeInstructions: [{ '@type': 'HowToStep', text: '<b>Sear</b> the chicken.' }, { '@type': 'HowToStep', text: 'Serve over rice.' }],
  })}</script>`
  assert.deepEqual(parseRecipeDocument(html), {
    name: 'Crispy Chicken & Rice',
    ingredients: ['1 chicken breast', '2 cups rice'],
    steps: ['Sear the chicken.', 'Serve over rice.'],
    source: 'imported',
  })
})

test('finds a Recipe nested in an array and @graph', () => {
  const html = `<script type='application/ld+json'>${JSON.stringify([{ '@context': 'https://schema.org' }, {
    '@graph': [{ '@type': 'WebPage', name: 'Article' }, {
      '@type': ['Thing', 'Recipe'],
      name: 'Pantry Pasta',
      recipeIngredient: ['pasta', 'tomatoes'],
      recipeInstructions: [{ '@type': 'HowToSection', itemListElement: ['Boil pasta.', { text: 'Add tomatoes.' }] }],
    }],
  }])}</script>`
  const recipe = parseRecipeDocument(html)
  assert.equal(recipe.name, 'Pantry Pasta')
  assert.deepEqual(recipe.steps, ['Boil pasta.', 'Add tomatoes.'])
})

test('ignores broken JSON-LD and rejects incomplete recipes', () => {
  const html = `<script type="application/ld+json">not json</script><script type="application/ld+json">{"@type":"Recipe","name":"No directions","recipeIngredient":["rice"]}</script>`
  assert.throws(() => parseRecipeDocument(html), /No complete structured recipe/)
})

test('rejects local and private recipe destinations', () => {
  for (const url of [
    'http://localhost/recipe',
    'http://127.0.0.1/recipe',
    'http://10.0.0.8/recipe',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/recipe',
    'http://[::ffff:192.168.1.2]/recipe',
    'file:///etc/passwd',
    'https://intranet/recipe',
  ]) assert.throws(() => validateRecipeUrl(url))
})

test('accepts normal public website and address shapes', () => {
  assert.equal(validateRecipeUrl('https://www.example.com/recipe').hostname, 'www.example.com')
  assert.equal(isPublicAddress('8.8.8.8'), true)
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true)
  assert.equal(isPublicAddress('192.168.1.4'), false)
  assert.equal(isPublicAddress('fe80::1'), false)
})
