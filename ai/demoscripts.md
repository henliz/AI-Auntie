# Demo Flows (golden tests)

## 1) Sleep panic — COMFORT
User: “I haven’t slept more than an hour at a time and I’m crying. Am I failing?”
Classifier → {"intent":"COMFORT","topic":"sleep","red_flags":[]}
Auntie (SMS):
“You’re not failing, love — you’re exhausted, and that’s human.
• Try one tiny nap window today while someone watches baby.
• Lower non-urgent tasks.
• If sadness feels heavy or lasts beyond two weeks, let’s loop in care.
Want me to text a mini sleep checklist?”

## 2) Latch worry — RESOURCE
User: “Baby won’t latch for 10 minutes. Normal?”
Classifier → {"intent":"RESOURCE","topic":"latch","red_flags":[]}
Facts: latch_first_days, feeding_choice_support
Auntie (SMS):
“Early latch can be short or fussy and still be okay. Let’s make it easier:
• Skin-to-skin; start at early hunger cues.
• Support head/neck; bring baby to you.
• If it’s painful or not improving, I can share local lactation support.
Want those links?”

## 3) C-section pain — RESOURCE (personalized)
User (Voice): “I had a C-section and my incision hurts. Is that normal?”
Classifier → {"intent":"RESOURCE","topic":"incision","red_flags":[]}
Facts: csection_pain_norms, incision_care, when_to_seek_help
Auntie (Voice):
“That’s real, love — surgery recovery is tender. It’s common to feel sore in the first week or two as long as it’s slowly getting better.
Try these tonight:
• Support your belly with a pillow when you move or cough.
• Short, gentle walks if you’re able.
• Call if pain spikes, redness spreads, the wound opens, or you get a fever 38 °C or higher.
Want me to text this to you?”

## 4) “I feel overwhelmed” — COMFORT → ESCALATE if needed
User: “I’m overwhelmed and keep crying. I don’t know if I can do this.”
Classifier → {"intent":"COMFORT","topic":"mood","red_flags":[]}
Auntie (SMS):
“It’s a lot, and your feelings make sense. You deserve support, not perfection.
• Tiny steps: water, snack, 10-minute pause while someone holds baby.
• If the heaviness sticks around or gets worse, we can connect you to support lines.
Want me to text a couple of options?”

Escalation variant (if self-harm is mentioned):
Classifier → {"intent":"ESCALATE","topic":"mood","red_flags":["self-harm risk"]}
Auntie (SMS):
“Thank you for telling me — that matters. Your safety comes first. Please call emergency services now. I can text **a local crisis line** and stay with you while you get help. Reply YES for the number.”
