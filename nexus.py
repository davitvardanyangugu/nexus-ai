from flask import Flask, request, jsonify, render_template, Response, stream_with_context
from openai import OpenAI

app = Flask(__name__)

# 🔑 PUT YOUR API KEY HERE
API_KEY = ""

client = OpenAI(api_key=API_KEY)

SYSTEM_PROMPT = """
You are NEXUS, a futuristic AI assistant.
You are intelligent, calm, precise, and helpful.
Keep responses clear and conversational.
"""

@app.route("/")
def home():
    return render_template("index.html")

# 🔥 STREAMING ENDPOINT (ChatGPT-style typing)
@app.route("/ask_stream")
def ask_stream():
    user_input = request.args.get("q")

    def generate():
        stream = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_input}
            ],
            stream=True
        )

        for chunk in stream:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    return Response(stream_with_context(generate()), mimetype="text/plain")

if __name__ == "__main__":
    print("NEXUS streaming system online.")
    app.run(host="0.0.0.0", port=5050, debug=False)