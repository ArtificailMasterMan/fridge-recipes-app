import { useEffect, useMemo, useRef, useState } from 'react'
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { addDoc, collection, deleteDoc, doc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore'
import { auth, database } from './firebase'
import './App.css'

type Macros = { calories: number; protein: number; carbs: number; fat: number }
type Profile = Macros & { name: string }
type FoodEntry = Macros & { id: string; name: string; category: string; serving: string }
type Meal = Macros & { name: string; timeMinutes: number | null; macroFit: string; inventory: string; whyItFits: string; missingIngredients: string[]; steps: string[] }

const emptyMacros: Macros = { calories: 0, protein: 0, carbs: 0, fat: 0 }
const today = () => new Date().toISOString().slice(0, 10)
const number = (value: string) => Math.max(0, Number(value) || 0)
const macroLine = (macros: Macros) => `${Math.round(macros.calories)} kcal · ${Math.round(macros.protein)}P / ${Math.round(macros.carbs)}C / ${Math.round(macros.fat)}F`

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authMode, setAuthMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [profile, setProfile] = useState<Profile>({ name: '', ...emptyMacros })
  const [entries, setEntries] = useState<FoodEntry[]>([])
  const [ingredients, setIngredients] = useState<string[]>([])
  const [dataLoading, setDataLoading] = useState(false)
  const [ingredientInput, setIngredientInput] = useState('')
  const [food, setFood] = useState({ name: '', category: 'Snack', serving: '', ...emptyMacros })
  const [photo, setPhoto] = useState<string | null>(null)
  const [scanState, setScanState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [scanError, setScanError] = useState('')
  const [scanFile, setScanFile] = useState<File | null>(null)
  const [mealRequest, setMealRequest] = useState('A satisfying meal')
  const [meals, setMeals] = useState<Meal[]>([])
  const [mealState, setMealState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [mealError, setMealError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const currentDate = today()

  useEffect(() => onAuthStateChanged(auth, (nextUser) => { setUser(nextUser); setAuthLoading(false) }), [])

  useEffect(() => {
    if (!user) { setProfile({ name: '', ...emptyMacros }); setEntries([]); setIngredients([]); return }
    setDataLoading(true)
    const userDocument = doc(database, 'users', user.uid)
    const profileDocument = doc(userDocument, 'profile', 'default')
    const ingredientsDocument = doc(userDocument, 'ingredients', 'current')
    const entriesQuery = query(collection(userDocument, 'dailyLogs', currentDate, 'entries'), orderBy('createdAt', 'asc'))
    const stopProfile = onSnapshot(profileDocument, (snapshot) => {
      if (snapshot.exists()) setProfile(snapshot.data() as Profile)
      setDataLoading(false)
    })
    const stopIngredients = onSnapshot(ingredientsDocument, (snapshot) => setIngredients(Array.isArray(snapshot.data()?.items) ? snapshot.data()?.items : []))
    const stopEntries = onSnapshot(entriesQuery, (snapshot) => setEntries(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as FoodEntry)))
    return () => { stopProfile(); stopIngredients(); stopEntries() }
  }, [user, currentDate])

  const consumed = useMemo(() => entries.reduce<Macros>((total, entry) => ({ calories: total.calories + entry.calories, protein: total.protein + entry.protein, carbs: total.carbs + entry.carbs, fat: total.fat + entry.fat }), { ...emptyMacros }), [entries])
  const remaining = useMemo<Macros>(() => ({ calories: profile.calories - consumed.calories, protein: profile.protein - consumed.protein, carbs: profile.carbs - consumed.carbs, fat: profile.fat - consumed.fat }), [profile, consumed])
  const targetSet = profile.calories > 0

  async function submitAuth(event: React.FormEvent) {
    event.preventDefault(); setAuthError('')
    try {
      if (authMode === 'sign-in') await signInWithEmailAndPassword(auth, email.trim(), password)
      else await createUserWithEmailAndPassword(auth, email.trim(), password)
    } catch (error) { setAuthError(error instanceof Error ? error.message.replace('Firebase: ', '') : 'Could not continue.') }
  }

  async function saveProfile(nextProfile: Profile) {
    setProfile(nextProfile)
    if (!user) return
    await setDoc(doc(database, 'users', user.uid, 'profile', 'default'), { ...nextProfile, updatedAt: serverTimestamp() }, { merge: true })
  }

  async function saveIngredients(nextIngredients: string[]) {
    setIngredients(nextIngredients)
    if (!user) return
    await setDoc(doc(database, 'users', user.uid, 'ingredients', 'current'), { items: nextIngredients, updatedAt: serverTimestamp() })
  }

  function addIngredient(value = ingredientInput) {
    const clean = value.trim().replace(/\s+/g, ' ')
    if (!clean || ingredients.some((item) => item.toLowerCase() === clean.toLowerCase())) return
    void saveIngredients([...ingredients, clean]); setIngredientInput('')
  }

  async function addFood(event: React.FormEvent) {
    event.preventDefault(); if (!user || !food.name.trim()) return
    await addDoc(collection(database, 'users', user.uid, 'dailyLogs', currentDate, 'entries'), { ...food, name: food.name.trim(), nutritionSource: 'user-provided', createdAt: serverTimestamp() })
    setFood({ name: '', category: 'Snack', serving: '', ...emptyMacros })
  }

  async function removeLast() {
    if (!user || !entries.length) return
    const latest = await getDocs(query(collection(database, 'users', user.uid, 'dailyLogs', currentDate, 'entries'), orderBy('createdAt', 'desc'), limit(1)))
    if (!latest.empty) await deleteDoc(latest.docs[0].ref)
  }

  async function scanPhoto() {
    if (!scanFile || !user) return
    setScanState('loading'); setScanError('')
    const body = new FormData(); body.append('image', scanFile)
    try {
      const token = await user.getIdToken()
      const response = await fetch('/api/scan-fridge', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body })
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Photo scan failed.')
      const detected = data.ingredients.map((item: { name: string }) => item.name)
      await saveIngredients(Array.from(new Set([...ingredients, ...detected]))); setScanState('idle')
    } catch (error) { setScanState('error'); setScanError(error instanceof Error ? error.message : 'Photo scan failed.') }
  }

  async function getMeals() {
    if (!ingredients.length || !user) return
    setMealState('loading'); setMealError(''); setMeals([])
    try {
      const token = await user.getIdToken()
      const response = await fetch('/api/recommend-meals', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ ingredients, remaining: targetSet ? remaining : null, mealRequest }) })
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not make recommendations.')
      setMeals(data.meals); setMealState('idle')
    } catch (error) { setMealState('error'); setMealError(error instanceof Error ? error.message : 'Could not make recommendations.') }
  }

  if (authLoading) return <main className="auth-page"><p>Loading Fridge Recipes…</p></main>
  if (!user) return <main className="auth-page"><section className="auth-card"><a className="brand" href="#top"><span>fridge</span>recipes</a><p className="eyebrow">WELCOME</p><h1>{authMode === 'sign-in' ? 'Welcome back.' : 'Start cooking smarter.'}</h1><p>Save your goals, food log, and ingredient list privately to your account.</p><form onSubmit={submitAuth}><label>Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label><label>Password<input required type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={authMode === 'sign-in' ? 'current-password' : 'new-password'} /></label><button className="primary" type="submit">{authMode === 'sign-in' ? 'Sign in' : 'Create account'}</button></form>{authError && <p className="error">{authError}</p>}<button className="text-button" type="button" onClick={() => { setAuthMode(authMode === 'sign-in' ? 'sign-up' : 'sign-in'); setAuthError('') }}>{authMode === 'sign-in' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}</button></section></main>

  return <main>
    <header className="topbar"><a className="brand" href="#top"><span>fridge</span>recipes</a><div className="account"><span>{user.email}</span><button className="text-button" type="button" onClick={() => void signOut(auth)}>Sign out</button></div></header>
    <section className="hero" id="top"><div><p className="eyebrow">YOUR KITCHEN, SIMPLIFIED</p><h1>What can we make<br /><em>today?</em></h1><p className="intro">Scan your fridge, confirm what you have, and get meal ideas that work with your day.</p></div><div className="hero-art" aria-hidden="true"><div className="sun" /><div className="fridge"><span>FRIDGE</span><i /><b /></div><span className="tomato">●</span><span className="leaf">✦</span></div></section>
    {dataLoading ? <p className="loading">Loading your private kitchen…</p> : <>
    <section className="dashboard"><div className="section-title"><div><p className="eyebrow">TODAY’S BALANCE</p><h2>{targetSet ? 'Your daily targets' : 'Set your daily targets'}</h2></div><span className="date">{new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' }).format(new Date())}</span></div><div className="macro-grid">{(['calories', 'protein', 'carbs', 'fat'] as const).map((key) => <div className="macro-card" key={key}><span>{key === 'calories' ? 'Calories' : key[0].toUpperCase() + key.slice(1)}</span><strong>{targetSet ? Math.round(remaining[key]) : '—'}</strong><small>{targetSet ? `left of ${Math.round(profile[key])}${key === 'calories' ? ' kcal' : 'g'}` : key === 'calories' ? 'kcal target' : 'grams target'}</small></div>)}</div><details className="profile-panel" open={!targetSet}><summary>{targetSet ? `Edit ${profile.name || 'macro'} targets` : 'Set up your targets'}</summary><div className="form-grid profile-form"><label>Profile name<input value={profile.name} onChange={(event) => void saveProfile({ ...profile, name: event.target.value })} placeholder="My goals" /></label>{(['calories', 'protein', 'carbs', 'fat'] as const).map((key) => <label key={key}>{key === 'calories' ? 'Calories' : key[0].toUpperCase() + key.slice(1) + ' (g)'}<input type="number" min="0" value={profile[key] || ''} onChange={(event) => void saveProfile({ ...profile, [key]: number(event.target.value) })} /></label>)}</div><p className="fine-print">Targets and recipe nutrition are planning estimates, not medical advice.</p></details></section>
    <section className="photo-section"><div className="section-title"><div><p className="eyebrow">START WITH A PHOTO</p><h2>What’s in your fridge?</h2></div><span className="step">01</span></div><p className="section-copy">Take a photo or choose one from your camera roll. We’ll identify the food, then you can review every item before it is used.</p><div className="photo-layout"><button className="upload-zone" type="button" onClick={() => inputRef.current?.click()}>{photo ? <img src={photo} alt="Selected fridge" /> : <><span className="camera">⌑</span><strong>Take or choose a photo</strong><small>JPG, PNG, WEBP · up to 8 MB</small></>}</button><input ref={inputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" capture="environment" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; setScanFile(file); setPhoto(URL.createObjectURL(file)); setScanState('idle'); setScanError('') }} /><div className="photo-action"><h3>Photo-first planning</h3><p>The scan does not save your photo. You decide what ingredients are included.</p><button className="primary" type="button" disabled={!scanFile || scanState === 'loading'} onClick={() => void scanPhoto()}>{scanState === 'loading' ? 'Scanning fridge…' : 'Scan photo'}</button>{scanError && <p className="error">{scanError}</p>}<small>Ingredient results are saved to your private account after you confirm them.</small></div></div></section>
    <section className="ingredients-section"><div className="section-title"><div><p className="eyebrow">CONFIRM YOUR INGREDIENTS</p><h2>Your kitchen list</h2></div><span className="step">02</span></div><div className="ingredient-box"><div className="chips">{ingredients.length ? ingredients.map((ingredient) => <button className="chip" type="button" key={ingredient} onClick={() => void saveIngredients(ingredients.filter((item) => item !== ingredient))}>{ingredient}<b>×</b></button>) : <p className="empty">Add ingredients below, or scan a fridge photo first.</p>}</div><div className="add-ingredient"><input value={ingredientInput} onChange={(event) => setIngredientInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addIngredient() } }} placeholder="Add chicken, rice, broccoli…" /><button className="secondary" type="button" onClick={() => addIngredient()}>Add</button></div></div></section>
    <section className="recommend-section"><div className="section-title"><div><p className="eyebrow">MAKE A PLAN</p><h2>Meal ideas for right now</h2></div><span className="step">03</span></div><div className="recommend-control"><input value={mealRequest} onChange={(event) => setMealRequest(event.target.value)} placeholder="What do you want to make?" /><button className="primary" type="button" disabled={!ingredients.length || mealState === 'loading'} onClick={() => void getMeals()}>{mealState === 'loading' ? 'Thinking…' : 'Find meals'}</button></div>{mealError && <p className="error">{mealError}</p>}{meals.length > 0 && <div className="meal-grid">{meals.map((meal) => <article className="meal-card" key={meal.name}><p className="fit">{meal.macroFit}</p><h3>{meal.name}</h3><p className="meal-macros">{macroLine(meal)}</p><p className="meal-detail">{meal.timeMinutes ? `${meal.timeMinutes} min` : 'Quick meal'} · {meal.inventory}</p><p>{meal.whyItFits}</p>{meal.missingIngredients.length > 0 && <p className="missing"><b>Optional:</b> {meal.missingIngredients.join(', ')}</p>}<ol>{meal.steps.map((step) => <li key={step}>{step}</li>)}</ol><small>Nutrition is estimated.</small></article>)}</div>}</section>
    <section className="log-section"><div className="section-title"><div><p className="eyebrow">LOG WHAT YOU EAT</p><h2>Today’s food log</h2></div><span className="step">04</span></div><form onSubmit={(event) => void addFood(event)} className="food-form"><div className="form-grid"><label>Food or meal<input required value={food.name} onChange={(event) => setFood({ ...food, name: event.target.value })} placeholder="Protein shake" /></label><label>Meal<select value={food.category} onChange={(event) => setFood({ ...food, category: event.target.value })}>{['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Other'].map((item) => <option key={item}>{item}</option>)}</select></label><label>Serving<input value={food.serving} onChange={(event) => setFood({ ...food, serving: event.target.value })} placeholder="1 bottle" /></label>{(['calories', 'protein', 'carbs', 'fat'] as const).map((key) => <label key={key}>{key === 'calories' ? 'Calories' : key[0].toUpperCase() + key.slice(1) + ' (g)'}<input type="number" min="0" value={food[key] || ''} onChange={(event) => setFood({ ...food, [key]: number(event.target.value) })} /></label>)}</div><button className="primary" type="submit">Add to today</button></form><div className="log-head"><h3>Today’s entries</h3><button className="text-button" type="button" disabled={!entries.length} onClick={() => void removeLast()}>Undo last entry</button></div>{entries.length ? <div className="entries">{entries.map((entry) => <div className="entry" key={entry.id}><div><strong>{entry.name}</strong><span>{entry.category}{entry.serving ? ` · ${entry.serving}` : ''}</span></div><p>{macroLine(entry)}</p></div>)}</div> : <p className="empty">Nothing logged today yet.</p>}</section>
    </>}</main>
}

export default App
