# Alenaz

Alenaz is a ChatGPT-style AI assistant prototype built with Flask and the OpenAI API.

## Prototype features

- Streaming AI chat
- Optional web search with clickable source links
- Image generation
- Image understanding
- PDF and document attachments
- Browser voice input and text-to-speech
- Local chat history
- Auto, Study, Creative and Code modes
- Light/dark themes and local settings
- Prototype hourly chat and daily image limits
- Mobile-responsive interface

## Run locally

1. Create a virtual environment and install dependencies:

   `pip install -r requirements.txt`

2. Copy `.env.example` to `.env`.
3. Put your OpenAI API key in `.env` as `OPENAI_API_KEY=...`.
4. Start the app:

   `python nexus.py`

5. Open `http://localhost:5050`.

## Deploy

The included `Procfile` starts the app with Gunicorn. Add `OPENAI_API_KEY` as a secret environment variable in your hosting provider. Never paste the key into `nexus.py`, `app.js`, or any public GitHub file.

## Prototype notes

Chat history and user settings are stored in the browser. Usage limits are currently kept in server memory, so they are suitable for a prototype but should be moved to a database/Redis before a public production launch. Real sign-in/accounts are also a production follow-up.

API usage is billed separately by the model/API provider.
