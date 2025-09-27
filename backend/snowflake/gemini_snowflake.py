import os
from dotenv import load_dotenv
import snowflake.connector
import google.generativeai as genai

load_dotenv()

def fetch_snippet(topic: str):
    """Fetch a snippet from Snowflake by topic."""
    conn = snowflake.connector.connect(
        user=os.environ["SNOWFLAKE_USER"],
        account=os.environ["SNOWFLAKE_ACCOUNT"],
        private_key=open(os.environ["SNOWFLAKE_PRIVATE_KEY_PATH"], "rb").read(),
        authenticator='snowflake',
        warehouse=os.environ["SNOWFLAKE_WAREHOUSE"],
        database=os.environ["SNOWFLAKE_DATABASE"],
        schema=os.environ["SNOWFLAKE_SCHEMA"]
    )
    cur = conn.cursor()
    cur.execute("SELECT text FROM postpartum_snippets WHERE topic=%s LIMIT 1;", (topic,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return row[0] if row else None

def gemini_summarize(text: str):
    """Send text to Gemini and get a summary."""
    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    model = genai.GenerativeModel("models/gemini-2.5-flash")  # ✅ updated model
    response = model.generate_content(f"Summarize this snippet for parents: {text}")
    return response.text.strip()

if __name__ == "__main__":
    topic = "latch basics"   # ✅ use underscores to match your DB
    snippet = fetch_snippet(topic)
    if snippet:
        summary = gemini_summarize(snippet)
        print("Gemini summary:", summary)
    else:
        print("No snippet found for topic:", topic)
