/* global use, db */
// MongoDB Playground
// Auntie Project: Setup + Seed Data + Observability + Resources

// =====================================================
// 1) Setup Collections + Indexes
// =====================================================
use("auntie");

// users: unique hashed phone
db.users.createIndex({ user_hash: 1 }, { unique: true });

// sessions: auto-delete after 30 days once ended_at is set
db.sessions.createIndex(
  { ended_at: 1 },
  {
    expireAfterSeconds: 30 * 24 * 60 * 60, // 30 days
    partialFilterExpression: { ended_at: { $type: "date" } },
  }
);

// messages: auto-delete after 30 days
db.messages.createIndex({ created_at: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
db.messages.createIndex({ session_id: 1, created_at: 1 });
db.messages.createIndex({ intent: 1 });
db.messages.createIndex({ topic: 1 });

// optional: resources (for vetted helplines, etc.)
db.resources.createIndex({ topic: 1, region: 1 });

"✅ Setup complete";

// =====================================================
// 2) Seed Demo Data (1 user, 1 session, 2 messages)
// =====================================================
const now = new Date();

// upsert a user
db.users.updateOne(
  { user_hash: "demo123" },
  {
    $setOnInsert: { user_hash: "demo123", created_at: now },
    $set: {
      retention_note: "We auto-delete sessions/messages after 30 days.",
      context: {
        delivery_type: "c-section",
        feeding: "mixed",
        weeks_postpartum: 2,
        region: "Ontario",
      },
    },
  },
  { upsert: true }
);

// create session
const sessionId = "session-demo-1";
db.sessions.updateOne(
  { session_id: sessionId },
  {
    $setOnInsert: {
      user_hash: "demo123",
      session_id: sessionId,
      started_at: now,
      channel: "sms",
      message_count: 0,
    },
  },
  { upsert: true }
);

// insert 2 messages (user + Auntie reply)
db.messages.insertMany([
  {
    session_id: sessionId,
    sender: "user",
    text: "Auntie, my incision is sore. Is that normal?",
    topic: "c-section recovery",
    created_at: now,
  },
  {
    session_id: sessionId,
    sender: "auntie",
    text: "That’s common in week 2. Watch for fever or redness spreading.",
    intent: "COMFORT",
    topic: "c-section recovery",
    latency_ms: 1200,
    created_at: new Date(now.getTime() + 1000),
  },
]);

// bump session count + close session
db.sessions.updateOne(
  { session_id: sessionId },
  { $inc: { message_count: 2 }, $set: { ended_at: new Date(now.getTime() + 2000) } }
);

"✅ Seed complete";

// =====================================================
// 3) Seed Resources (Ontario + Waterloo Region)
// =====================================================
db.resources.insertMany([
  // Ontario-wide
  {
    topic: "crisis",
    type: "hotline",
    name: "Talk Suicide Canada",
    phone: "1-833-456-4566",
    url: "https://talksuicide.ca",
    region: "Ontario",
    trust_score: 0.99,
    is_247: true,
    created_at: new Date()
  },
  {
    topic: "mental_health",
    type: "hotline",
    name: "ConnexOntario Mental Health Helpline",
    phone: "1-866-531-2600",
    url: "https://www.connexontario.ca/",
    region: "Ontario",
    trust_score: 0.95,
    is_247: true,
    created_at: new Date()
  },
  {
    topic: "postpartum_support",
    type: "support_group",
    name: "Postpartum Support Ontario",
    phone: "1-855-255-7999",
    url: "https://postpartumontario.org/",
    region: "Ontario",
    trust_score: 0.93,
    is_247: false,
    created_at: new Date()
  },
  {
    topic: "parenting",
    type: "public_health",
    name: "Telehealth Ontario",
    phone: "1-866-797-0000",
    url: "https://health811.ontario.ca/",
    region: "Ontario",
    trust_score: 0.90,
    is_247: true,
    created_at: new Date()
  },
  {
    topic: "latch",
    type: "lactation",
    name: "La Leche League Ontario",
    phone: "1-800-665-4324",
    url: "https://www.lllc.ca/find-group-ontario",
    region: "Ontario",
    trust_score: 0.92,
    is_247: false,
    created_at: new Date()
  },
  {
    topic: "pelvic_floor",
    type: "physio",
    name: "Women’s College Hospital – Pelvic Floor Program",
    phone: "416-323-6400",
    url: "https://www.womenscollegehospital.ca/",
    region: "Ontario",
    trust_score: 0.88,
    is_247: false,
    created_at: new Date()
  },

  // Waterloo Region (KW + Cambridge)
  {
    topic: "latch",
    type: "lactation",
    name: "La Leche League – Waterloo",
    phone: "519-772-7681",
    url: "https://www.lllc.ca/find-group-ontario",
    region: "Waterloo Region",
    trust_score: 0.92,
    is_247: false,
    created_at: new Date()
  },
  {
    topic: "latch",
    type: "lactation",
    name: "Breastfeeding Buddies – Region of Waterloo Public Health",
    phone: "519-575-4400",
    url: "https://www.breastfeedingbuddies.com/",
    region: "Waterloo Region",
    trust_score: 0.94,
    is_247: false,
    created_at: new Date()
  },
  {
    topic: "postpartum_support",
    type: "support_group",
    name: "Our Place Family Resource and Early Years Centre – Cambridge",
    phone: "519-571-1626",
    url: "https://www.ourplacekw.ca/",
    region: "Cambridge",
    trust_score: 0.91,
    is_247: false,
    created_at: new Date()
  },
  {
    topic: "parenting",
    type: "public_health",
    name: "Region of Waterloo Public Health – Healthy Babies Healthy Children",
    phone: "519-575-4400",
    url: "https://www.regionofwaterloo.ca/en/health-and-wellness/healthy-babies-healthy-children.aspx",
    region: "Waterloo Region",
    trust_score: 0.93,
    is_247: false,
    created_at: new Date()
  },
  {
    topic: "mental_health",
    type: "hotline",
    name: "Here 24/7 (Waterloo Region)",
    phone: "1-844-437-3247",
    url: "https://here247.ca/",
    region: "Waterloo Region",
    trust_score: 0.96,
    is_247: true,
    created_at: new Date()
  },
  {
    topic: "crisis",
    type: "hotline",
    name: "Front Door – Access to Child and Youth Mental Health Services",
    phone: "519-749-2932",
    url: "https://www.frontdoormentalhealth.com/",
    region: "Kitchener-Waterloo",
    trust_score: 0.90,
    is_247: false,
    created_at: new Date()
  },
  {
    topic: "pelvic_floor",
    type: "physio",
    name: "KW Pelvic Health (Kitchener-Waterloo)",
    phone: "519-208-8788",
    url: "https://www.kwpelvichealth.ca/",
    region: "Kitchener-Waterloo",
    trust_score: 0.89,
    is_247: false,
    created_at: new Date()
  }
]);

"✅ Resources seeded";

// =====================================================
// 4) Observability Queries (for demo screenshots)
// =====================================================

// totals
const counts = {
  users: db.users.estimatedDocumentCount(),
  sessions: db.sessions.estimatedDocumentCount(),
  messages: db.messages.estimatedDocumentCount(),
  resources: db.resources.estimatedDocumentCount(),
};
console.log("Counts:", counts);

// messages by intent
const byIntent = db.messages.aggregate([
  { $match: { intent: { $exists: true } } },
  { $group: { _id: "$intent", count: { $sum: 1 } } },
  { $sort: { count: -1 } },
]).toArray();
console.log("By intent:", byIntent);

// average reply latency (Auntie only)
const avgLatency = db.messages.aggregate([
  { $match: { sender: "auntie", latency_ms: { $exists: true } } },
  { $group: { _id: null, avg_latency_ms: { $avg: "$latency_ms" } } },
]).toArray();
console.log("Avg reply latency:", avgLatency);

// topic heatmap
const topics = db.messages.aggregate([
  { $match: { topic: { $exists: true } } },
  { $group: { _id: "$topic", count: { $sum: 1 } } },
  { $sort: { count: -1 } },
]).toArray();
console.log("Topics heatmap:", topics);

// =====================================================
// 5) Final Output (shows in Results panel)
// =====================================================
({
  users: db.users.find().toArray(),
  sessions: db.sessions.find().toArray(),
  messages: db.messages.find().toArray(),
  resources: db.resources.find().toArray(),
});
