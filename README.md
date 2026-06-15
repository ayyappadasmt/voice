# Voice Agentic Platform

Operate the platform entirely by **voice**. You speak, the system understands,
and it **executes autonomously** — sourcing leads, launching campaigns, and
reporting back in real time. No dashboards. No forms. Just speech.

> "Find 100 qualified leads in Kerala and start a LinkedIn campaign."
> → the agent finds the leads and launches the campaign, then tells you it's done.

**Stack:** Next.js + Tailwind (web) · FastAPI (backend) · Gemini 2.5 Flash **Live API**
(real-time speech-to-speech with function calling) · Docker.

## Architecture

```
Browser (Next.js)                       FastAPI backend                 Google
┌────────────────────┐   PCM16 16k   ┌────────────────────────┐      ┌──────────────┐
│ mic ─► AudioWorklet │ ───ws audio─► │ /ws/voice  bridge       │ ───► │ Gemini 2.5   │
│ speaker ◄─ playback │ ◄──ws audio── │  + tool execution       │ ◄─── │ Flash Live   │
│ transcript+activity │ ◄──ws events─ │  (find_leads, campaign) │      └──────────────┘
└────────────────────┘               └────────────────────────┘
```

- The browser streams microphone audio (16 kHz PCM16) over a WebSocket.
- The backend bridges that to the Gemini Live API and streams the spoken reply
  (24 kHz PCM16) back for playback.
- When the model decides to act, it emits **tool calls**; the backend executes
  them (`find_leads`, `start_linkedin_campaign`, `get_campaign_status`) and feeds
  the results back, so the conversation drives real work.
- Transcripts and tool activity are streamed to the UI as events.

## Quick start (Docker)

```bash
cp .env.example .env        # set GEMINI_API_KEY (required)
docker compose up --build
```

- Web app: http://localhost:3000
- Backend API/docs: http://localhost:8000/docs

Open the web app, tap the orb, allow the microphone, and start talking.

## Run locally without Docker

Backend:

```bash
pip install -r requirements.txt
cp .env.example .env         # set GEMINI_API_KEY
uvicorn app.main:app --reload --port 8000
```

Web:

```bash
cd web
npm install
cp .env.local.example .env.local
npm run dev                  # http://localhost:3000
```

## Tools the agent can run

| Tool | What it does |
| --- | --- |
| `find_leads(location, count, industry?, role?)` | Sources & scores qualified B2B leads. |
| `start_linkedin_campaign(name?, message?, audience?, daily_limit?)` | Launches outreach to the found leads. |
| `get_campaign_status(campaign_id?)` | Reports sent / accepted / replied metrics. |

The executors in `app/services/tools.py` simulate realistic lead sourcing and
campaign progress so the platform works end to end. Swap their bodies for real
data providers / LinkedIn / CRM integrations — the tool schema and the agent
bridge stay the same.

Inspect what the agent has done via REST:

- `GET /agent/leads` — leads sourced so far
- `GET /agent/campaigns` — campaigns launched

## Configuration

See `.env.example`. The only required value is `GEMINI_API_KEY`.

| Var | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | **Required.** Gemini Live API key. |
| `GEMINI_MODEL` / `GEMINI_VOICE` | Live model + voice. |
| `NEXT_PUBLIC_WS_URL` | WebSocket URL the browser uses (use `wss://` in prod). |
| `CORS_ALLOWED_ORIGINS` | Allowed web origins (set explicitly in prod). |
| `STAFF_API_KEY` | Secret for the optional knowledge-admin page (`/admin`). |
| `TWILIO_*` | Optional — only for the inbound **phone** channel. |

## Optional channels

- **Phone (V2V):** point a Twilio number's voice webhook at `POST /voice-webhook`.
  Requires the `TWILIO_*` vars; requests are signature-validated.
- **Knowledge admin:** `GET /admin` — a static page where staff feed company
  knowledge to the assistant (protected by `STAFF_API_KEY`).

## Tests

```bash
pytest
```

## Production notes

- Serve over HTTPS/WSS — microphone capture requires a secure context, and the
  audio/keys must be encrypted in transit.
- Set `CORS_ALLOWED_ORIGINS` to your exact web origin.
- The agent's leads/campaigns are stored in memory per backend instance; move to
  a database and real integrations before going live.
