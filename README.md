# GlowMail AI

AI-powered email client built with React, Vite, Tauri, and Rust.

## Authentication

### Supported Auth Methods

GlowMail currently supports two authentication methods based on username + password sent to your mail server via IMAP/SMTP:

| Method | Description | When to use |
|---|---|---|
| **Password** | Standard email password | Self-hosted or corporate servers |
| **App Password** | Provider-generated app-specific password | Gmail, Yandex, Mail.ru, iCloud, Yahoo |

> OAuth 2.0, Kerberos, NTLM, and TLS certificate authentication are not currently supported.

### How Credentials Are Stored

- Credentials are stored in local storage under `glowmail_credentials`.
- The password is obfuscated with XOR + base64 to reduce casual inspection.
- This is not strong encryption and should be treated as a temporary desktop-era storage strategy.

### Login Flow

1. The user enters an email and password or app password.
2. IMAP/SMTP presets are auto-detected for popular providers.
3. Credentials are saved locally.
4. The native desktop backend connects directly to the mail server.

## Architecture

- **Frontend**: React + Vite + Tailwind CSS + TypeScript
- **Desktop shell**: Tauri
- **Backend**: Rust native mail backend with local SQLite cache and FTS search
- **Email protocols**: IMAP for reading, SMTP for sending
- **AI features**: Direct AI API calls without Supabase

## Local Development

```bash
npm install
npm run desktop:dev
```

The desktop build no longer requires Supabase for AI features or SMTP sending. IMAP/SMTP transport is handled by the native backend.

## Features

- Full IMAP email reading with folder navigation
- Native SMTP email sending
- Detached compose window
- AI-powered rewriting, proofreading, tone adjustment, and quick replies
- Dark and light themes
- Russian and English UI
- Local search with Cyrillic support
- Drag-to-resize panels
- Code block and terminal log insertion in composer
