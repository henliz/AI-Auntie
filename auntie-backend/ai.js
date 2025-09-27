// ai.js — temporary "brain" so SMS works tonight.
// Later swap internals to Gemini but KEEP this function signature.

const REG_DEFAULT_REGION = 'ON';

const RED_FLAGS = [
  /suicide|end it|kill myself|can.t keep myself safe/i,
  /harm(ing)? (my )?baby|hurt the baby/i,
  /soaking (a )?pad (an|a|per) hour/i,
  /severe headache.*vision|chest pain|short(ness)? of breath/i,
  /fever (39|102)/i,
  /leg (swelling|pain)|calf pain/i,
  /incision (open|opening|split)/i,
  /baby (not )?feeding .*8\+? hours/i,
  /baby (very )?sleepy|lethargic|blue lips/i
];

function classifyTopic(t) {
  const s = t.toLowerCase();
  if (s.includes('latch') || s.includes('breast')) return 'latch';
  if (s.includes('sleep')) return 'sleep';
  if (s.includes('pain') && s.includes('c-section')) return 'pain';
  if (s.includes('bleeding') || /soak.*pad/.test(s)) return 'bleeding';
  if (s.includes('anx') || s.includes('overwhelm') || s.includes('depress')) return 'mood';
  return 'general';
}

function hasRedFlag(t) {
  return RED_FLAGS.some(rx => rx.test(t));
}

function makeReply({ topic, text }) {
  switch (topic) {
    case 'latch':
      return "Latch issues are so common and not your fault. Try a laid-back position and 20 minutes of skin-to-skin tonight.";
    case 'sleep':
      return "Night cycles are rough. Try a 2-hour ‘sleep window’ and hand off one feed if you can—tiny rests count.";
    case 'pain':
      return "C-section recovery can sting more at night. Check your meds timing, use a pillow to brace, and change positions slowly.";
    case 'bleeding':
      return "Heavy bleeding can be urgent. If you’re soaking pads hourly, please consider urgent care or 911 and I’ll share numbers.";
    case 'mood':
      return "What you’re feeling is real. You deserve care. Tonight: text a trusted person, eat something small, and plan one call tomorrow.";
    default:
      return "You’re doing more than enough. Tonight: drink water, feed on demand, and rest when baby rests—small wins count.";
  }
}

async function getAuntieReply({ text, context = {} }) {
  const region = context.region || REG_DEFAULT_REGION;
  const topic = classifyTopic(text);

  if (hasRedFlag(text)) {
    return {
      intent: 'ESCALATE',
      topic: topic === 'general' ? 'bleeding' : topic,
      region,
      reply_text:
        "I’m concerned about what you shared. This can be urgent. Consider calling 911/local emergency or a nurse line. I can share options near you."
    };
  }

  // RESOURCE when a local handoff helps; else COMFORT
  const resourceTopics = new Set(['latch', 'bleeding', 'mood']);
  const intent = resourceTopics.has(topic) ? 'RESOURCE' : 'COMFORT';

  return {
    intent,
    topic,
    region,
    reply_text: makeReply({ topic, text })
  };
}

module.exports = { getAuntieReply };
