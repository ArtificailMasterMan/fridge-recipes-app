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
- Live local date and clock display
- Automatic local-midnight rollover to a new daily food log while preserving prior days
- Daily food logging and undo
- Remaining calorie and macro calculations
- Ingredient-list saving
- Bulk ingredient rename, selection, deletion, and cancellation before saving
- Separate fridge and pantry photo modes
- Pantry-aware shelf, can, jar, box, bag, and visible-label scan guidance
- Review-before-save photo detections with keep/remove, rename, add, confidence, and uncertainty controls
- Undo for the most recently confirmed scan additions
- Generated-recipe saving and removal
- Authenticated website recipe import using structured Recipe JSON-LD
- Imported recipe storage limited to name, ingredients, and instructions
- URL-import protections for private/internal destinations, redirects, timeouts, content type, and response size
- Data persistence after reload
- Cross-browser and desktop/phone synchronization for the same account
- User separation through verified Firebase user IDs
- Responsive mobile interface and phone camera intent
- Authenticated server-side account storage
- Firestore database access through Firebase Admin
- Black Lab/bulldog mascot with a patchy white chest and mismatched white paws

## Current production test focus

The photo → review → ingredients → meals workflow and website recipe imports should receive final phone testing after deployment.

Current boundaries:

- HEIC/HEIF is not supported by the Claude image request. The app rejects it clearly and suggests JPEG/PNG or an iPhone screenshot until conversion is implemented.
- Website imports require a page that publishes a complete Schema.org `Recipe` JSON-LD object. The importer returns an error instead of inventing missing recipe content.
- The clock uses the device’s local calendar day. At local midnight, the app loads a new empty daily log; macro targets, kitchen ingredients, recipes, and prior dated logs remain saved.

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

After the new build is deployed:

1. On iPhone, select **Pantry** and choose a clear JPEG/PNG photo with several visible cans, jars, boxes, and bags.
2. Confirm the scan opens a review prompt and does not change the kitchen list yet.
3. Uncheck a result, rename one, add a missed item, and confirm. Verify only the kept items appear.
4. Use **Undo last scan additions**, then scan and confirm again.
5. Open **Edit list**, select several ingredients, delete them, rename another item, and save once. Reopen edit mode and verify **Cancel** discards unsaved edits.
6. Request a meal and reject any recommendation that is not appetizing, cohesive, and practical.
7. Import a recipe URL from a site with structured recipe data. Verify only its name, ingredients, and instructions are displayed after reload.
8. Verify the live clock shows the phone’s local time. For practical rollover testing, leave the app open across local midnight or simulate a date change in a development browser and confirm the daily food log changes days while targets remain.
9. Check the black dog mascot sits beside the fridge without obscuring the mobile hero.
10. Sign in from another browser or device and confirm the kitchen and recipes sync privately to the same account.

## Security

- Never commit or share `.env.local`, `server/.env`, an Anthropic key, or Firebase service-account JSON.
- Firebase web configuration is designed for browser use, but Firestore access still requires authentication and server verification.
- The Firebase Admin credential previously appeared in a screenshot. Rotate/revoke that service-account key before broadly sharing or promoting the app.
- The project currently reports dependency audit advisories. Do not run a forced upgrade without reviewing potential breaking changes.

## Later improvements

- Native HEIC/HEIF conversion before scanning
- Multiple-photo fridge and pantry scans
- Better ingredient quantity/condition confirmation
- Recipe-import fallback for sites without structured `Recipe` JSON-LD
- Stronger recipe response validation
- Persistent, distributed AI rate limiting
- Password reset and account deletion
- Automated integration tests for account isolation and data persistence
- Bundle and performance optimization
