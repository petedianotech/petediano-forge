# Petediano Forge

**Describe it. Build it. Ship it.**

Mobile-first AI coding workspace that connects Google's Antigravity Agent API to GitHub.

## Features (Phase 1 – Functional Foundation)

- Secure first-run setup wizard (Gemini API key + GitHub fine-grained PAT)
- Credentials stored only in HttpOnly, Secure, SameSite cookies (never in localStorage / IndexedDB / client JS)
- Real Antigravity agent interactions via official `@google/genai` SDK
- Background execution + polling
- Repository selection from your real GitHub account
- Remote environment with repository source + credential injection for GitHub
- Three execution modes: Ask / Plan / Implement
- IndexedDB conversation history
- Mobile-first responsive UI + basic PWA manifest
- Markdown rendering with syntax highlighting

## Setup

1. Clone and `npm install`
2. `npm run dev`
3. Open the app → complete the setup wizard with your Gemini API key and GitHub PAT
4. Select a repository and start describing tasks

## Environment variables (optional fallback)

```
GEMINI_API_KEY=...
GITHUB_PAT=...
```

Prefer the in-app wizard for single-user use.

## Deploy

Deploy to Vercel. The first-run wizard remains the primary way to supply credentials.

## Security notes

- All secret-dependent calls go through Next.js API routes
- Service worker must not cache `/api/*`
- Never log request bodies containing credentials
