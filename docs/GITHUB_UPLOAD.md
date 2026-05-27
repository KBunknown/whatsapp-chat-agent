# GitHub Upload Checklist

This repository should be uploaded as code only.

## Before Upload

Run:

```bash
npm run verify
```

Confirm these files and folders are not included:

- `.env`
- `.wwebjs_auth/`
- `.wwebjs_cache/`
- `data/`
- `dist/`
- `node_modules/`
- Excel imports
- local campaign PDFs
- logs
- SQLite database files

## Upload Steps

```bash
git init
git add .
git status
git commit -m "Initial WhatsApp campaign dashboard"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

Check `git status` before committing. If any secret, database, WhatsApp session, Excel, or PDF file appears, remove it from the staged files before pushing.

## Render Notes

Use Render as a full-stack web service. The app needs a long-running Node process, SQLite persistence, Puppeteer/Chromium, and WhatsApp Web auth files, so do not deploy it as a Vercel-only serverless app.

Set secrets such as `ADMIN_PASSWORD` and `GROQ_API_KEYS` in the Render dashboard, not in GitHub.

Manual Render settings:

```bash
Build Command: npm ci && npm run build
Start Command: npm start
Health Check Path: /api/health
```

Also set:

```bash
PUPPETEER_CACHE_DIR=/opt/render/project/src/.cache/puppeteer
```

If Render reports a missing Chrome executable under `/opt/render/.cache/puppeteer`, use `Clear build cache & deploy`.

If Render reports `Browser was not found at the configured executablePath (/usr/bin/google-chrome)`, remove `CHROME_EXECUTABLE_PATH` from the Render environment variables or leave it blank, then redeploy.
