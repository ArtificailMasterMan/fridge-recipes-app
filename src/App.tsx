import { useEffect, useMemo, useRef, useState } from 'react'
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { auth, firebaseConfigurationError } from './firebase'
import dogMascot from './assets/dog-mascot.svg'
import ravensLogo from './assets/ravens-logo.webp'
import './App.css'

type Macros = { calories: number; protein: number; carbs: number; fat: number }
type Profile = Macros & { name: string }
type FoodEntry = Macros & { id: string; name: string; category: string; serving: string }
type Meal = Macros & { name: string; timeMinutes: number | null; macroFit: string; inventory: string; whyItFits: string; missingIngredients: string[]; steps: string[] }
type SavedRecipe = { id: string; name: string; source?: 'generated' | 'imported'; ingredients?: string[]; steps?: string[]; calories?: number; protein?: number; carbs?: number; fat?: number }
type DetectedIngredient = { id: string; name: string; confidence: 'high' | 'medium' | 'low'; note: string; keep: boolean }
type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type AccountData = { profile: Profile | null; ingredients: string[]; entries: FoodEntry[]; savedRecipes: SavedRecipe[] }

const emptyMacros: Macros = { calories: 0, protein: 0, carbs: 0, fat: 0 }
const emptyProfile: Profile = { name: '', ...emptyMacros }
const number = (value: string) => Math.max(0, Number(value) || 0)
const localDateKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
const macroLine = (macros: Partial<Macros>) => `${Math.round(macros.calories || 0)} kcal · ${Math.round(macros.protein || 0)}P / ${Math.round(macros.carbs || 0)}C / ${Math.round(macros.fat || 0)}F`
const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message.replace('Firebase: ', '') : fallback
const cleanIngredient = (value: string) => value.trim().replace(/\s+/g, ' ')
const uniqueIngredients = (values: string[]) => {
  const seen = new Set<string>()
  return values.flatMap((value) => {
    const clean = cleanIngredient(value)
    const key = clean.toLowerCase()
    if (!clean || seen.has(key)) return []
    seen.add(key)
    return [clean]
  })
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authMode, setAuthMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [clock, setClock] = useState(() => new Date())
  const [profile, setProfile] = useState<Profile>(emptyProfile)
  const [profileDraft, setProfileDraft] = useState<Profile>(emptyProfile)
  const [entries, setEntries] = useState<FoodEntry[]>([])
  const [ingredients, setIngredients] = useState<string[]>([])
  const [savedRecipes, setSavedRecipes] = useState<SavedRecipe[]>([])
  const [dataLoading, setDataLoading] = useState(false)
  const [dataError, setDataError] = useState('')
  const [profileState, setProfileState] = useState<SaveState>('idle')
  const [profileError, setProfileError] = useState('')
  const [ingredientState, setIngredientState] = useState<SaveState>('idle')
  const [ingredientError, setIngredientError] = useState('')
  const [foodState, setFoodState] = useState<SaveState>('idle')
  const [foodError, setFoodError] = useState('')
  const [recipeState, setRecipeState] = useState<Record<string, SaveState>>({})
  const [ingredientInput, setIngredientInput] = useState('')
  const [ingredientEditing, setIngredientEditing] = useState(false)
  const [ingredientDraft, setIngredientDraft] = useState<string[]>([])
  const [selectedIngredients, setSelectedIngredients] = useState<Set<number>>(new Set())
  const [scanAdditions, setScanAdditions] = useState<string[]>([])
  const [food, setFood] = useState({ name: '', category: 'Snack', serving: '', ...emptyMacros })
  const [photo, setPhoto] = useState<string | null>(null)
  const [scanMode, setScanMode] = useState<'fridge' | 'pantry'>('fridge')
  const [scanState, setScanState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [scanError, setScanError] = useState('')
  const [scanFile, setScanFile] = useState<File | null>(null)
  const [scanCandidates, setScanCandidates] = useState<DetectedIngredient[]>([])
  const [scanReviewOpen, setScanReviewOpen] = useState(false)
  const [reviewInput, setReviewInput] = useState('')
  const [mealRequest, setMealRequest] = useState('A satisfying meal')
  const [meals, setMeals] = useState<Meal[]>([])
  const [mealState, setMealState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [mealError, setMealError] = useState('')
  const [mealMessage, setMealMessage] = useState('')
  const [recipeUrl, setRecipeUrl] = useState('')
  const [importState, setImportState] = useState<SaveState>('idle')
  const [importError, setImportError] = useState('')
  const libraryInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const currentDate = localDateKey(clock)

  async function accountRequest<T>(method: 'GET' | 'POST', body?: Record<string, unknown>) {
    if (!user) throw new Error('Sign in to save your data.')
    const token = await user.getIdToken()
    const response = await fetch(method === 'GET' ? `/api/account-data?date=${encodeURIComponent(currentDate)}` : '/api/account-data', {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      body: method === 'POST' ? JSON.stringify({ ...body, date: currentDate }) : undefined,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'Could not save account data.')
    return data as T
  }

  async function loadAccountData() {
    if (!user) return
    setDataLoading(true)
    setDataError('')
    try {
      const data = await accountRequest<AccountData>('GET')
      const nextProfile = data.profile || emptyProfile
      setProfile(nextProfile)
      setProfileDraft(nextProfile)
      setIngredients(data.ingredients || [])
      setEntries(data.entries || [])
      setSavedRecipes(data.savedRecipes || [])
    } catch (error) {
      setDataError(errorMessage(error, 'Could not load your account data.'))
    } finally {
      setDataLoading(false)
    }
  }

  useEffect(() => {
    if (!auth) {
      setAuthLoading(false)
      return
    }
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      setAuthLoading(false)
    }, (error) => {
      setAuthError(errorMessage(error, 'Could not check your account.'))
      setAuthLoading(false)
    })
  }, [])

  useEffect(() => {
    const updateClock = () => setClock(new Date())
    const timer = window.setInterval(updateClock, 1_000)
    window.addEventListener('focus', updateClock)
    document.addEventListener('visibilitychange', updateClock)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', updateClock)
      document.removeEventListener('visibilitychange', updateClock)
    }
  }, [])

  useEffect(() => {
    if (!user) {
      setProfile(emptyProfile)
      setProfileDraft(emptyProfile)
      setEntries([])
      setIngredients([])
      setSavedRecipes([])
      setScanReviewOpen(false)
      setScanAdditions([])
      return
    }
    void loadAccountData()
    // Account data reloads when the signed-in user or local calendar day changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, currentDate])

  const consumed = useMemo(() => entries.reduce<Macros>((total, entry) => ({
    calories: total.calories + entry.calories,
    protein: total.protein + entry.protein,
    carbs: total.carbs + entry.carbs,
    fat: total.fat + entry.fat,
  }), { ...emptyMacros }), [entries])
  const remaining = useMemo<Macros>(() => ({
    calories: profile.calories - consumed.calories,
    protein: profile.protein - consumed.protein,
    carbs: profile.carbs - consumed.carbs,
    fat: profile.fat - consumed.fat,
  }), [profile, consumed])
  const targetSet = profile.calories > 0

  async function submitAuth(event: React.FormEvent) {
    event.preventDefault()
    setAuthError('')
    if (!auth) {
      setAuthError(firebaseConfigurationError || 'Firebase is unavailable.')
      return
    }
    try {
      if (authMode === 'sign-in') await signInWithEmailAndPassword(auth, email.trim(), password)
      else await createUserWithEmailAndPassword(auth, email.trim(), password)
    } catch (error) {
      setAuthError(errorMessage(error, 'Could not continue.'))
    }
  }

  async function saveProfile() {
    setProfileState('saving')
    setProfileError('')
    try {
      await accountRequest('POST', { action: 'save-profile', profile: profileDraft })
      await loadAccountData()
      setProfileState('saved')
    } catch (error) {
      setProfileState('error')
      setProfileError(errorMessage(error, 'Could not save targets.'))
    }
  }

  async function saveIngredients(items: string[]) {
    setIngredientState('saving')
    setIngredientError('')
    try {
      await accountRequest('POST', { action: 'save-ingredients', items: uniqueIngredients(items) })
      await loadAccountData()
      setIngredientState('saved')
      return true
    } catch (error) {
      setIngredientState('error')
      setIngredientError(errorMessage(error, 'Could not save ingredients.'))
      return false
    }
  }

  async function addIngredient(value = ingredientInput) {
    const clean = cleanIngredient(value)
    if (!clean || ingredients.some((item) => item.toLowerCase() === clean.toLowerCase())) return
    if (await saveIngredients([...ingredients, clean])) setIngredientInput('')
  }

  function startIngredientEditing() {
    setIngredientDraft([...ingredients])
    setSelectedIngredients(new Set())
    setIngredientEditing(true)
    setIngredientState('idle')
  }

  function toggleIngredientSelection(index: number) {
    setSelectedIngredients((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  function deleteSelectedIngredients() {
    setIngredientDraft((current) => current.filter((_, index) => !selectedIngredients.has(index)))
    setSelectedIngredients(new Set())
  }

  async function confirmIngredientEdits() {
    if (await saveIngredients(ingredientDraft)) {
      setIngredientEditing(false)
      setSelectedIngredients(new Set())
      setScanAdditions([])
    }
  }

  async function undoScanAdditions() {
    const additions = new Set(scanAdditions.map((item) => item.toLowerCase()))
    if (await saveIngredients(ingredients.filter((item) => !additions.has(item.toLowerCase())))) setScanAdditions([])
  }

  async function addFood(event: React.FormEvent) {
    event.preventDefault()
    if (!food.name.trim()) return
    setFoodState('saving')
    setFoodError('')
    try {
      await accountRequest('POST', { action: 'add-food', food })
      await loadAccountData()
      setFood({ name: '', category: 'Snack', serving: '', ...emptyMacros })
      setFoodState('saved')
    } catch (error) {
      setFoodState('error')
      setFoodError(errorMessage(error, 'Could not save food log.'))
    }
  }

  async function removeLast() {
    if (!entries.length) return
    setFoodState('saving')
    setFoodError('')
    try {
      await accountRequest('POST', { action: 'remove-last-food' })
      await loadAccountData()
      setFoodState('saved')
    } catch (error) {
      setFoodState('error')
      setFoodError(errorMessage(error, 'Could not remove the food entry.'))
    }
  }

  async function saveRecipe(meal: Meal) {
    setRecipeState((current) => ({ ...current, [meal.name]: 'saving' }))
    try {
      await accountRequest('POST', { action: 'save-recipe', recipe: meal })
      await loadAccountData()
      setRecipeState((current) => ({ ...current, [meal.name]: 'saved' }))
    } catch (error) {
      setRecipeState((current) => ({ ...current, [meal.name]: 'error' }))
      setDataError(`Could not save recipe: ${errorMessage(error, 'Account storage was unavailable.')}`)
    }
  }

  async function importRecipe(event: React.FormEvent) {
    event.preventDefault()
    if (!recipeUrl.trim() || !user) return
    setImportState('saving')
    setImportError('')
    try {
      const token = await user.getIdToken()
      const response = await fetch('/api/import-recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url: recipeUrl.trim() }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not import that recipe.')
      await loadAccountData()
      setRecipeUrl('')
      setImportState('saved')
    } catch (error) {
      setImportState('error')
      setImportError(errorMessage(error, 'Could not import that recipe.'))
    }
  }

  async function removeRecipe(recipeId: string) {
    try {
      await accountRequest('POST', { action: 'remove-recipe', recipeId })
      await loadAccountData()
    } catch (error) {
      setDataError(`Could not remove recipe: ${errorMessage(error, 'Account storage was unavailable.')}`)
    }
  }

  function selectPhoto(file?: File) {
    setScanError('')
    setScanState('idle')
    if (!file) return
    if (file.size > 8 * 1024 * 1024) {
      setScanFile(null)
      setScanState('error')
      setScanError('Choose an image smaller than 8 MB.')
      return
    }
    if (['image/heic', 'image/heif'].includes(file.type) || /\.hei[cf]$/i.test(file.name)) {
      setScanFile(null)
      setScanState('error')
      setScanError('HEIC photos are not supported yet. Choose a JPEG/PNG or upload an iPhone screenshot.')
      return
    }
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setScanFile(null)
      setScanState('error')
      setScanError('Choose a JPG, PNG, WEBP, or GIF image.')
      return
    }
    setScanFile(file)
    setPhoto((current) => {
      if (current) URL.revokeObjectURL(current)
      return URL.createObjectURL(file)
    })
  }

  async function scanPhoto() {
    if (!scanFile || !user) return
    setScanState('loading')
    setScanError('')
    const body = new FormData()
    body.append('image', scanFile)
    body.append('mode', scanMode)
    try {
      const token = await user.getIdToken()
      const response = await fetch('/api/scan-fridge', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Photo scan failed.')
      const candidates = Array.isArray(data.ingredients) ? data.ingredients.map((item: Partial<DetectedIngredient>, index: number) => ({
        id: `${index}-${item.name || 'ingredient'}`,
        name: typeof item.name === 'string' ? item.name : '',
        confidence: ['high', 'medium', 'low'].includes(item.confidence || '') ? item.confidence as DetectedIngredient['confidence'] : 'medium',
        note: typeof item.note === 'string' ? item.note : '',
        keep: true,
      })).filter((item: DetectedIngredient) => item.name) : []
      setScanCandidates(candidates)
      setReviewInput('')
      setScanReviewOpen(true)
      setScanState('idle')
    } catch (error) {
      setScanState('error')
      setScanError(errorMessage(error, 'Photo scan failed.'))
    }
  }

  function addReviewIngredient() {
    const name = cleanIngredient(reviewInput)
    if (!name) return
    setScanCandidates((current) => [...current, { id: `manual-${Date.now()}`, name, confidence: 'high', note: 'Added by you', keep: true }])
    setReviewInput('')
  }

  async function confirmScanReview() {
    const reviewed = uniqueIngredients(scanCandidates.filter((item) => item.keep).map((item) => item.name))
    const existing = new Set(ingredients.map((item) => item.toLowerCase()))
    const additions = reviewed.filter((item) => !existing.has(item.toLowerCase()))
    if (await saveIngredients([...ingredients, ...reviewed])) {
      setScanAdditions(additions)
      setScanReviewOpen(false)
      setScanCandidates([])
    }
  }

  async function getMeals() {
    if (!ingredients.length || !user) return
    setMealState('loading')
    setMealError('')
    setMealMessage('')
    setMeals([])
    try {
      const token = await user.getIdToken()
      const response = await fetch('/api/recommend-meals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ingredients, remaining: targetSet ? remaining : null, mealRequest, currentDate }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not make recommendations.')
      const nextMeals = Array.isArray(data.meals) ? data.meals : null
      if (!nextMeals) throw new Error('Meal recommendations did not complete correctly. Please try again.')
      setMeals(nextMeals)
      setMealMessage(!nextMeals.length && typeof data.message === 'string' ? data.message : '')
      setMealState('idle')
    } catch (error) {
      setMealState('error')
      setMealError(errorMessage(error, 'Could not make recommendations.'))
    }
  }

  if (firebaseConfigurationError) return <main className="auth-page"><section className="auth-card"><a className="brand" href="#top"><span>fridge</span>recipes</a><h1>Setup needed.</h1><p>This deployment cannot connect to account data yet.</p><p className="error">{firebaseConfigurationError} Add the variables to Vercel’s Production environment, then redeploy.</p></section></main>
  if (authLoading) return <main className="auth-page"><p>Loading Fridge Recipes…</p></main>
  if (!user) return <main className="auth-page"><section className="auth-card"><a className="brand" href="#top"><span>fridge</span>recipes</a><p className="eyebrow">WELCOME</p><h1>{authMode === 'sign-in' ? 'Welcome back.' : 'Start cooking smarter.'}</h1><p>Save your goals, food log, ingredient list, and recipes privately to your account.</p><form onSubmit={submitAuth}><label>Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label><label>Password<input required type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={authMode === 'sign-in' ? 'current-password' : 'new-password'} /></label><button className="primary" type="submit">{authMode === 'sign-in' ? 'Sign in' : 'Create account'}</button></form>{authError && <p className="error">{authError}</p>}<button className="text-button" type="button" onClick={() => { setAuthMode(authMode === 'sign-in' ? 'sign-up' : 'sign-in'); setAuthError('') }}>{authMode === 'sign-in' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}</button></section></main>

  return <main>
    <header className="topbar"><a className="brand" href="#top"><span>fridge</span>recipes</a><div className="account"><span>{user.email}</span><button className="text-button" type="button" onClick={() => auth && void signOut(auth)}>Sign out</button></div></header>
    <section className="hero" id="top">
      <div className="hero-copy">
        <p className="eyebrow">YOUR KITCHEN, SIMPLIFIED</p>
        <h1>What can we make<br /><em>today?</em></h1>
        <p className="intro">Scan your fridge, confirm what you have, and get meal ideas that work with your day.</p>
        <div className="hero-actions">
          <a className="hero-cta" href="#scan-your-kitchen">Scan your kitchen <span aria-hidden="true">↘</span></a>
          <p className="hero-trust"><span aria-hidden="true">✓</span> You approve every ingredient first.</p>
        </div>
        <ol className="hero-flow" aria-label="How Fridge Recipes works">
          <li><span>01</span><strong>Scan</strong><small>Fridge or pantry</small></li>
          <li><span>02</span><strong>Confirm</strong><small>Keep what’s right</small></li>
          <li><span>03</span><strong>Cook</strong><small>Get a meal worth making</small></li>
        </ol>
      </div>
      <div className="hero-art" aria-hidden="true">
        <div className="hero-grid" />
        <div className="sun" />
        <div className="kitchen-counter" />
        <div className="kitchen-ticket">
          <span>IN YOUR KITCHEN</span>
          <strong>{dataLoading ? 'Checking your shelves…' : ingredients.length ? `${ingredients.length} ingredient${ingredients.length === 1 ? '' : 's'} ready` : 'Fridge + pantry ready'}</strong>
          <small>{ingredients.length ? 'Ready for a good idea' : 'Start with one clear photo'}</small>
        </div>
        <div className="quality-note"><span>HOUSE RULE</span><strong>Only ideas<br />worth eating.</strong></div>
        <div className="fridge">
          <span>FRIDGE</span><i /><b />
          <div className="fridge-scan"><span /></div>
          <div className="orioles-sticker">O’s</div>
          <img className="ravens-sticker" src={ravensLogo} alt="" />
        </div>
        <img className="dog-mascot" src={dogMascot} alt="" />
        <div className="zeke-label"><strong>ZEKE</strong><span>KITCHEN SCOUT</span></div>
        <span className="tomato" />
        <span className="leaf">✦</span>
      </div>
    </section>
    {dataError && <p className="error save-notice">{dataError}</p>}
    {dataLoading ? <p className="loading">Loading your private kitchen…</p> : <>
      <section className="dashboard"><div className="section-title"><div><p className="eyebrow">TODAY’S BALANCE</p><h2>{targetSet ? 'Your daily targets' : 'Set your daily targets'}</h2></div><div className="clock"><strong>{new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(clock)}</strong><span>{new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(clock)}</span></div></div><div className="macro-grid">{(['calories', 'protein', 'carbs', 'fat'] as const).map((key) => <div className="macro-card" key={key}><span>{key === 'calories' ? 'Calories' : key[0].toUpperCase() + key.slice(1)}</span><strong>{targetSet ? Math.round(remaining[key]) : '—'}</strong><small>{targetSet ? `left of ${Math.round(profile[key])}${key === 'calories' ? ' kcal' : 'g'}` : key === 'calories' ? 'kcal target' : 'grams target'}</small></div>)}</div><details className="profile-panel" open={!targetSet}><summary>{targetSet ? `Edit ${profile.name || 'macro'} targets` : 'Set up your targets'}</summary><div className="form-grid profile-form"><label>Profile name<input value={profileDraft.name} onChange={(event) => { setProfileDraft({ ...profileDraft, name: event.target.value }); setProfileState('idle') }} placeholder="My goals" /></label>{(['calories', 'protein', 'carbs', 'fat'] as const).map((key) => <label key={key}>{key === 'calories' ? 'Calories' : key[0].toUpperCase() + key.slice(1) + ' (g)'}<input type="number" min="0" value={profileDraft[key] || ''} onChange={(event) => { setProfileDraft({ ...profileDraft, [key]: number(event.target.value) }); setProfileState('idle') }} /></label>)}</div><div className="save-row"><button className="primary" type="button" disabled={profileState === 'saving'} onClick={() => void saveProfile()}>{profileState === 'saving' ? 'Saving targets…' : 'Save targets'}</button>{profileState === 'saved' && <span className="saved">Targets saved to your account.</span>}</div>{profileError && <p className="error">{profileError}</p>}<p className="fine-print">Daily food totals start fresh at local midnight. Your saved targets stay in place. Nutrition is a planning estimate, not medical advice.</p></details></section>

      <section className="photo-section" id="scan-your-kitchen"><div className="section-title"><div><p className="eyebrow">START WITH A PHOTO</p><h2>What’s in your kitchen?</h2></div><span className="step">01</span></div><p className="section-copy">Take a photo or choose one from your camera roll. Review every result before anything is saved.</p><div className="scan-mode" role="group" aria-label="Photo location"><button type="button" className={scanMode === 'fridge' ? 'active' : ''} onClick={() => setScanMode('fridge')}>Fridge</button><button type="button" className={scanMode === 'pantry' ? 'active' : ''} onClick={() => setScanMode('pantry')}>Pantry</button></div><div className="photo-layout"><div className="upload-zone photo-picker">{photo ? <img src={photo} alt={`Selected ${scanMode}`} /> : <><span className="camera">⌑</span><strong>Add a {scanMode} photo</strong><small>JPG, PNG, WEBP · up to 8 MB</small></>}<div className="photo-buttons"><button className="secondary" type="button" onClick={() => cameraInputRef.current?.click()}>Take photo</button><button className="secondary" type="button" onClick={() => libraryInputRef.current?.click()}>Choose from library</button></div>{scanFile && <small className="selected-file">Selected: {scanFile.name}</small>}</div><input ref={cameraInputRef} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={(event) => { selectPhoto(event.target.files?.[0]); event.target.value = '' }} /><input ref={libraryInputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif" onChange={(event) => { selectPhoto(event.target.files?.[0]); event.target.value = '' }} /><div className="photo-action"><h3>{scanMode === 'pantry' ? 'Shelf-by-shelf scan' : 'Photo-first planning'}</h3><p>{scanMode === 'pantry' ? 'We inspect visible cans, jars, boxes, bags, and labels without guessing hidden contents.' : 'The scan does not save your photo. You decide what ingredients are included.'}</p><button className="primary" type="button" disabled={!scanFile || scanState === 'loading'} onClick={() => void scanPhoto()}>{scanState === 'loading' ? `Scanning ${scanMode}…` : 'Scan photo'}</button>{scanError && <p className="error">{scanError}</p>}<small>Nothing is added to your private kitchen until you confirm it.</small></div></div></section>

      <section className="ingredients-section"><div className="section-title"><div><p className="eyebrow">CONFIRM YOUR INGREDIENTS</p><h2>Your kitchen list</h2></div><span className="step">02</span></div><div className="ingredient-box">{ingredientEditing ? <><div className="bulk-toolbar"><button className="secondary" type="button" onClick={() => setSelectedIngredients(selectedIngredients.size === ingredientDraft.length ? new Set() : new Set(ingredientDraft.map((_, index) => index)))}>{selectedIngredients.size === ingredientDraft.length && ingredientDraft.length ? 'Clear selection' : 'Select all'}</button><button className="danger-button" type="button" disabled={!selectedIngredients.size} onClick={deleteSelectedIngredients}>Delete selected ({selectedIngredients.size})</button></div><div className="ingredient-editor">{ingredientDraft.map((ingredient, index) => <div className="ingredient-row" key={index}><input className="row-check" type="checkbox" aria-label={`Select ${ingredient || `ingredient ${index + 1}`}`} checked={selectedIngredients.has(index)} onChange={() => toggleIngredientSelection(index)} /><input aria-label={`Edit ingredient ${index + 1}`} value={ingredient} onChange={(event) => setIngredientDraft((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /></div>)}</div><button className="text-button add-row" type="button" onClick={() => setIngredientDraft((current) => [...current, ''])}>+ Add another row</button><div className="save-row"><button className="primary" type="button" disabled={ingredientState === 'saving'} onClick={() => void confirmIngredientEdits()}>{ingredientState === 'saving' ? 'Saving changes…' : 'Save changes'}</button><button className="secondary" type="button" disabled={ingredientState === 'saving'} onClick={() => { setIngredientEditing(false); setSelectedIngredients(new Set()) }}>Cancel</button></div></> : <><div className="ingredient-head"><div className="chips">{ingredients.length ? ingredients.map((ingredient) => <span className="chip" key={ingredient}>{ingredient}</span>) : <p className="empty">Add ingredients below, or scan a fridge or pantry photo first.</p>}</div><button className="text-button" type="button" onClick={startIngredientEditing}>Edit list</button></div><div className="add-ingredient"><input value={ingredientInput} onChange={(event) => setIngredientInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addIngredient() } }} placeholder="Add chicken, rice, broccoli…" /><button className="secondary" type="button" disabled={ingredientState === 'saving'} onClick={() => void addIngredient()}>{ingredientState === 'saving' ? 'Saving…' : 'Add'}</button></div>{scanAdditions.length > 0 && <button className="text-button undo-scan" type="button" disabled={ingredientState === 'saving'} onClick={() => void undoScanAdditions()}>Undo last scan additions ({scanAdditions.length})</button>}</>}{ingredientState === 'saved' && <p className="saved">Kitchen list saved.</p>}{ingredientError && <p className="error">{ingredientError}</p>}</div></section>

      <section className="recommend-section"><div className="section-title"><div><p className="eyebrow">MAKE A PLAN</p><h2>Meal ideas for right now</h2></div><span className="step">03</span></div><div className="recommend-control"><input value={mealRequest} onChange={(event) => setMealRequest(event.target.value)} placeholder="What do you want to make?" /><button className="primary" type="button" disabled={!ingredients.length || mealState === 'loading'} onClick={() => void getMeals()}>{mealState === 'loading' ? 'Thinking…' : 'Find meals'}</button></div>{mealError && <p className="error">{mealError}</p>}{mealMessage && <p className="meal-message" role="status">{mealMessage}</p>}{meals.length > 0 && <div className="meal-grid">{meals.map((meal) => <article className="meal-card" key={meal.name}><p className="fit">{meal.macroFit}</p><h3>{meal.name}</h3><p className="meal-macros">{macroLine(meal)}</p><p className="meal-detail">{meal.timeMinutes ? `${meal.timeMinutes} min` : 'Quick meal'} · {meal.inventory}</p><p>{meal.whyItFits}</p>{meal.missingIngredients.length > 0 && <p className="missing"><b>Optional:</b> {meal.missingIngredients.join(', ')}</p>}<ol>{meal.steps.map((step) => <li key={step}>{step}</li>)}</ol><button className="secondary recipe-save" type="button" disabled={recipeState[meal.name] === 'saving' || recipeState[meal.name] === 'saved'} onClick={() => void saveRecipe(meal)}>{recipeState[meal.name] === 'saving' ? 'Saving recipe…' : recipeState[meal.name] === 'saved' ? 'Recipe saved' : 'Save recipe'}</button><small>Nutrition is estimated.</small></article>)}</div>}</section>

      <section className="saved-section"><div className="section-title"><div><p className="eyebrow">KEEP THE GOOD ONES</p><h2>Saved recipes</h2></div><span className="step">04</span></div><form className="recipe-import" onSubmit={(event) => void importRecipe(event)}><div><h3>Import from a recipe website</h3><p>We save only the recipe name, ingredients, and instructions—not the surrounding article.</p></div><div className="import-control"><input type="url" required value={recipeUrl} onChange={(event) => { setRecipeUrl(event.target.value); setImportState('idle') }} placeholder="https://example.com/recipe" /><button className="secondary" type="submit" disabled={importState === 'saving'}>{importState === 'saving' ? 'Importing…' : 'Import recipe'}</button></div>{importState === 'saved' && <p className="saved">Recipe imported to your account.</p>}{importError && <p className="error">{importError}</p>}</form>{savedRecipes.length ? <div className="saved-recipes">{savedRecipes.map((recipe) => <article className="saved-recipe" key={recipe.id}><div className="saved-recipe-head"><div><p className="recipe-source">{recipe.source === 'imported' ? 'IMPORTED RECIPE' : 'SAVED MEAL'}</p><h3>{recipe.name}</h3>{recipe.source !== 'imported' && <p>{macroLine(recipe)}</p>}</div><button className="text-button" type="button" onClick={() => void removeRecipe(recipe.id)}>Remove</button></div><details><summary>View recipe</summary>{recipe.ingredients?.length ? <><h4>Ingredients</h4><ul>{recipe.ingredients.map((ingredient) => <li key={ingredient}>{ingredient}</li>)}</ul></> : null}{recipe.steps?.length ? <><h4>Instructions</h4><ol>{recipe.steps.map((step) => <li key={step}>{step}</li>)}</ol></> : <p className="empty">This older saved meal has no stored instructions.</p>}</details></article>)}</div> : <p className="empty">Save a meal idea or import a recipe you want to make again.</p>}</section>

      <section className="log-section"><div className="section-title"><div><p className="eyebrow">LOG WHAT YOU EAT</p><h2>Today’s food log</h2></div><span className="step">05</span></div><form onSubmit={(event) => void addFood(event)} className="food-form"><div className="form-grid"><label>Food or meal<input required value={food.name} onChange={(event) => setFood({ ...food, name: event.target.value })} placeholder="Protein shake" /></label><label>Meal<select value={food.category} onChange={(event) => setFood({ ...food, category: event.target.value })}>{['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Other'].map((item) => <option key={item}>{item}</option>)}</select></label><label>Serving<input value={food.serving} onChange={(event) => setFood({ ...food, serving: event.target.value })} placeholder="1 bottle" /></label>{(['calories', 'protein', 'carbs', 'fat'] as const).map((key) => <label key={key}>{key === 'calories' ? 'Calories' : key[0].toUpperCase() + key.slice(1) + ' (g)'}<input type="number" min="0" value={food[key] || ''} onChange={(event) => setFood({ ...food, [key]: number(event.target.value) })} /></label>)}</div><div className="save-row"><button className="primary" type="submit" disabled={foodState === 'saving'}>{foodState === 'saving' ? 'Saving entry…' : 'Add to today'}</button>{foodState === 'saved' && <span className="saved">Food log saved.</span>}</div>{foodError && <p className="error">{foodError}</p>}</form><div className="log-head"><h3>Today’s entries</h3><button className="text-button" type="button" disabled={!entries.length || foodState === 'saving'} onClick={() => void removeLast()}>Undo last entry</button></div>{entries.length ? <div className="entries">{entries.map((entry) => <div className="entry" key={entry.id}><div><strong>{entry.name}</strong><span>{entry.category}{entry.serving ? ` · ${entry.serving}` : ''}</span></div><p>{macroLine(entry)}</p></div>)}</div> : <p className="empty">Nothing logged for {new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' }).format(clock)} yet.</p>}</section>
    </>}

    {scanReviewOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && ingredientState !== 'saving') setScanReviewOpen(false) }}><section className="scan-review" role="dialog" aria-modal="true" aria-labelledby="scan-review-title"><div className="review-head"><div><p className="eyebrow">REVIEW BEFORE SAVING</p><h2 id="scan-review-title">What should we keep?</h2></div><button className="dialog-close" type="button" aria-label="Close review" disabled={ingredientState === 'saving'} onClick={() => setScanReviewOpen(false)}>×</button></div><p className="section-copy">Uncheck incorrect results, rename unclear items, and add anything the {scanMode} scan missed.</p><div className="review-list">{scanCandidates.length ? scanCandidates.map((candidate) => <div className={`review-item ${candidate.keep ? '' : 'removed'}`} key={candidate.id}><input className="row-check" type="checkbox" checked={candidate.keep} aria-label={`Keep ${candidate.name}`} onChange={() => setScanCandidates((current) => current.map((item) => item.id === candidate.id ? { ...item, keep: !item.keep } : item))} /><div><input value={candidate.name} disabled={!candidate.keep} aria-label="Detected ingredient name" onChange={(event) => setScanCandidates((current) => current.map((item) => item.id === candidate.id ? { ...item, name: event.target.value } : item))} /><div className="candidate-meta"><span className={`confidence ${candidate.confidence}`}>{candidate.confidence} confidence</span>{candidate.note && <span>{candidate.note}</span>}</div></div></div>) : <p className="empty">No clear food was detected. Add any visible ingredients below.</p>}</div><div className="review-add"><input value={reviewInput} onChange={(event) => setReviewInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addReviewIngredient() } }} placeholder="Add a missed ingredient…" /><button className="secondary" type="button" onClick={addReviewIngredient}>Add</button></div><div className="review-actions"><button className="primary" type="button" disabled={ingredientState === 'saving'} onClick={() => void confirmScanReview()}>{ingredientState === 'saving' ? 'Saving kitchen…' : `Add ${scanCandidates.filter((item) => item.keep && cleanIngredient(item.name)).length} to kitchen`}</button><button className="secondary" type="button" disabled={ingredientState === 'saving'} onClick={() => setScanReviewOpen(false)}>Cancel</button></div>{ingredientError && <p className="error">{ingredientError}</p>}</section></div>}
  </main>
}

export default App
