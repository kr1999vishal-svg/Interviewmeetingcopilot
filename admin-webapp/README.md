# Interview AI - Admin Dashboard

Admin web application for managing the Interview AI - Meeting Copilot extension backend configuration and users.

## Setup

### 1. Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a new project
3. Enable the following services:
   - **Authentication**: Enable Google Sign-In
   - **Firestore Database**: Create database
   - **Storage**: Enable storage for file uploads
4. Get your Firebase configuration from Project Settings
5. Copy the values to `.env` file (see `.env.example`)

### 2. Environment Variables

Copy `.env.example` to `.env` and fill in your Firebase configuration:

```bash
cp .env.example .env
```

Update `.env` with your Firebase credentials:
```
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project_id.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_BACKEND_URL=http://localhost:4000
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Run Development Server

```bash
npm run dev
```

The admin dashboard will be available at `http://localhost:3000`

## Features

### Dashboard
- View total users, active meetings, files uploaded, and API calls
- Recent activity feed

### Settings
- Configure backend URL
- Set AI provider (OpenAI, Anthropic, Google)
- Configure API key and model
- All AI settings are managed here (not in extension)

### Users
- View all registered users
- Search users by email or name
- View user statistics (meetings, files)

## Architecture

- **Frontend**: React + Vite + TailwindCSS
- **Authentication**: Firebase Auth (Google Sign-In)
- **Backend API**: Connects to the main backend at `/api/admin/*`
- **Data Storage**: Firebase Firestore (users), Firebase Storage (files)

## Security Notes

- The admin dashboard should be deployed to a secure environment
- Enable Firebase Authentication rules to restrict access
- Use environment variables for sensitive configuration
- In production, implement proper authentication for admin access

## Deployment

### Vercel (Recommended)

1. Connect your GitHub repository
2. Add environment variables in Vercel dashboard
3. Deploy

### Netlify

1. Connect your GitHub repository
2. Add environment variables in Netlify dashboard
3. Deploy

### Firebase Hosting

```bash
npm run build
firebase deploy
```

## Backend API Endpoints

The admin dashboard communicates with these backend endpoints:

- `GET /api/admin/config` - Get backend configuration
- `POST /api/admin/config` - Save backend configuration
- `GET /api/admin/users` - Get all users
- `GET /api/admin/stats` - Get usage statistics

## Extension Integration

The extension no longer stores AI configuration locally. Instead:
1. Users sign in via Google Sign-In in the extension popup
2. Extension fetches AI configuration from the backend
3. Admin manages all AI settings through this dashboard
4. Files uploaded by users are stored and processed by the backend
