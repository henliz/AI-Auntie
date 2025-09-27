import os
from dotenv import load_dotenv
from fastapi import FastAPI, Query
import snowflake.connector

load_dotenv()

app = FastAPI()

@app.get("/")
def root():
    return {"status": "✅ Auntie Snowflake API is running"}

key_path = os.environ.get("SNOWFLAKE_PRIVATE_KEY_PATH")
with open(key_path, 'rb') as key:
    p_key = key.read()

def get_connection():
    """Return a Snowflake connection using key-pair auth."""
    return snowflake.connector.connect(
        user=os.environ.get("SNOWFLAKE_USER"),
        account=os.environ.get("SNOWFLAKE_ACCOUNT"),
        private_key=p_key,
        authenticator='snowflake',
        warehouse=os.environ.get("SNOWFLAKE_WAREHOUSE"),
        database=os.environ.get("SNOWFLAKE_DATABASE"),
        schema=os.environ.get("SNOWFLAKE_SCHEMA")
    )
    
@app.get("/snippets")
def get_snippets(topic: str = Query(..., description="Topic, e.g. 'mental health'")):
    """Return top 3 snippets for a given topic."""
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT topic, subtopic, text, source FROM postpartum_snippets WHERE topic=%s ORDER BY trust_score DESC LIMIT 3;",
            (topic,)
        )
        rows = cur.fetchall()
        return {
            "topic": topic,
            "snippets": [
                {"topic": r[0], "subtopic": r[1], "text": r[2], "source": r[3]}
                for r in rows
            ]
        }
    finally:
        cur.close()
        conn.close()

@app.get("/resources")
def get_resources(topic: str = Query(..., description="Topic, e.g. 'mental_health'"),
                  region: str = Query("Ontario", description="Region, default Ontario")):
    """Return top 3 resources for a given topic and region."""
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT name, phone, url FROM postpartum_resources WHERE topic=%s AND region=%s ORDER BY trust_score DESC LIMIT 3;",
            (topic, region)
        )
        rows = cur.fetchall()
        return {
            "topic": topic,
            "region": region,
            "resources": [
                {"name": r[0], "phone": r[1], "url": r[2]} for r in rows
            ]
        }
    finally:
        cur.close()
        conn.close()
