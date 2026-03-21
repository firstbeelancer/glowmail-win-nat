# GlowMail AI

AI-powered email client built with React, Vite, and Tailwind CSS.

## Authentication

### Supported Auth Methods

GlowMail supports **two** authentication methods, both based on username + password sent to your mail server via IMAP/SMTP:

| Method | Description | When to use |
|---|---|---|
| **Password** | Standard email password | Self-hosted / corporate servers |
| **App Password** | Provider-generated app-specific password | Gmail, Yandex, Mail.ru, iCloud, Yahoo (recommended) |

> **Note:** OAuth 2.0, Kerberos, NTLM, and TLS certificate authentication are **not** currently supported. The UI only shows methods that actually work.

### How Credentials Are Stored

- Credentials are stored in the browser's `localStorage` under the key `glowmail_credentials`.
- The password is **obfuscated** (XOR + base64) to prevent casual inspection. This is **not** cryptographic encryption — it protects against shoulder-surfing, not a determined attacker with devtools access.
- Legacy unobfuscated credentials are auto-migrated on first read.
- On logout, credentials are fully removed from localStorage.

### Login Flow

1. User enters email + app password on the login page.
2. Server presets (IMAP/SMTP host/port) are auto-detected for popular providers (Gmail, Yandex, Mail.ru, Outlook, iCloud, Yahoo).
3. Credentials are obfuscated and stored in localStorage.
4. On each mail operation, credentials are deobfuscated and sent to backend Edge Functions (`imap-proxy`, `smtp-proxy`) which connect to the actual mail server.

## Architecture

- **Frontend**: React + Vite + Tailwind CSS + TypeScript
- **Backend**: Supabase Edge Functions (`imap-proxy` for IMAP, `smtp-proxy` for SMTP)
- **Email protocols**: IMAP for reading, SMTP for sending — proxied through Deno edge functions to bypass browser TCP limitations
- **AI features**: Email rewriting, tone adjustment, proofreading via Supabase Edge Function (`email-ai`)

## Local Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev
```

The app requires a connected Supabase project for the Edge Functions to work (IMAP/SMTP proxy, AI features).

## Features

- Full IMAP email reading with folder navigation
- SMTP email sending with rich text editor
- Detached compose window (opens in new browser window)
- AI-powered email rewriting and proofreading
- Dark/light theme support
- Russian and English UI languages
- Email search with Cyrillic support
- Drag-to-resize panels
- Code block and terminal log insertion in composer
