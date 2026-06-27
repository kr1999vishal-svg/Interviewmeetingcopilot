# Meeting Copilot — Browser Extension

A Chrome/Edge (Manifest V3) extension that injects a live AI copilot overlay
onto **Google Meet** and **Microsoft Teams** meeting pages. It reads the
meeting's live captions, detects questions, asks your backend for AI answers,
and can write those answers into the meeting chat box.

> Activation is **gated to a single meeting link** that you set (either in the
> extension popup or pushed automatically from the Meeting Copilot web app).

## Features

- **Overlay on the actual meeting page** — draggable, collapsible panel injected
  into Meet/Teams (only an extension can do this; a plain web app cannot).
- **Reads other participants' speech** via the meeting's live captions
  (turn on captions in Meet/Teams).
- **Private transcription (Listen toggle)** — click the **Listen** button to
  privately transcribe the meeting tab audio using OpenAI Whisper. This captures
  remote participants' voices without enabling in-meeting captions, keeping the
  transcription private to you.
- **Question detection + AI answers** — when someone asks a question, it
  requests a concise answer from your backend (`POST /api/answer`).
- **Auto-write to chat** — optionally insert (and optionally auto-send) the
  answer into the meeting chat box.
- **URL gating** — only assists the meeting whose link you configured.
- **Debug toggle** — a **Debug** chip in the overlay header shows live
  diagnostics (platform, captions found, chat-input detected, gate match, URL)
  to verify selectors on a real call.

## Prerequisites

- The backend running (default `http://localhost:4000`) with a valid AI
  provider key. The extension proxies AI requests through it.

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this `extension/` folder.
4. Click the extension's **Details → Extension options** and set:
   - **Backend URL** (default `http://localhost:4000`)
   - **AI provider + API key** (+ optional model)
   - Click **Test connection**.

## Use

### Option A — set the meeting in the popup
1. Click the extension icon.
2. Paste the **meeting link** (e.g. `https://meet.google.com/abc-defg-hij`),
   optional title/context, toggle **Auto-answer** / **Auto-send**, then **Save**.
3. Open/refresh that Meet/Teams tab. Turn on **live captions**. The overlay
   appears and starts listening.

### Option B — push from the web app (recommended)
1. In the web app, create a meeting with a **Meeting Link**.
2. Open that meeting's **Live Meeting** page — it automatically pushes the link
   and context to the extension (via a localhost bridge content script).
3. Open the Meet/Teams tab and turn on captions.

## How it works

```
Meet/Teams page                         Extension                 Backend
─────────────────                       ─────────                 ───────
captions DOM  ──poll──►  content.js ──► background ── /api/answer ─► AI provider
chat box      ◄─write──  content.js ◄── answer
overlay UI (injected)

Private transcription (Listen toggle):
tab audio  ──capture──►  offscreen.js ──► background ── /api/transcribe ─► Whisper
transcript ◄────────────  content.js ◄── sttResult
```

- `content/platform.js` — Meet/Teams DOM adapters (captions, chat input, send).
- `content/content.js` — polls captions, finalises lines, detects questions,
  requests answers, updates the overlay, writes to chat, handles STT transcripts.
- `content/overlay.js` / `overlay.css` — the floating panel UI.
- `content/bridge.js` — runs on `localhost`, relays the active meeting from the
  web app to the background worker.
- `background.js` — config storage + AI proxy to the backend, orchestrates
  tab audio capture via offscreen document.
- `offscreen/offscreen.js` — captures tab audio, segments it, and sends to
  `/api/transcribe` for private Whisper transcription.

## Caveats / maintenance

- **Caption-based Q&A requires captions** — the AI question detection uses the
  meeting's live captions. For private transcription without captions, use the
  **Listen** toggle instead.
- Google/Microsoft change their DOM frequently. If captions or chat stop being
  detected, update the selectors in `content/platform.js` (they are centralised
  with fallbacks at the top of each platform object).
- Auto-sending AI answers into a real meeting chat should be used responsibly;
  it is **off by default**.
