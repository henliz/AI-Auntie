import os
from dotenv import load_dotenv
import snowflake.connector

load_dotenv()

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
    
def test_snippets_query(topic: str):
    """Fetch a few snippets by topic."""
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT topic, subtopic, text, source FROM postpartum_snippets WHERE topic=%s LIMIT 3;",
            (topic,)
        )
        rows = cur.fetchall()
        print(f"✅ Snippets for topic='{topic}':")
        for r in rows:
            print(r)
    finally:
        cur.close()
        conn.close()

def test_resources_query(topic: str, region: str = "Ontario"):
    """Fetch a few resources by topic + region."""
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT name, phone, url FROM postpartum_resources WHERE topic=%s AND region=%s LIMIT 3;",
            (topic, region)
        )
        rows = cur.fetchall()
        print(f"✅ Resources for topic='{topic}' in region='{region}':")
        for r in rows:
            print(r)
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    test_snippets_query("mental health")
    test_resources_query("mental_health", "Ontario")
