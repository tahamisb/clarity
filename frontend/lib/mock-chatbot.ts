export const CHATBOT_STATS = {
  totalConversations: "14,285",
  totalConversationsChange: "+12.4%",
  containmentRate: "68.2%",
  containmentRateChange: "+5.1%",
  fallbackRate: "31.8%",
  fallbackRateChange: "-5.1%",
  avgTurns: "4.2",
  avgTurnsChange: "-0.8",
  testAccuracy: "84%",
  testAccuracyChange: "+2.0%",
};

export const TOP_QUESTION_TYPES = [
  {
    id: "order_status",
    rank: 1,
    name: "Order Status Query",
    example: '"Where is my order?" / "أين طلبي؟"',
    volumePct: "35%",
    accuracy: "92%",
    avgTurns: "3.5",
    status: "Covered"
  },
  {
    id: "cancellation",
    rank: 2,
    name: "Cancellation Request",
    example: '"I want to cancel my order" / "أبي ألغي الطلب"',
    volumePct: "22%",
    accuracy: "88%",
    avgTurns: "4.1",
    status: "Covered"
  },
  {
    id: "wrong_item",
    rank: 3,
    name: "Wrong Item Received",
    example: '"I got the wrong item" / "وصلني غلط"',
    volumePct: "18%",
    accuracy: "81%",
    avgTurns: "5.2",
    status: "Covered"
  },
  {
    id: "refund_status",
    rank: 4,
    name: "Refund Status",
    example: '"When will I get my refund?" / "متى يرجع فلوسي؟"',
    volumePct: "14%",
    accuracy: "74%",
    avgTurns: "4.8",
    status: "Covered"
  },
  {
    id: "late_delivery",
    rank: 5,
    name: "Late Delivery",
    example: '"My order is late" / "طلبي متأخر"',
    volumePct: "11%",
    accuracy: "86%",
    avgTurns: "4.5",
    status: "Covered"
  }
];

export const CONVERSATION_FLOWS: Record<string, { happy: any[], escalation: any[] }> = {
  "order_status": {
    happy: [
      { sender: "bot", text: "مرحباً! كيف يمكنني مساعدتك؟", time: "10:00 AM" },
      { sender: "customer", text: "متابعة حالة الطلب", time: "10:01 AM" },
      { sender: "system", text: "→ Checking order status...", time: "10:01 AM" },
      { sender: "bot", text: "جاري التحقق من طلبك رقم #66713614...", time: "10:01 AM" },
      { sender: "bot", text: "طلبك في الطريق إليك — السائق على بُعد 8 دقائق 🛵", time: "10:01 AM" },
      { sender: "customer", text: "شكراً", time: "10:02 AM" },
      { sender: "bot", text: "العفو! هل هناك أي شيء آخر يمكنني مساعدتك به؟", time: "10:02 AM" }
    ],
    escalation: [
      { sender: "bot", text: "Hi! How can I help you today?", time: "11:15 AM" },
      { sender: "customer", text: "Where is my order?", time: "11:16 AM" },
      { sender: "system", text: "→ Checking order status...", time: "11:16 AM" },
      { sender: "bot", text: "It looks like your order #88219 is out for delivery. The driver should arrive in 5 minutes.", time: "11:16 AM" },
      { sender: "customer", text: "The driver is not moving on the map and his phone is off", time: "11:17 AM" },
      { sender: "system", text: "→ Confidence drops below 0.6", time: "11:17 AM" },
      { sender: "system", text: "→ Escalating to live agent", time: "11:17 AM" },
      { sender: "bot", text: "I apologize for the inconvenience. Let me transfer you to a live agent who can contact the driver directly.", time: "11:17 AM" }
    ]
  },
  "cancellation": {
    happy: [
      { sender: "bot", text: "Hi! How can I help you?", time: "09:20 AM" },
      { sender: "customer", text: "I need to cancel my order", time: "09:21 AM" },
      { sender: "system", text: "→ Checking order status...", time: "09:21 AM" },
      { sender: "bot", text: "I can help with that. Your order from 'Al Baik' is still being prepared. Would you like to proceed with the cancellation?", time: "09:21 AM" },
      { sender: "customer", text: "Yes please", time: "09:22 AM" },
      { sender: "system", text: "→ Processing cancellation...", time: "09:22 AM" },
      { sender: "bot", text: "Your order has been successfully cancelled. A full refund will be processed to your original payment method.", time: "09:22 AM" }
    ],
    escalation: [
      { sender: "bot", text: "مرحباً! كيف يمكنني مساعدتك؟", time: "08:10 PM" },
      { sender: "customer", text: "أبي ألغي الطلب", time: "08:11 PM" },
      { sender: "system", text: "→ Checking order status...", time: "08:11 PM" },
      { sender: "bot", text: "طلبك من 'ماكدونالدز' مع السائق حالياً وفي طريقه إليك. لا يمكنني إلغاء الطلب في هذه المرحلة.", time: "08:11 PM" },
      { sender: "customer", text: "بس أنا حطيت عنوان غلط وابي الغيه الحين ضروري", time: "08:12 PM" },
      { sender: "system", text: "→ Escalating to live agent", time: "08:12 PM" },
      { sender: "bot", text: "عذراً، سأقوم بتحويلك إلى أحد ممثلي خدمة العملاء لمساعدتك في هذا الأمر فوراً.", time: "08:12 PM" }
    ]
  },
  "wrong_item": {
    happy: [
      { sender: "bot", text: "Hi! How can I help?", time: "02:00 PM" },
      { sender: "customer", text: "I got the wrong item in my order", time: "02:01 PM" },
      { sender: "bot", text: "I'm sorry to hear that! Could you please upload a photo of the item you received and the receipt?", time: "02:01 PM" },
      { sender: "customer", text: "[Image Uploaded]", time: "02:03 PM" },
      { sender: "system", text: "→ Analyzing image...", time: "02:03 PM" },
      { sender: "bot", text: "Thank you. I have verified the issue. Would you prefer a refund for the missing item or a replacement?", time: "02:03 PM" },
      { sender: "customer", text: "Refund to wallet please", time: "02:04 PM" },
      { sender: "system", text: "→ Processing refund...", time: "02:04 PM" },
      { sender: "bot", text: "Done! The amount has been credited to your Clarity Wallet.", time: "02:04 PM" }
    ],
    escalation: [
      { sender: "bot", text: "مرحباً! كيف يمكنني مساعدتك؟", time: "03:30 PM" },
      { sender: "customer", text: "وصلني غلط الطلب كله حق شخص ثاني", time: "03:31 PM" },
      { sender: "bot", text: "أعتذر عن ذلك! هل يمكنك إرسال صورة للطلب الذي استلمته مع الفاتورة؟", time: "03:31 PM" },
      { sender: "customer", text: "مافي فاتورة على الكيس اصلا", time: "03:32 PM" },
      { sender: "system", text: "→ Out of scope / Missing requirement", time: "03:32 PM" },
      { sender: "system", text: "→ Escalating to live agent", time: "03:32 PM" },
      { sender: "bot", text: "فهمت. سأقوم بتحويلك إلى فريق الدعم لمعالجة هذه المشكلة على الفور.", time: "03:32 PM" }
    ]
  },
  "refund_status": {
    happy: [
      { sender: "bot", text: "Hi! How can I help you?", time: "05:45 PM" },
      { sender: "customer", text: "When will I get my refund for cancelled order?", time: "05:46 PM" },
      { sender: "system", text: "→ Checking refund status...", time: "05:46 PM" },
      { sender: "bot", text: "Let me check... Your refund of 85 QAR for order #44512 was processed on our end on Oct 12th. It typically takes 3-5 business days to reflect in your bank account.", time: "05:46 PM" },
      { sender: "customer", text: "Okay, thanks", time: "05:47 PM" },
      { sender: "bot", text: "You're welcome! Let me know if you need anything else.", time: "05:47 PM" }
    ],
    escalation: [
      { sender: "bot", text: "مرحباً! كيف يمكنني مساعدتك؟", time: "01:10 PM" },
      { sender: "customer", text: "متى يرجع فلوسي؟ صار لي اسبوعين انتظر", time: "01:11 PM" },
      { sender: "system", text: "→ Checking refund status... > 7 days old", time: "01:11 PM" },
      { sender: "system", text: "→ Requires agent lookup", time: "01:11 PM" },
      { sender: "system", text: "→ Escalating to live agent", time: "01:11 PM" },
      { sender: "bot", text: "أعتذر عن هذا التأخير. نظراً لمرور أكثر من 7 أيام، سأقوم بتحويلك لممثل خدمة العملاء للتحقق من الأمر مع البنك.", time: "01:11 PM" }
    ]
  },
  "late_delivery": {
    happy: [
      { sender: "bot", text: "Hi! How can I help?", time: "07:20 PM" },
      { sender: "customer", text: "My order is very late", time: "07:21 PM" },
      { sender: "system", text: "→ Checking order status...", time: "07:21 PM" },
      { sender: "bot", text: "I apologize for the delay. The restaurant took longer than expected to prepare your food. The driver is now on the way and should be there in 12 minutes.", time: "07:21 PM" },
      { sender: "customer", text: "Okay", time: "07:22 PM" }
    ],
    escalation: [
      { sender: "bot", text: "مرحباً! كيف يمكنني مساعدتك؟", time: "09:40 PM" },
      { sender: "customer", text: "طلبي متأخر ساعه كاملة", time: "09:41 PM" },
      { sender: "system", text: "→ Checking order status...", time: "09:41 PM" },
      { sender: "bot", text: "أعتذر بشدة عن هذا التأخير. السائق في الطريق إليك الآن.", time: "09:41 PM" },
      { sender: "customer", text: "مابي الطلب خلاص الغيه ورجع فلوسي", time: "09:42 PM" },
      { sender: "system", text: "→ Multi-issue / Frustration detected", time: "09:42 PM" },
      { sender: "system", text: "→ Escalating to live agent", time: "09:42 PM" },
      { sender: "bot", text: "أتفهم انزعاجك تماماً. سأقوم بتحويلك إلى المشرف لاتخاذ اللازم فوراً.", time: "09:42 PM" }
    ]
  }
};

export const EVALUATION_RESULTS = [
  { name: "Correctly Handled", value: 42, fill: "var(--positive)" },
  { name: "Escalated Correctly", value: 4, fill: "var(--accent)" },
  { name: "Incorrect Response", value: 4, fill: "var(--destructive)" },
];

export const ACCURACY_TABLE = [
  { type: "Order Status Query", tested: 12, correct: 11, escalated: 1, failed: 0, accuracy: "92%" },
  { type: "Cancellation Request", tested: 10, correct: 9, escalated: 0, failed: 1, accuracy: "90%" },
  { type: "Late Delivery", tested: 10, correct: 8, escalated: 1, failed: 1, accuracy: "80%" },
  { type: "Wrong Item Received", tested: 9, correct: 7, escalated: 1, failed: 1, accuracy: "78%" },
  { type: "Refund Status", tested: 9, correct: 7, escalated: 1, failed: 1, accuracy: "74%" },
];

export const FALLBACK_TOPICS = [
  { name: "Duplicate charge queries", count: 145, pct: "18%" },
  { name: "Address change after order", count: 122, pct: "15%" },
  { name: "Refund from previous week", count: 110, pct: "14%" },
  { name: "Merchant-specific complaint", count: 98, pct: "12%" },
  { name: "Account suspension query", count: 85, pct: "11%" },
  { name: "Promo code not applied", count: 76, pct: "9%" },
  { name: "Driver behaviour complaint", count: 64, pct: "8%" },
  { name: "Delivery to wrong address", count: 42, pct: "5%" },
];

export const FALLBACK_QUESTIONS = [
  {
    text: "The driver left my food at the wrong building, what should I do?",
    count: 34,
    reason: "Multi-issue query / Driver complaint"
  },
  {
    text: "خصموا مني مرتين على نفس الطلب",
    count: 28,
    reason: "Requires billing account lookup"
  },
  {
    text: "Can I change my delivery address to West Bay?",
    count: 25,
    reason: "Order already dispatched - out of scope"
  },
  {
    text: "الكود حق الخصم ما يشتغل معي ليش",
    count: 21,
    reason: "Promo system API not connected to bot"
  },
  {
    text: "Why is my account blocked from cash on delivery?",
    count: 18,
    reason: "Account suspension query"
  }
];

export const RECENT_SESSIONS = [
  {
    id: "S-8821",
    customerId: "USR-09211",
    intent: "Order Status Query",
    language: "EN",
    turns: 4,
    outcome: "contained",
    confidence: "94%",
    datetime: "Today, 14:22"
  },
  {
    id: "S-8822",
    customerId: "USR-77312",
    intent: "Cancellation Request",
    language: "AR",
    turns: 5,
    outcome: "contained",
    confidence: "88%",
    datetime: "Today, 14:18"
  },
  {
    id: "S-8823",
    customerId: "USR-11029",
    intent: "Late Delivery",
    language: "AR",
    turns: 6,
    outcome: "escalated",
    confidence: "58%",
    datetime: "Today, 14:10"
  },
  {
    id: "S-8824",
    customerId: "USR-55421",
    intent: "Refund Status",
    language: "EN",
    turns: 3,
    outcome: "contained",
    confidence: "91%",
    datetime: "Today, 13:55"
  },
  {
    id: "S-8825",
    customerId: "USR-99213",
    intent: "Promo Code Issue",
    language: "AR",
    turns: 2,
    outcome: "escalated",
    confidence: "42%",
    datetime: "Today, 13:42"
  },
  {
    id: "S-8826",
    customerId: "USR-33211",
    intent: "Wrong Item Received",
    language: "EN",
    turns: 7,
    outcome: "contained",
    confidence: "85%",
    datetime: "Today, 13:30"
  },
  {
    id: "S-8827",
    customerId: "USR-44122",
    intent: "Order Status Query",
    language: "AR",
    turns: 3,
    outcome: "contained",
    confidence: "96%",
    datetime: "Today, 13:15"
  },
  {
    id: "S-8828",
    customerId: "USR-11299",
    intent: "Duplicate Charge",
    language: "EN",
    turns: 4,
    outcome: "failed",
    confidence: "22%",
    datetime: "Today, 12:50"
  },
  {
    id: "S-8829",
    customerId: "USR-88211",
    intent: "Late Delivery",
    language: "AR",
    turns: 4,
    outcome: "contained",
    confidence: "89%",
    datetime: "Today, 12:45"
  },
  {
    id: "S-8830",
    customerId: "USR-55219",
    intent: "Cancellation Request",
    language: "EN",
    turns: 5,
    outcome: "contained",
    confidence: "92%",
    datetime: "Today, 12:30"
  },
  {
    id: "S-8831",
    customerId: "USR-77321",
    intent: "Refund Status",
    language: "AR",
    turns: 5,
    outcome: "escalated",
    confidence: "51%",
    datetime: "Today, 12:15"
  },
  {
    id: "S-8832",
    customerId: "USR-99122",
    intent: "Order Status Query",
    language: "EN",
    turns: 3,
    outcome: "contained",
    confidence: "97%",
    datetime: "Today, 12:05"
  }
];
