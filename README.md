# Meeting Copilot

A production-ready meeting assistant with a dark, modern UI. Capture pre-meeting context, run live meetings with real-time notes/transcript over WebSocket, and generate summaries — all stored locally in the browser (no database).

## Tech Stack

**Frontend:** React + Vite + TypeScript + TailwindCSS + React Router
**Backend:** Node.js + Express + WebSocket (`ws`) + TypeScript

## Project Structure

```
.
├── backend/        # Express API + WebSocket server (TypeScript)
└── frontend/       # React + Vite SPA (TypeScript)
```

## Getting Started

### 1. Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Runs the API + WebSocket server on `http://localhost:4000`.

### 2. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Runs the app on `http://localhost:5173`.

## Features

- **Dashboard** — overview of all meetings with quick stats.
- **Create Meeting** — schedule a meeting with participants & agenda.
- **Pre-Meeting Context** — attach notes, links, and goals.
- **Live Meeting** — real-time transcript & notes via WebSocket.
- **Meeting Summary** — auto-generated recap, action items, decisions.
- **Settings** — theme, user profile, and data management.

## Notes

- All data persists in browser **localStorage** — there is no database.
- Environment variables are supported on both apps (`.env`).
