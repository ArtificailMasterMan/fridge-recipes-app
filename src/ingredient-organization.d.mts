export type IngredientGroup = {
  category: string
  ingredients: string[]
}

export const INGREDIENT_CATEGORIES: string[]
export function sortIngredients(ingredients: string[]): string[]
export function ingredientCategory(ingredient: string): string
export function groupIngredients(ingredients: string[]): IngredientGroup[]
