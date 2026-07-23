# Fridge Recipes

A hosted, mobile-friendly app that turns fridge ingredients into appetizing meal ideas while tracking daily calories and macros.

- **Live app:** https://fridge-recipes-app.vercel.app/
- **Current architecture, setup, status, and known issues:** [PROJECT_STATUS.md](PROJECT_STATUS.md)

## Run locally

```bash
npm install
```

Copy `.env.example` to `.env.local` and add the Firebase web configuration. For the local Express AI server, copy `server/.env.example` to `server/.env` and add the Anthropic key.

```bash
npm run dev
```

## Validate

```bash
npm run build
```

```bash
npm run lint
```

## Security

Never commit or share Anthropic API keys, Firebase Admin service-account JSON, `.env.local`, or `server/.env`.
