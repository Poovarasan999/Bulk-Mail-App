# Bulk Mail App (MERN)

Full-stack bulk mail application built with React (frontend), Express/Node.js (backend), and MongoDB (database).

## Features

- Compose bulk email with subject, body, and multiple recipients.
- Recipient parsing from comma, semicolon, or newline-separated input.
- API-based sending through Nodemailer.
- MongoDB storage for email logs (`success` / `failed`).
- Email history view in the frontend.

## Project Structure

- `frontend` - React + Vite UI
- `backend` - Express API + MongoDB + Nodemailer

## Setup

### 1) Install dependencies

```bash
cd frontend && npm install
cd ../backend && npm install
```

### 2) Configure backend environment

Copy `backend/.env.example` to `backend/.env` and fill in values:

- `MONGO_URI` - MongoDB connection string
- `MAIL_USER` / `MAIL_PASS` - sender credentials (for Gmail, use App Password)
- `MAIL_FROM` - optional display sender address

### 3) Run the app

Backend:

```bash
cd backend
npm run dev
```

Frontend (new terminal):

```bash
cd frontend
npm run dev
```

Frontend runs on Vite default port. **Local backend:** requests to `/api` are proxied to `http://localhost:5000` (see `frontend/vite.config.js`).

**Backend on Render (or any remote URL):** create `frontend/.env` from `frontend/.env.example` and set:

```env
VITE_API_BASE_URL=https://your-service-name.onrender.com
```

No trailing slash. Restart `npm run dev` after changing env. For production builds (`npm run build`), set the same variable in your host (Vercel, Netlify, etc.).

## API Endpoints

- `GET /api/health` - health check
- `POST /api/mail/send` - send bulk mail and save record
- `GET /api/mail/history` - fetch recent email history
- `DELETE /api/mail/history/:id` - delete one history record
