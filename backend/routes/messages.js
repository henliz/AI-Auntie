import Twilio from "twilio";
import { saveMessage } from "../shared/dbHelpers.js";
import { generateAuntieReply } from "../ai/brain.js";

const esc = (s="") => s.replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const twilio = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export default async function messagesRoutes(app) {
  app.post("/twilio/sms", async (req, reply) => {
    const { From, To, Body, MessageSid } = req.body || {};
    const userText = (Body || "").trim();
    const sessionId = `sms:${From || "unknown"}`;

    // log inbound
    await saveMessage?.({
      session_id: sessionId,
      sender: "user",
      text: userText,
      channel: "sms",
      meta: { from: From, to: To, messageSid: MessageSid }
    }).catch(() => {});

    // generate reply
    let replyText = "I’m here. Can you share a bit more?";
    try {
      const ai = await generateAuntieReply(userText, { region: null });
      replyText = ai.reply_text || replyText;

      await saveMessage?.({
        session_id: sessionId,
        sender: "auntie",
        text: replyText,
        channel: "sms",
        intent: ai.intent,
        topic: ai.topic,
        meta: { from: To, to: From, in_reply_to: MessageSid }
      }).catch(() => {});
    } catch {}

    reply.type("text/xml").send(`<Response><Message>${esc(replyText)}</Message></Response>`);
  });
}
