import os
import google.generativeai as genai

# Load API key
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

# Pick a supported model
model = genai.GenerativeModel("models/gemini-2.5-flash")

# Try a sample summarization
response = model.generate_content("Summarize this: Postpartum depression is common after childbirth, often linked to hormonal changes and emotional stress.")
print(response.text)
