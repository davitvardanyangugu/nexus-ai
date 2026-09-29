import os
import time
from collections import defaultdict, deque

from dotenv import load_dotenv
from flask import Flask, Response, jsonify, render_template, request, stream_with_context
from openai import OpenAI

load_dotenv()

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 12 * 1024 * 1024

API_KEY = os.getenv("OPENAI_API_KEY", "")
CHAT_MODEL = os.getenv("ALENAZ_MODEL", "gpt-6-luna")
IMAGE_MODEL = os.getenv("ALENAZ_IMAGE_MODEL", "gpt-image-2.5-sunburst")
CHAT_LIMIT = int(os.getenv("ALENAZ_HOURLY_LIMIT", "30"))
IMAGE_DAILY_LIMIT = int(os.getenv("ALENAZ_IMAGE_DAILY_LIMIT", "3"))

client = OpenAI(api_key=API_KEY) if API_KEY else None

SYSTEM_PROMPT = """
You are ALENAZ, a friendly, capable AI assistant.
Be clear, useful, conversational, and honest.
You can help with learning, writing, coding, brainstorming, research, and image understanding.
When web search is enabled, use current sources and avoid pretending that old information is current.
When a file or image is attached, pay close attention to it.
Do not claim that you performed an action you did not actually perform.
"""

MODE_PROMPTS = {
    "auto": "",
    "study": "Act like a patient tutor. Explain step by step and check understanding without being patronizing.",
    "creative": "Be imaginative and original. Offer vivid, polished ideas while following the user's constraints.",
    "code": "Act like a careful software engineer. Prefer correct, maintainable code and explain important implementation choices.",
}

usage = defaultdict(lambda: {"chat": deque(), "image": deque()})


def user_key():
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr or "unknown"


def take_quota(kind, limit, window_seconds):
    now = time.time()
    bucket = usage[user_key()][kind]
    cutoff = now - window_seconds
    while bucket and bucket[0] < cutoff:
        bucket.popleft()

    if len(bucket) >= limit:
        retry_after = max(1, int(window_seconds - (now - bucket[0])))
        return False, retry_after

    bucket.append(now)
    return True, 0


def require_client():
    if client is None:
        return jsonify({
            "error": "Alenaz is not connected to an API key yet. Add OPENAI_API_KEY to the server environment."
        }), 503
    return None


def clean_history(history):
    cleaned = []
    for item in (history or [])[-12:]:
        role = item.get("role")
        text = item.get("text")
        if role in {"user", "assistant"} and isinstance(text, str) and text.strip():
            cleaned.append({"role": role, "content": text[:12000]})
    return cleaned


def build_input(payload):
    message = (payload.get("message") or "").strip()
    attachment = payload.get("attachment")

    items = clean_history(payload.get("history"))
    current = []

    if message:
        current.append({"type": "input_text", "text": message})
    elif attachment:
        current.append({"type": "input_text", "text": "Please analyze this attachment."})

    if attachment:
        name = str(attachment.get("name") or "attachment")[:120]
        mime = str(attachment.get("type") or "application/octet-stream")
        data = attachment.get("data")

        if not isinstance(data, str) or not data.startswith("data:"):
            raise ValueError("Invalid attachment data.")

        if len(data) > 11_000_000:
            raise ValueError("Attachment is too large for this prototype.")

        if mime.startswith("image/"):
            current.append({
                "type": "input_image",
                "image_url": data,
                "detail": "auto",
            })
        else:
            current.append({
                "type": "input_file",
                "filename": name,
                "file_data": data,
            })

    if not current:
        raise ValueError("Message is empty.")

    items.append({"role": "user", "content": current})
    return items


def instructions_for(mode):
    extra = MODE_PROMPTS.get(mode or "auto", "")
    if extra:
        return SYSTEM_PROMPT + "\n\nMode guidance:\n" + extra
    return SYSTEM_PROMPT


def extract_citations(response):
    citations = []
    seen = set()

    for item in getattr(response, "output", []) or []:
        if getattr(item, "type", None) != "message":
            continue
        for part in getattr(item, "content", []) or []:
            for annotation in getattr(part, "annotations", []) or []:
                if getattr(annotation, "type", None) != "url_citation":
                    continue

                url = getattr(annotation, "url", None)
                title = getattr(annotation, "title", None) or url
                start_index = getattr(annotation, "start_index", None)
                end_index = getattr(annotation, "end_index", None)

                nested = getattr(annotation, "url_citation", None)
                if nested is not None:
                    url = url or getattr(nested, "url", None)
                    title = title or getattr(nested, "title", None)
                    start_index = start_index if start_index is not None else getattr(nested, "start_index", None)
                    end_index = end_index if end_index is not None else getattr(nested, "end_index", None)

                if not url or url in seen:
                    continue

                seen.add(url)
                citations.append({
                    "url": url,
                    "title": title or "Source",
                    "start_index": start_index,
                    "end_index": end_index,
                })

    return citations


@app.route("/")
def home():
    return render_template("index.html")


@app.get("/api/health")
def health():
    return jsonify({
        "name": "Alenaz",
        "configured": bool(API_KEY),
        "chat_model": CHAT_MODEL,
        "image_model": IMAGE_MODEL,
        "hourly_limit": CHAT_LIMIT,
        "image_daily_limit": IMAGE_DAILY_LIMIT,
    })


@app.post("/api/chat_stream")
def chat_stream():
    missing = require_client()
    if missing:
        return missing

    allowed, retry_after = take_quota("chat", CHAT_LIMIT, 3600)
    if not allowed:
        return jsonify({
            "error": "Hourly prototype limit reached.",
            "retry_after": retry_after,
        }), 429

    payload = request.get_json(silent=True) or {}

    try:
        model_input = build_input(payload)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    mode = payload.get("mode", "auto")

    def generate():
        try:
            stream = client.responses.create(
                model=CHAT_MODEL,
                instructions=instructions_for(mode),
                input=model_input,
                stream=True,
            )

            for event in stream:
                event_type = getattr(event, "type", "")
                if event_type == "response.output_text.delta":
                    delta = getattr(event, "delta", "")
                    if delta:
                        yield delta
                elif event_type == "error":
                    message = getattr(event, "message", "Unknown API error")
                    yield "\n\n[Alenaz error: " + str(message) + "]"
        except Exception as exc:
            yield "\n\n[Alenaz error: " + str(exc) + "]"

    return Response(stream_with_context(generate()), mimetype="text/plain; charset=utf-8")


@app.post("/api/search")
def search():
    missing = require_client()
    if missing:
        return missing

    allowed, retry_after = take_quota("chat", CHAT_LIMIT, 3600)
    if not allowed:
        return jsonify({
            "error": "Hourly prototype limit reached.",
            "retry_after": retry_after,
        }), 429

    payload = request.get_json(silent=True) or {}

    try:
        model_input = build_input(payload)
        response = client.responses.create(
            model=CHAT_MODEL,
            instructions=instructions_for(payload.get("mode", "auto")),
            input=model_input,
            tools=[{"type": "web_search", "search_context_size": "low"}],
            tool_choice="auto",
            include=["web_search_call.action.sources"],
        )
        return jsonify({
            "answer": response.output_text,
            "sources": extract_citations(response),
        })
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.post("/api/image")
def image():
    missing = require_client()
    if missing:
        return missing

    allowed, retry_after = take_quota("image", IMAGE_DAILY_LIMIT, 86400)
    if not allowed:
        return jsonify({
            "error": "Daily image prototype limit reached.",
            "retry_after": retry_after,
        }), 429

    payload = request.get_json(silent=True) or {}
    prompt = (payload.get("prompt") or "").strip()

    if not prompt:
        return jsonify({"error": "Image prompt is empty."}), 400

    try:
        result = client.images.generate(
            model=IMAGE_MODEL,
            prompt=prompt[:4000],
            size="1024x1024",
            quality="low",
        )

        image_data = result.data[0].b64_json
        return jsonify({
            "image": "data:image/png;base64," + image_data,
            "prompt": prompt,
        })
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    print("ALENAZ prototype online.")
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5050")), debug=False)
