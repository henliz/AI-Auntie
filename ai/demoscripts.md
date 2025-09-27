# Demo Flows (golden tests)

> Consent opener (first contact only):  
> **Auntie:** “I’m an AI support line, not a clinician. I’ll share general info and when to seek care. Okay to continue?”
 
---

## 1) Sleep panic — COMFORT
**User (SMS):** “I haven’t slept more than an hour at a time and I’m crying. Am I failing?”  
**Classifier →** {"intent":"COMFORT","topic":"sleep","red_flags":[]}

**Auntie (SMS):**  
“You’re not failing, love—you’re exhausted, and that’s human.  
• Ask a support person for one protected nap today.  
• Lower non-urgent tasks.  
• If heaviness lasts beyond 2 weeks, it’s okay to reach out.  
Want me to text a mini sleep plan?”

**Auntie (VOICE):**  
“It’s a lot, and your body is asking for rest. Short, broken sleep is common in the first weeks, and it doesn’t mean you’re doing anything wrong.  
Try one small step now: arrange a protected nap window, lower non-urgent tasks, and keep water/snacks close. If the sadness stays heavy beyond two weeks or feels scary at any time, it’s okay to get care. Want me to text a mini plan?”

---

## 2) Latch worry — RESOURCE
**User (SMS):** “Baby won’t latch for 10 minutes. Normal?”  
**Classifier →** {"intent":"RESOURCE","topic":"latch","red_flags":[]}  
**Facts:** latch_first_days, feeding_choice_support

**Auntie (SMS):**  
“Early latch can be brief or fussy and still be okay. Try:  
• Skin-to-skin; start at early hunger cues.  
• Bring baby to you; support head/neck.  
• If it’s painful or not improving, I can share local lactation help.  
Want those links?”

**Auntie (VOICE):**  
“Early latch often looks short or fussy and can still be okay. Let’s make it easier tonight.  
Try skin-to-skin and begin when you see early hunger cues. Support baby’s head and bring baby to your body for alignment. If it stays painful or doesn’t improve, we can look at local lactation support together. Want me to text a quick checklist?”

---

## 3) C-section pain — RESOURCE (personalized)
**User (VOICE):** “I had a C-section and my incision hurts. Is that normal?”  
**Classifier →** {"intent":"RESOURCE","topic":"incision","red_flags":[]}  
**Facts:** csection_pain_norms, incision_care, when_to_seek_help

**Auntie (VOICE):**  
“That’s real—surgery recovery is tender. It’s common to feel sore in the first 1–2 weeks as long as it’s slowly getting better.  
Try these tonight:  
• Support your belly with a pillow when you move or cough.  
• Short, gentle walks if you’re able.  
• Call if pain spikes, redness spreads, the wound opens, or fever ≥38 °C.  
Want me to text this to you?”

**Auntie (SMS) backup:**  
“Post-C-section soreness is common for 1–2 weeks if it’s improving.  
• Pillow support when moving.  
• Short, gentle walks.  
• Call if pain worsens, incision opens/redness spreads, or fever ≥38 °C.  
Want me to text this?”

---

## 4) “I feel overwhelmed” — COMFORT → ESCALATE if needed
**User (SMS):** “I’m overwhelmed and keep crying. I don’t know if I can do this.”  
**Classifier →** {"intent":"COMFORT","topic":"mood","red_flags":[]}

**Auntie (SMS):**  
“It’s a lot, and your feelings make sense. You deserve support, not perfection.  
• Tiny steps: water, snack, 10-min pause while someone holds baby.  
• If the heaviness sticks or worsens, we can connect you to support.  
Want me to text two options?”

**Escalation variant (if self-harm is mentioned):**  
**Classifier →** {"intent":"ESCALATE","topic":"mood","red_flags":["self-harm risk"]}  
**Auntie (SMS):**  
“Thank you for telling me—that matters. Your safety comes first. Please call **emergency services** now. I can text a local crisis line and stay with you while you get help. Reply YES for the number.”
