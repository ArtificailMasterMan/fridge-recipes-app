# Fridge Recipes — Current Project Status

_Last updated: July 23, 2026_

## Product goal

Fridge Recipes helps people turn food already in their fridge or pantry into practical meals while tracking daily calories, protein, carbohydrates, and fat.

The main product workflow is:

1. Take or select a fridge photo.
2. Review and correct the detected ingredients.
3. Request meal ideas that fit the available food and remaining macros.
4. Log food and save recipes to a private account.

**Recipe quality rule:** Do not recommend a meal merely because it satisfies the macros. A recommendation must also be cohesive, plausible to cook, and genuinely appetizing. It is better to return no recommendation than a bad one.

## Links

- Production: https://fridge-recipes-app.vercel.app/
- GitHub: https://github.com/ArtificailMasterMan/fridge-recipes-app

## Current technology

- React 19, TypeScript, and Vite
- Firebase Authentication for email/password app accounts
- Cloud Firestore for private user data
- Vercel for the web app and serverless API
- Firebase Admin in Vercel functions for authenticated database access
- Anthropic Claude for fridge-photo vision and meal generation

## Architecture

The browser uses Firebase Authentication to create/sign in users and obtain a temporary Firebase ID token. Private data requests go to `/api/account-data`, where Vercel verifies the token and reads/writes only under that verified user ID.

Firestore uses the named database `default` in project `fridge-recipes-cd89f`. Data is organized as:

```text
users/{uid}/profile/default
users/{uid}/ingredients/current
users/{uid}/dailyLogs/{YYYY-MM-DD}/entries/{entryId}
users/{uid}/savedRecipes/{recipeId}
```

The browser does not directly write Firestore. This avoids the browser Firestore transport problem found during testing and keeps database access behind the authenticated API.

Fridge images are uploaded temporarily to `/api/scan-fridge`, sent to Claude vision, and not intentionally stored after the request completes.

## Implemented and verified

- Email/password sign-up, sign-in, sign-out, and remembered sessions
- Multiple private user accounts
- Explicit macro-target saving with success/error feedback
- Daily food logging and undo
- Remaining calorie and macro calculations
- Ingredient-list saving
- Generated-recipe saving and removal
- Data persistence after reload
- Cross-browser and desktop/phone synchronization for the same account
- User separation through verified Firebase user IDs
- Responsive mobile interface and phone camera intent
- Authenticated server-side account storage
- Firestore database access through Firebase Admin

## Under active testing

The photo → ingredients → meals workflow is the current focus.

Known issue being addressed:

- The existing mobile input strongly prefers the camera because it uses `capture="environment"` on the only file input. The app needs separate **Take photo** and **Choose from library** controls.
- HEIC/HEIF is not currently supported by the Claude image request. The app should reject it clearly and suggest JPEG/PNG or an iPhone screenshot until conversion is implemented.
- The earlier message “The string did not match the expected pattern” did not provide enough stage-specific detail; scan errors need clearer handling.

## Required Vercel environment variables

Public Firebase web configuration, embedded at build time:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_MEASUREMENT_ID
```

Private server-only values:

```text
ANTHROPIC_API_KEY
FIREBASE_ADMIN_SERVICE_ACCOUNT
```

`FIREBASE_ADMIN_SERVICE_ACCOUNT` must contain the complete one-line Firebase service-account JSON. Never prefix it with `VITE_`.

## Local development

Install dependencies:

```bash
npm install
```

Create `.env.local` from `.env.example` for Firebase browser values. Create `server/.env` from `server/.env.example` for the local Anthropic server.

Run the Vite frontend and local Express API:

```bash
npm run dev
```

Build and lint:

```bash
npm run build
```

```bash
npm run lint
```

The local Express server is an older development path and does not exactly mirror all Vercel account-data behavior. Production integration tests should be run against the Vercel deployment.

## Deployment

1. Commit and push changes to `main`.
2. Vercel automatically builds the GitHub commit.
3. Wait for the newest Production deployment to show **Ready**.
4. Reload the production URL and test the changed behavior.

Vite variables are embedded during the build. Any change to a `VITE_*` variable requires a new deployment.

## Recommended next test

After the separate photo controls are deployed:

1. On iPhone, choose a clear JPEG/PNG fridge photo with 4–6 visible items.
2. Confirm a preview appears and the selected file is identified.
3. Scan it and compare every detected ingredient with the photo.
4. Remove false detections and add missed ingredients.
5. Request a meal.
6. Reject any recommendation that is not appetizing or practical.
7. Save a good recipe and reload to verify persistence.
8. Repeat with poor lighting, clutter, partial labels, and multiple shelves.

## Security

- Never commit or share `.env.local`, `server/.env`, an Anthropic key, or Firebase service-account JSON.
- Firebase web configuration is designed for browser use, but Firestore access still requires authentication and server verification.
- The Firebase Admin credential previously appeared in a screenshot. Rotate/revoke that service-account key before broadly sharing or promoting the app.
- The project currently reports dependency audit advisories. Do not run a forced upgrade without reviewing potential breaking changes.

## Later improvements

- Native HEIC/HEIF conversion before scanning
- Detection confidence and uncertainty notes in the confirmation UI
- Multiple-photo fridge scans
- Better ingredient quantity/condition confirmation
- Stronger recipe response validation
- Persistent, distributed AI rate limiting
- Password reset and account deletion
- Automated integration tests for account isolation and data persistence
- Bundle and performance optimization
