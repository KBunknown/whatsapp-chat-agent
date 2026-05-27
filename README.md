# WhatsApp Campaign Outreach Agent

Local-first dashboard for importing Excel contacts, sending cautious WhatsApp Web outreach, syncing chats, and auto-replying with Groq-first/Ollama-fallback LLM routing.

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:8787`.

## Expected Excel Headers

- `Full Name (Surname first)`
- `WhatsApp Number`
- `Other Number`
- `Active Email Address`
- `Program of study`
- `Level`
- `Institution`

## WhatsApp Web Flow

1. Start the dashboard.
2. Click `Connect Web`.
3. Scan the QR code in WhatsApp under `Linked devices`.
4. Use `Test Send` with a controlled phone number.
5. Run dry runs before live batches.

If WhatsApp disconnects, use `Reconnect Web`. If WhatsApp says the linked device was removed or authentication fails, use `Reset Session`, then scan a fresh QR. The app never deletes WhatsApp session files unless you explicitly reset the session.

## Render Deployment

Render is the supported hosted deployment target for the full app. The app needs a long-running Node process, SQLite persistence, Puppeteer/Chromium, and WhatsApp Web auth files.

The included `render.yaml` creates a web service with:

- Build command: `npm ci && npm run build`
- Start command: `npm start`
- Health check: `/api/health`
- Persistent disk mounted at `/var/data`

Important Render environment variables:

```bash
DB_PATH=/var/data/campaign.sqlite
WHATSAPP_WEB_AUTH_PATH=/var/data/.wwebjs_auth
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<set in Render>
GROQ_API_KEYS=<set in Render>
```

Leave `CHROME_EXECUTABLE_PATH` empty unless you intentionally install and manage Chrome yourself. Puppeteer can use its installed browser.

## Security

Production requires Basic Auth for the dashboard and API. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in Render before exposing the app publicly. `/api/health` remains open for health checks.

Do not commit:

- `.env`
- WhatsApp Web sessions
- SQLite databases
- imported Excel files
- campaign PDFs
- logs
- build output

## Scripts

```bash
npm run dev        # local dashboard
npm run typecheck  # TypeScript checks
npm test           # unit/integration/dashboard tests
npm run build      # compile server and build dashboard
npm start          # run built server
npm run verify     # typecheck, test, build, audit
```

## GitHub Upload

See [docs/GITHUB_UPLOAD.md](docs/GITHUB_UPLOAD.md) before uploading. The repository should contain code and documentation only.
