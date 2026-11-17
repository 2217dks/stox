# 🔔 Notification Pipeline

> **Event-driven notifications for stox.**

---

## 📌 Table of Contents

- [Overview](#-overview)
- [Event-Driven Architecture](#-event-driven-architecture)
- [Event Sources](#-event-sources)
- [Delivery Channels](#-delivery-channels)
- [Worker Implementation](#-worker-implementation)
- [Email Templates](#-email-templates)
- [User Preferences](#-user-preferences)

---

## 📖 Overview

stox uses an **event-driven notification pipeline** to alert users about important events:

- Order executions
- Price alert triggers
- Achievement unlocks
- Copy trade executions
- Daily/weekly digests

The pipeline decouples events from delivery, ensuring notifications never block the API and are retried on failure.

---

## ✅ Implementation status

| Piece | Status |
| --- | --- |
| `Notification` row (in-app inbox) | Implemented. The row is written synchronously after the business transaction commits and is the source of truth. |
| `notifications` BullMQ queue | Implemented (`src/queues/notificationQueue.js`). Job: `send-notification`; scheduler: `notifications:scan-pending`. |
| Notification worker | Implemented (`src/workers/notificationQueueWorker.js`). Claims delivery in the database, then delivers through the enabled channels. |
| In-app live delivery | Implemented. Socket.IO `/notifications` namespace; the worker emits to the server-derived `user:{userId}` room. |
| Email delivery | Implemented behind Resend (`src/services/emailService.js`). It is an explicit no-op until `RESEND_API_KEY` and `EMAIL_FROM` are set. |
| Push delivery | Implemented behind FCM HTTP v1 (`src/services/pushService.js`). It is an explicit no-op until the FCM service-account variables are set. |
| Webhook delivery | **Planned**. |
| Domain-event sources | Implemented for order execution/cancellation/rejection/expiry, price alerts, achievement unlocks, new followers, copied-order execution, and completed league results. A scheduled daily digest remains planned. |

Email and push are attempted only when both the user's `UserPreference` switches and the legacy `User` flags/destinations allow them. A `PRICE_ALERT` can additionally carry the alert's own `sendEmail`/`sendPush` flags, which can only narrow delivery.

---

## 🏗️ Event-Driven Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       NOTIFICATION PIPELINE                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. EVENT SOURCES                                                           │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐          │
│  │   Order     │ │   Price     │ │ Achievement │ │   Copy      │          │
│  │  Executed   │ │ Alert Hit   │ │  Unlocked   │ │ Trade Done  │          │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘          │
│         └───────────────┴───────────────┴───────────────┘                  │
│                                   │                                         │
│                                   ▼                                         │
│  2. EVENT BUS (EventEmitter)                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  eventBus.emit('notification', {                                     │   │
│  │    type: 'ORDER_EXECUTED',                                           │   │
│  │    userId: 'uuid',                                                   │   │
│  │    data: { orderId, symbol, price, quantity }                        │   │
│  │  });                                                                 │   │
│  └──────────────────────────┬──────────────────────────────────────────┘   │
│                             │                                              │
│                             ▼                                              │
│  3. NOTIFICATION QUEUE (BullMQ)                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  notificationQueue.add('send-notification', {                        │   │
│  │    userId, type, data                                                │   │
│  │  }, {                                                                │   │
│  │    attempts: 5,                                                      │   │
│  │    backoff: { type: 'exponential', delay: 5000 }                     │   │
│  │  });                                                                 │   │
│  └──────────────────────────┬──────────────────────────────────────────┘   │
│                             │                                              │
│                             ▼                                              │
│  4. NOTIFICATION WORKER                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  1. Fetch user preferences                                           │   │
│  │  2. Check if notification type is enabled                            │   │
│  │  3. Render email template                                            │   │
│  │  4. Send via appropriate channel                                     │   │
│  │  5. Log delivery status                                              │   │
│  └──────────────────────────┬──────────────────────────────────────────┘   │
│                             │                                              │
│                             ▼                                              │
│  5. DELIVERY CHANNELS                                                      │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐          │
│  │   Email     │ │    Push     │ │  In-App     │ │  Webhook    │          │
│  │ (SendGrid)  │ │  (FCM)      │ │ (Socket.IO) │ │  (HTTP)     │          │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📡 Event Sources

| Trigger                                   | Notification Type     | Recipient                          |
| ----------------------------------------- | --------------------- | ---------------------------------- |
| Order executed/cancelled/rejected/expired | matching order type   | Portfolio owner                    |
| Alert transitions from ACTIVE to TRIGGERED | PRICE_ALERT           | Alert owner                        |
| Achievement is newly granted              | ACHIEVEMENT_UNLOCKED  | Awarded user                       |
| Follow relationship is created             | NEW_FOLLOWER          | Followed user                      |
| A copied order executes                    | COPY_TRADE_EXECUTED   | Copier                             |
| League standings are finalized             | LEAGUE_UPDATE         | Ranked participant                 |
| Daily digest                               | SYSTEM                | **Planned; no scheduled producer** |

Each source uses a stable `Notification.eventKey`. The unique database index
makes notification-row creation idempotent across event retries. The queue uses
the notification ID as its job ID, and the worker's conditional delivery claim
prevents duplicate channel delivery. The pending-row scan recovers delivery
when Redis is unavailable.

---

## 📤 Delivery Channels

| Channel     | Provider                 | Use Case                       |
| ----------- | ------------------------ | ------------------------------ |
| **Email**   | SendGrid / Resend        | Alerts, digests, confirmations |
| **Push**    | Firebase Cloud Messaging | Real-time alerts               |
| **In-App**  | Socket.IO                | Live notifications             |
| **Webhook** | Custom HTTP POST         | User-configured integrations   |

---

## 👷 Worker Implementation

> **Actual implementation:** `src/workers/notificationQueueWorker.js` and
> `src/services/notificationDeliveryService.js`. The job payload is
> `{ notificationId }`; the notification row is created by the event source
> before enqueue. Delivery is claimed with a conditional `PENDING -> SENDING`
> update, and the per-channel result is persisted in
> `Notification.deliveryChannels`. The illustrative block below describes the
> original target design, not the current code.

```javascript
// workers/notificationWorker.js
import { Worker } from "bullmq";
import Redis from "ioredis";
import { prisma } from "../lib/prisma.js";
import { sendEmail } from "../services/emailService.js";
import { sendPush } from "../services/pushService.js";
import { renderTemplate } from "../templates/renderer.js";

const connection = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
});

const notificationWorker = new Worker(
    "notifications",
    async (job) => {
        const { userId, type, data } = job.data;

        // 1. Fetch user + preferences
        const user = await prisma.user.findUnique({
            where: { id: userId },
        });
        if (!user) return;

        // 2. Check preferences
        const prefs = {
            email: type === "PRICE_ALERT" ? user.emailAlerts : user.emailDigest,
            push: user.pushEnabled,
        };

        // 3. Render template
        const { subject, html } = renderTemplate(type, { user, ...data });

        // 4. Send via channels
        if (prefs.email && user.email) {
            await sendEmail(user.email, subject, html);
        }

        if (prefs.push && user.pushToken) {
            await sendPush(user.pushToken, {
                title: subject,
                body: html.slice(0, 100),
            });
        }

        // 5. Create in-app notification record
        await prisma.notification.create({
            data: {
                userId,
                type: type,
                title: subject,
                message: typeof data === "string" ? data : JSON.stringify(data),
                data: data,
            },
        });

        // 6. Emit real-time (if user online)
        // io.of('/notifications').to(`user:${userId}`).emit('notification', {...});

        return { delivered: true };
    },
    {
        connection,
        concurrency: 10,
    },
);

export default notificationWorker;
```

---

## 📧 Email Templates

```javascript
// templates/emails/orderExecuted.js
export const orderExecutedTemplate = (data) => ({
    subject: `Order Executed: ${data.side} ${data.symbol}`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    .container { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; }
    .header { background: #1A365D; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background: #f7fafc; }
    .trade-details { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
    .green { color: #48BB78; }
    .red { color: #F56565; }
    .footer { text-align: center; padding: 20px; color: #718096; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📈 stox</h1>
    </div>
    <div class="content">
      <h2>Order Executed</h2>
      <p>Your ${data.side} order for <strong>${data.symbol}</strong> has been executed.</p>
      
      <div class="trade-details">
        <p><strong>Symbol:</strong> ${data.symbol}</p>
        <p><strong>Side:</strong> <span class="${data.side === "BUY" ? "green" : "red"}">${data.side}</span></p>
        <p><strong>Quantity:</strong> ${data.quantity}</p>
        <p><strong>Price:</strong> $${data.price.toFixed(2)}</p>
        <p><strong>Total Value:</strong> $${(data.quantity * data.price).toFixed(2)}</p>
        <p><strong>Time:</strong> ${new Date(data.executedAt).toLocaleString()}</p>
      </div>
      
      <a href="${process.env.CLIENT_URL}/portfolio" 
         style="background: #1A365D; color: white; padding: 12px 24px; 
                text-decoration: none; border-radius: 6px; display: inline-block;">
        View Portfolio
      </a>
    </div>
    <div class="footer">
      <p>You're receiving this because you have email alerts enabled.</p>
      <a href="${process.env.CLIENT_URL}/settings/notifications">Manage Preferences</a>
    </div>
  </div>
</body>
</html>
`,
});
```

```javascript
// templates/renderer.js
import { orderExecutedTemplate } from "./emails/orderExecuted.js";
import { priceAlertTemplate } from "./emails/priceAlert.js";
import { achievementTemplate } from "./emails/achievement.js";
import { dailyDigestTemplate } from "./emails/dailyDigest.js";

export function renderTemplate(type, data) {
    switch (type) {
        case "ORDER_EXECUTED":
            return orderExecutedTemplate(data);
        case "PRICE_ALERT":
            return priceAlertTemplate(data);
        case "ACHIEVEMENT_UNLOCKED":
            return achievementTemplate(data);
        case "SYSTEM":
            return dailyDigestTemplate(data);
        default:
            return {
                subject: "Notification from stox",
                html: `<p>${JSON.stringify(data)}</p>`,
            };
    }
}
```

---

## ⚙️ User Preferences

The settings API stores two switches on `UserPreference`:

```prisma
model UserPreference {
  id                 String  @id @default(cuid())
  userId             String  @unique
  emailNotifications Boolean @default(true)
  pushNotifications  Boolean @default(true)
}
```

Delivery requires both the `UserPreference` switch and the matching legacy
`User` flag/destination to allow it:

- email: `emailNotifications` AND `user.emailAlerts` AND `user.email`
- push: `pushNotifications` AND `user.pushEnabled` AND `user.pushToken`

The legacy `User` fields remain for accounts that predate the preferences
table:

```prisma
model User {
  // ...
  emailAlerts     Boolean   @default(true)
  emailDigest     Boolean   @default(true)
  pushEnabled     Boolean   @default(false)
  pushToken       String?
}
```

**Preferences UI:**

- Email Alerts (order executions, price alerts)
- Email Digest (daily/weekly summaries)
- Push Notifications (requires browser permission)

**Unsubscribe handling:**

- All emails include a "Manage Preferences" link
- Unsubscribe sets `emailAlerts` / `emailDigest` to `false`
