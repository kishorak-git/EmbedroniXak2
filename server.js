require("dotenv").config();

const fetch = require("node-fetch");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const app = express();

/* =========================================
   CONFIG
========================================= */

const PORT = process.env.PORT || 3000;
const ESP_IP = process.env.ESP_IP || "10.159.76.240";
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";

/* =========================================
   FIREBASE INIT
========================================= */

const keyFile = fs.readdirSync(__dirname).find(file =>
  file.includes("firebase-adminsdk") && file.endsWith(".json")
);

if (!keyFile) {
  console.log("⚠️ Firebase JSON not found");
} else {
  const serviceAccount = require(path.join(__dirname, keyFile));

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id
    });
  }

  console.log("🔥 Firebase Connected");
}

const db = admin.apps.length ? admin.firestore() : null;

if (db) {
  db.settings({
    ignoreUndefinedProperties: true
  });
}

/* =========================================
   MIDDLEWARE
========================================= */

app.use(cors());
app.use(express.json());

/* =========================================
   HEALTH CHECK
========================================= */

app.get("/", (req, res) => {
  res.send("🚀 Backend Running");
});

/* =========================================
   MANUAL ESP TEST
   Browser:
   /trigger?time=60
========================================= */

app.get("/trigger", async (req, res) => {
  try {
    const time = req.query.time || 10;

    const url = `http://${ESP_IP}/relay?time=${time}`;

    console.log("🔌 Triggering ESP:", url);

    const response = await fetch(url, { timeout: 8000 });
    const text = await response.text();

    res.send(`ESP Response: ${text}`);
  } catch (err) {
    res.status(500).send("ESP Failed: " + err.message);
  }
});

/* =========================================
   RAZORPAY WEBHOOK
========================================= */

app.post(
  "/razorpay-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      if (!WEBHOOK_SECRET) {
        console.log("⚠️ Webhook secret missing");
        return res.status(500).send("Webhook secret missing");
      }

      const signature = req.headers["x-razorpay-signature"];

      const digest = crypto
        .createHmac("sha256", WEBHOOK_SECRET)
        .update(req.body)
        .digest("hex");

      if (digest !== signature) {
        console.log("❌ Invalid Signature");
        return res.status(400).send("Invalid Signature");
      }

      const data = JSON.parse(req.body.toString());
      const payment = data.payload.payment.entity;

      const amount = payment.amount / 100;
      const email = payment.email;

      console.log("💰 Payment Success:", amount);

      /* SAVE FIRESTORE */

      if (db && email) {
        try {
          await db.collection("payments").add({
            email,
            amount,
            paymentId: payment.id,
            createdAt: new Date().toISOString()
          });

          console.log("✅ Saved to Firestore");
        } catch (e) {
          console.log("⚠️ Firestore Save Failed");
        }
      }

      /* DURATION MAP */

      let duration = 0;

      if (amount == 10) duration = 10;
      else if (amount == 25) duration = 30;
      else if (amount == 50) duration = 60;

      if (duration > 0) {
        try {
          const url = `http://${ESP_IP}/relay?time=${duration}`;

          console.log("🔌 Triggering:", url);

          await fetch(url, { timeout: 8000 });

          console.log("🚀 ESP Triggered");
        } catch (e) {
          console.log("❌ ESP Trigger Failed");
        }
      }

      res.send("Webhook Success");
    } catch (err) {
      console.log("💥 Webhook Error:", err.message);
      res.status(500).send("Webhook Failed");
    }
  }
);

/* =========================================
   START SERVER
========================================= */

app.listen(PORT, () => {
  console.log(`🔥 Server running on port ${PORT}`);
  console.log(`🌐 Test Link: http://localhost:${PORT}/trigger?time=10`);
});
