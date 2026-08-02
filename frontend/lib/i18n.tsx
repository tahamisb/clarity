"use client"

// ---------------------------------------------------------------------------
// Lightweight i18n layer for the dashboard.
//
// The active language lives in the app settings (see settings-context.tsx) and
// is toggled from Settings → Appearance → Language. Selecting Arabic also flips
// the whole document to right-to-left (handled in SettingsProvider).
//
// Usage:
//   const t = useT()
//   t("nav.settings")                       // → "Settings" | "الإعدادات"
//   t("set.slaBreachDesc", { chat: 4 })     // interpolates {chat}
//
// Keys are semantic and namespaced ("nav.*", "top.*", "set.*", …). A missing
// key falls back to the key itself, so partially-translated surfaces stay
// readable rather than blowing up.
// ---------------------------------------------------------------------------

import { useCallback } from "react"
import { useSettings } from "./settings-context"

export type Lang = "en" | "ar"

type Entry = { en: string; ar: string }
type Dict = Record<string, Entry>

export const translations: Dict = {
  // — Navigation / sidebar ————————————————————————————————————————————————
  "nav.modules": { en: "Modules", ar: "الوحدات" },
  "nav.cxDashboard": { en: "CX Dashboard", ar: "لوحة تجربة العملاء" },
  "nav.chatbot": { en: "Chatbot", ar: "روبوت الدردشة" },
  "nav.chatbotUnavailable": {
    en: "Chatbot is temporarily unavailable",
    ar: "روبوت الدردشة غير متاح مؤقتاً",
  },
  "nav.soon": { en: "Soon", ar: "قريباً" },
  "nav.callIntelligence": { en: "Call Intelligence", ar: "تحليل المكالمات" },
  "nav.overview": { en: "Overview", ar: "نظرة عامة" },
  "nav.callLogs": { en: "Call Logs", ar: "سجلات المكالمات" },
  "nav.pipeline": { en: "Pipeline", ar: "مسار المعالجة" },
  "nav.intents": { en: "Intents", ar: "النوايا" },
  "nav.coverage": { en: "Coverage", ar: "التغطية" },
  "nav.reports": { en: "Reports", ar: "التقارير" },
  "nav.supportMessages": { en: "Support Messages", ar: "رسائل الدعم" },
  "nav.cancellations": { en: "Cancellations", ar: "الإلغاءات" },
  "nav.settings": { en: "Settings", ar: "الإعدادات" },
  "nav.help": { en: "Help", ar: "المساعدة" },

  // — Top bar ——————————————————————————————————————————————————————————————
  "top.brand": { en: "Clarity", ar: "Clarity" },
  "top.searchCalls": { en: "Search calls…", ar: "البحث في المكالمات…" },
  "top.search": { en: "Search…", ar: "بحث…" },
  "top.searchMessages": { en: "Search messages…", ar: "البحث في الرسائل…" },
  "top.searchOrders": { en: "Search orders…", ar: "البحث في الطلبات…" },
  "top.searchAria": {
    en: "Search calls by ID, agent or city",
    ar: "ابحث في المكالمات حسب المعرّف أو الموظّف أو المدينة",
  },
  "top.clearSearch": { en: "Clear search", ar: "مسح البحث" },
  "search.searching": { en: "Searching…", ar: "جاري البحث…" },
  "search.noResults": { en: "No matches found", ar: "لا توجد نتائج" },
  "search.resultsCount": { en: "{n} result(s)", ar: "{n} نتيجة" },
  "search.more": { en: "+{n} more — refine your search", ar: "+{n} أخرى — حسّن بحثك" },
  "top.accountMenu": { en: "Account menu", ar: "قائمة الحساب" },
  "top.signedIn": { en: "Signed in", ar: "مسجّل الدخول" },
  "top.signOut": { en: "Sign out", ar: "تسجيل الخروج" },
  "top.authBypassed": { en: "Auth bypassed", ar: "تم تجاوز المصادقة" },
  "top.authBypassedTitle": {
    en: "Authentication is temporarily bypassed (NEXT_PUBLIC_AUTH_BYPASS). See AUTH_SETUP.md.",
    ar: "المصادقة متجاوَزة مؤقتاً (NEXT_PUBLIC_AUTH_BYPASS). راجع AUTH_SETUP.md.",
  },

  // — Common ————————————————————————————————————————————————————————————————
  "common.workInProgress": { en: "Work in progress", ar: "قيد الإنجاز" },

  // — Roles ————————————————————————————————————————————————————————————————
  "role.employee": { en: "Employee", ar: "موظّف" },
  "role.manager": { en: "Manager", ar: "مدير" },

  // — Settings: header ————————————————————————————————————————————————————
  "set.title": { en: "Settings", ar: "الإعدادات" },
  "set.subtitle": {
    en: "Configure appearance, SLAs, alerting, the ML classifier, and integrations.",
    ar: "تهيئة المظهر، واتفاقيات مستوى الخدمة، والتنبيهات، ومصنّف التعلّم الآلي، والتكاملات.",
  },
  "set.save": { en: "Save changes", ar: "حفظ التغييرات" },
  "set.saved": { en: "Saved", ar: "تم الحفظ" },

  // — Settings: appearance ————————————————————————————————————————————————
  "set.appearance": { en: "Appearance", ar: "المظهر" },
  "set.theme": { en: "Theme", ar: "السمة" },
  "set.themeDesc": {
    en: "Switch between light and dark, or follow your device. System matches your OS setting automatically.",
    ar: "بدّل بين الوضع الفاتح والداكن، أو اتبع جهازك. يطابق وضع «النظام» إعداد نظام التشغيل تلقائياً.",
  },
  "set.language": { en: "Language", ar: "اللغة" },
  "set.languageDesc": {
    en: "Dashboard localization. Arabic switches the interface to right-to-left.",
    ar: "ترجمة لوحة التحكم. تُحوِّل العربيةُ الواجهةَ إلى الاتجاه من اليمين إلى اليسار.",
  },

  // — Settings: live data ————————————————————————————————————————————————
  "set.liveData": {
    en: "Live Data & Auto-Refresh",
    ar: "البيانات المباشرة والتحديث التلقائي",
  },
  "set.refreshInterval": {
    en: "Auto-refresh interval",
    ar: "فترة التحديث التلقائي",
  },
  "set.refreshIntervalDesc": {
    en: "How often Call Intelligence, Support Messages and Cancellations re-fetch their data from the backend in the background. Set to Off to refresh manually only.",
    ar: "عدد مرات إعادة جلب تحليل المكالمات ورسائل الدعم والإلغاءات لبياناتها من الخادم في الخلفية. اختر «إيقاف» للتحديث يدوياً فقط.",
  },
  "refresh.0": { en: "Off", ar: "إيقاف" },
  "refresh.30": { en: "30s", ar: "٣٠ ثانية" },
  "refresh.60": { en: "1 min", ar: "دقيقة واحدة" },
  "refresh.120": { en: "2 min", ar: "دقيقتان" },
  "refresh.300": { en: "5 min", ar: "٥ دقائق" },
  "refresh.600": { en: "10 min", ar: "١٠ دقائق" },

  // — Settings: SLA & alerts ——————————————————————————————————————————————
  "set.slaAlerts": {
    en: "SLA & Alert Configurations",
    ar: "اتفاقيات مستوى الخدمة وإعدادات التنبيهات",
  },
  "set.customSla": { en: "Custom SLA Targets", ar: "أهداف مستوى الخدمة المخصّصة" },
  "set.customSlaDesc": {
    en: "Define target resolution times. Visual breach indicators appear on the dashboards as teams near these limits.",
    ar: "حدّد أوقات الحل المستهدفة. تظهر مؤشرات تجاوزٍ مرئية على لوحات التحكم كلما اقتربت الفرق من هذه الحدود.",
  },
  "set.chat": { en: "Chat", ar: "الدردشة" },
  "set.general": { en: "General", ar: "عام" },
  "set.hoursSuffix": { en: "h", ar: "س" },
  "set.cancelThreshold": {
    en: "Cancellation alert threshold",
    ar: "حدّ تنبيه الإلغاء",
  },
  "set.cancelThresholdDesc": {
    en: "Show an alert on the Cancellations dashboard (and notify the channels below) when the cancellation rate in any zone exceeds this percentage.",
    ar: "إظهار تنبيه على لوحة الإلغاءات (وإشعار القنوات أدناه) عندما تتجاوز نسبة الإلغاء في أي منطقة هذه النسبة المئوية.",
  },
  "set.sentimentSpike": {
    en: "Sentiment spike threshold",
    ar: "حدّ ارتفاع المشاعر السلبية",
  },
  "set.sentimentSpikeDesc": {
    en: "Alert on the Support Messages dashboard when negative sentiment jumps week-over-week by more than this many points.",
    ar: "تنبيه على لوحة رسائل الدعم عندما ترتفع المشاعر السلبية من أسبوع لآخر بأكثر من هذا العدد من النقاط.",
  },
  "set.ptsSuffix": { en: "pts", ar: "نقطة" },
  "set.alertChannels": { en: "Alert channels", ar: "قنوات التنبيه" },
  "set.alertChannelsDesc": {
    en: "Which channels the threshold alerts above are delivered to.",
    ar: "القنوات التي تُسلَّم إليها تنبيهات الحدود أعلاه.",
  },
  "set.slack": { en: "Slack", ar: "سلاك" },
  "set.email": { en: "Email", ar: "البريد الإلكتروني" },

  // — Settings: notifications ——————————————————————————————————————————————
  "set.notifications": { en: "Notifications", ar: "الإشعارات" },
  "set.notifIntro": {
    en: "Choose what appears in the notification panel (the bell in the top bar). You are signed in as",
    ar: "اختر ما يظهر في لوحة الإشعارات (الجرس في الشريط العلوي). أنت مسجّل الدخول بصفة",
  },
  "set.notifIntroManager": {
    en: "— you receive every alert type below.",
    ar: "— وتتلقّى جميع أنواع التنبيهات أدناه.",
  },
  "set.notifIntroEmployee": {
    en: "— agent-helpfulness alerts are reserved for managers.",
    ar: "— تنبيهات مدى فائدة الموظّف مخصّصة للمديرين.",
  },
  "set.slaBreach": { en: "SLA breach alerts", ar: "تنبيهات تجاوز مستوى الخدمة" },
  "set.slaBreachDesc": {
    en: "Notify when an unresolved support message passes its SLA target — {chat}h for chat (App / WhatsApp) and {general}h for tickets. Driven strictly by the SLA targets above; adjust them to change when these fire.",
    ar: "إشعار عند تجاوز رسالة دعم غير محلولة لهدف مستوى الخدمة الخاص بها — {chat} ساعة للدردشة (التطبيق / واتساب) و{general} ساعة للتذاكر. يعتمد كلياً على أهداف مستوى الخدمة أعلاه؛ عدّلها لتغيير وقت إطلاقها.",
  },
  "set.highRisk": {
    en: "High-risk cancellation alerts",
    ar: "تنبيهات الإلغاء عالي الخطورة",
  },
  "set.highRiskDesc": {
    en: "Notify when Gemini / the model classifies a live order as high-risk for cancellation, so it can be saved before it drops.",
    ar: "إشعار عندما يصنّف النموذج طلباً مباشراً على أنه عالي الخطورة للإلغاء، حتى يمكن إنقاذه قبل فقدانه.",
  },
  "set.helpfulness": {
    en: "Agent helpfulness alerts",
    ar: "تنبيهات مدى فائدة الموظّف",
  },
  "set.managerOnly": { en: "Manager only", ar: "للمديرين فقط" },
  "set.managerOnlyTitle": {
    en: "Available to managers only",
    ar: "متاح للمديرين فقط",
  },
  "set.helpfulnessDesc": {
    en: "Notify when a call's agent helpfulness is rated poorly (Unhelpful), naming the agent so their handling can be reviewed.",
    ar: "إشعار عند تقييم فائدة موظّف المكالمة بأنها ضعيفة (غير مفيد)، مع ذكر اسم الموظّف لمراجعة طريقة تعامله.",
  },

  // — Settings: ML tuning ————————————————————————————————————————————————
  "set.mlTuning": {
    en: "ML Model Tuning & Simulator",
    ar: "ضبط نموذج التعلّم الآلي والمحاكي",
  },
  "set.mlWipNote": {
    en: "Confidence tuning and the keyword → intent simulator are under active development.",
    ar: "ضبط الثقة ومحاكي «الكلمة المفتاحية ← النية» قيد التطوير النشط.",
  },
  "set.confidence": { en: "Confidence threshold", ar: "حدّ الثقة" },
  "set.confidenceDesc": {
    en: "Cutoff used to flag “Live High-Risk Orders” on the Cancellations page. Higher values surface fewer, higher-confidence orders.",
    ar: "الحدّ المستخدم لتمييز «الطلبات المباشرة عالية الخطورة» في صفحة الإلغاءات. تُظهر القيم الأعلى طلبات أقل وأعلى ثقة.",
  },
  "set.confidenceMore": { en: "50% · more flags", ar: "٥٠٪ · مزيد من التنبيهات" },
  "set.confidenceHigh": { en: "90% · high precision", ar: "٩٠٪ · دقة عالية" },
  "set.keywordIntent": {
    en: "Keyword → Intent mapping",
    ar: "ربط الكلمة المفتاحية بالنية",
  },
  "set.keywordIntentDesc": {
    en: "Customize how the NLP engine maps incoming customer keywords to support intents.",
    ar: "خصّص كيفية ربط محرك معالجة اللغة للكلمات المفتاحية الواردة من العملاء بنوايا الدعم.",
  },
  "set.removeMapping": { en: "Remove mapping", ar: "إزالة الربط" },
  "set.keywordPlaceholder": { en: "customer keyword", ar: "كلمة العميل المفتاحية" },
  "set.intentPlaceholder": { en: "intent label", ar: "تسمية النية" },
  "set.add": { en: "Add", ar: "إضافة" },

  // — Settings: integrations ——————————————————————————————————————————————
  "set.integrations": {
    en: "Data Connections & Integrations",
    ar: "اتصالات البيانات والتكاملات",
  },
  "set.integrationsWipNote": {
    en: "Connecting external data sources and integrations is coming soon.",
    ar: "ربط مصادر البيانات الخارجية والتكاملات قادم قريباً.",
  },
  "integ.dispatch": { en: "Delivery Dispatch System", ar: "نظام إرسال التوصيل" },
  "integ.dispatchDesc": {
    en: "Correlate driver delays with cancellations",
    ar: "ربط تأخّر السائقين بالإلغاءات",
  },
  "integ.crm": { en: "Zendesk / Salesforce", ar: "Zendesk / Salesforce" },
  "integ.crmDesc": {
    en: "Sync inbound support messages & tickets",
    ar: "مزامنة رسائل وتذاكر الدعم الواردة",
  },
  "integ.customerDb": { en: "Customer Database", ar: "قاعدة بيانات العملاء" },
  "integ.customerDbDesc": {
    en: "Enrich profiles, order history & zones",
    ar: "إثراء الملفات وسجل الطلبات والمناطق",
  },
  "integ.connected": { en: "Connected", ar: "متصل" },
  "integ.notConnected": { en: "Not connected", ar: "غير متصل" },
  "integ.configure": { en: "Configure", ar: "تهيئة" },
  "integ.connect": { en: "Connect", ar: "ربط" },

  "set.footer": { en: "Clarity Analytics · Settings", ar: "تحليلات Clarity · الإعدادات" },

  // — Shared: columns / table chrome ——————————————————————————————————————
  "table.clearFilters": { en: "Clear filters", ar: "مسح الفلاتر" },
  "table.exportNegative": { en: "Export negative customers", ar: "تصدير العملاء السلبيين" },
  "table.exportNegativeTitle": { en: "Download a CSV of every customer with negative sentiment in the selected window — for marketing coupon campaigns.", ar: "تنزيل ملف CSV بكل عميل ذي مشاعر سلبية في النطاق المحدد — لحملات كوبونات التسويق." },
  "table.view": { en: "View", ar: "عرض" },
  "table.noCalls": { en: "No calls", ar: "لا مكالمات" },
  "table.noMessages": { en: "No messages", ar: "لا رسائل" },
  "col.callId": { en: "Call ID", ar: "معرّف المكالمة" },
  "col.dateTime": { en: "Date & Time", ar: "التاريخ والوقت" },
  "col.duration": { en: "Dur.", ar: "المدة" },
  "col.agent": { en: "Agent", ar: "الموظف" },
  "col.city": { en: "City", ar: "المدينة" },
  "col.category": { en: "Category", ar: "الفئة" },
  "col.sentiment": { en: "Sentiment", ar: "المشاعر" },
  "col.helpfulness": { en: "Agent Helpfulness", ar: "مدى فائدة الموظف" },
  "col.customerMood": { en: "Customer Mood", ar: "مزاج العميل" },
  "col.confidence": { en: "Conf.", ar: "الثقة" },
  "col.intent": { en: "Intent", ar: "النية" },
  "col.calls": { en: "Calls", ar: "المكالمات" },
  "col.pctTotal": { en: "% Total", ar: "٪ من الإجمالي" },
  "col.negativePct": { en: "Negative %", ar: "٪ سلبي" },
  "col.avgConf": { en: "Avg Conf.", ar: "متوسط الثقة" },
  "col.msgId": { en: "Msg ID", ar: "معرّف الرسالة" },
  "col.channel": { en: "Channel", ar: "القناة" },
  "col.customer": { en: "Customer", ar: "العميل" },
  "col.handledBy": { en: "Handled By", ar: "تمت المعالجة بواسطة" },
  "col.preview": { en: "Preview", ar: "معاينة" },
  "col.zone": { en: "Zone", ar: "المنطقة" },
  "col.time": { en: "Time", ar: "الوقت" },
  "col.flagged": { en: "Flagged", ar: "مُعلَّم" },
  "col.resolved": { en: "Resolved", ar: "محلول" },
  "col.issueType": { en: "Issue Type", ar: "نوع المشكلة" },
  "col.avgTime": { en: "Avg Time", ar: "متوسط الوقت" },
  "col.slaStatus": { en: "SLA Status", ar: "حالة مستوى الخدمة" },
  "col.orderId": { en: "Order ID", ar: "معرّف الطلب" },
  "col.merchantZone": { en: "Merchant & Zone", ar: "التاجر والمنطقة" },
  "col.topRiskFactor": { en: "Top Risk Factor", ar: "أبرز عامل خطورة" },
  "col.risk": { en: "Risk", ar: "الخطورة" },
  "col.score": { en: "Score", ar: "الدرجة" },
  "col.action": { en: "Action", ar: "الإجراء" },
  "unit.calls": { en: "calls", ar: "مكالمة" },
  "unit.messages": { en: "messages", ar: "رسالة" },
  "common.aiInsight": { en: "AI Insight", ar: "رؤية الذكاء الاصطناعي" },
  "a11y.prevPage": { en: "Previous page", ar: "الصفحة السابقة" },
  "a11y.nextPage": { en: "Next page", ar: "الصفحة التالية" },
  "a11y.close": { en: "Close", ar: "إغلاق" },
  "a11y.refreshNow": { en: "Refresh now", ar: "تحديث الآن" },
  "a11y.dismissAlert": { en: "Dismiss alert", ar: "إغلاق التنبيه" },
  "a11y.dismissNotif": { en: "Dismiss notification", ar: "إغلاق الإشعار" },
  "a11y.filter": { en: "Filter {label}", ar: "تصفية {label}" },

  // — Time range ——————————————————————————————————————————————————————————
  "range.wtd": { en: "Week to date", ar: "الأسبوع حتى تاريخه" },
  "range.mtd": { en: "Month to date", ar: "الشهر حتى تاريخه" },
  "range.qtd": { en: "Quarter to date", ar: "الربع حتى تاريخه" },
  "range.ytd": { en: "Year to date", ar: "السنة حتى تاريخه" },
  "range.all": { en: "All time", ar: "كل الوقت" },
  "range.short.wtd": { en: "WTD", ar: "الأسبوع" },
  "range.short.mtd": { en: "MTD", ar: "الشهر" },
  "range.short.qtd": { en: "QTD", ar: "الربع" },
  "range.short.ytd": { en: "YTD", ar: "السنة" },
  "range.short.all": { en: "All", ar: "الكل" },
  // — Verticals (names themselves translate through the tv() value map) —————
  "vertical.label": { en: "Vertical", ar: "القطاع" },
  "vertical.all": { en: "All verticals", ar: "كل القطاعات" },
  "cancel.byVertical": { en: "Cancellation Rate by Vertical", ar: "معدل الإلغاء حسب القطاع" },
  "cancel.byVerticalDetail": { en: "{cancelled} of {total} orders", ar: "{cancelled} من {total} طلب" },

  // — Hover breakdowns (top contributors to a cancellation stat) ————————————
  "hover.topMerchants": { en: "Top contributing merchants", ar: "أكثر التجار مساهمة في الإلغاءات" },
  "hover.topZones": { en: "Top contributing zones", ar: "أكثر المناطق مساهمة في الإلغاءات" },
  "hover.topVerticals": { en: "Top contributing verticals", ar: "أكثر القطاعات مساهمة في الإلغاءات" },

  "range.custom": { en: "Custom range", ar: "نطاق مخصص" },
  "range.customTitle": { en: "Pick a date range", ar: "اختر نطاقًا زمنيًا" },
  "range.start": { en: "Start", ar: "من" },
  "range.end": { en: "End", ar: "إلى" },
  "range.apply": { en: "Apply", ar: "تطبيق" },

  // — Refresh status ——————————————————————————————————————————————————————
  "refresh.autoRefresh": { en: "Auto-refresh", ar: "تحديث تلقائي" },
  "refresh.every": { en: "every {label}", ar: "كل {label}" },
  "refresh.offWord": { en: "off", ar: "معطّل" },
  "refresh.updated": { en: "Updated {ago}", ar: "آخر تحديث {ago}" },
  "refresh.justNow": { en: "just now", ar: "الآن" },
  "refresh.secAgo": { en: "{n}s ago", ar: "قبل {n} ث" },
  "refresh.minAgo": { en: "{n}m ago", ar: "قبل {n} د" },
  "refresh.hrAgo": { en: "{n}h ago", ar: "قبل {n} س" },
  "refresh.refreshing": { en: "Refreshing…", ar: "جارٍ التحديث…" },
  "refresh.refresh": { en: "Refresh", ar: "تحديث" },

  // — Hero banner ——————————————————————————————————————————————————————————
  "hero.badge": { en: "Clarity · Qatar", ar: "Clarity · قطر" },
  "hero.title1": { en: "All Call Data.", ar: "كل بيانات المكالمات." },
  "hero.title2": { en: "One Clarity.", ar: "Clarity واحد." },
  "hero.subtitle": {
    en: "Upload call transcripts and Clarity classifies intent, scores emotional tone, and extracts key entities — across every city in Qatar.",
    ar: "ارفع نصوص المكالمات ليصنّف Clarity النية، ويقيّم النبرة العاطفية، ويستخرج الكيانات الرئيسية — في كل مدينة في قطر.",
  },
  "hero.upload": { en: "Upload Transcripts", ar: "رفع النصوص" },
  "hero.accepts": {
    en: "Accepts .txt, .csv, .json — up to 100 transcripts per batch",
    ar: "يقبل .txt و.csv و.json — حتى 100 نص في كل دفعة",
  },

  // — Filter bar ——————————————————————————————————————————————————————————
  "filter.allCategories": { en: "All categories", ar: "كل الفئات" },
  "filter.allSentiment": { en: "All sentiment", ar: "كل المشاعر" },
  "filter.allAgents": { en: "All agents", ar: "كل الموظفين" },
  "filter.reset": { en: "Reset", ar: "إعادة ضبط" },
  "filter.matchingCalls": { en: "{n} matching calls", ar: "{n} مكالمة مطابقة" },
  "filter.exportCsv": { en: "Export CSV", ar: "تصدير CSV" },

  // — Call Intelligence page ——————————————————————————————————————————————
  "ci.statTotal": { en: "Total Calls Analyzed", ar: "إجمالي المكالمات المحللة" },
  "ci.statAvgDuration": { en: "Average Call Duration", ar: "متوسط مدة المكالمة" },
  "ci.statNegRate": { en: "Negative Sentiment Rate", ar: "معدل المشاعر السلبية" },
  "ci.statTopCategory": { en: "Top Issue Category", ar: "أبرز فئة مشكلة" },
  "ci.footer": {
    en: "Clarity Call Intelligence · All Call Data. One Clarity.",
    ar: "ذكاء مكالمات Clarity · كل بيانات المكالمات. Clarity واحد.",
  },
  "ci.loadedCalls": { en: "Loaded {n} calls", ar: "تم تحميل {n} مكالمة" },
  "ci.exportedCalls": { en: "Exported {n} calls to CSV", ar: "تم تصدير {n} مكالمة إلى CSV" },
  "ci.noTranscripts": {
    en: "No transcripts found — check the browser console (F12) for details",
    ar: "لم يُعثر على نصوص — تحقق من وحدة تحكم المتصفح (F12) للتفاصيل",
  },
  "ci.analysing": { en: "Analysing {n} transcripts…", ar: "جارٍ تحليل {n} نص…" },
  "ci.added": { en: "Added {n} analysed calls", ar: "تمت إضافة {n} مكالمة محللة" },
  "ci.analysisFailed": {
    en: "Analysis failed — is the backend running on port 8001?",
    ar: "فشل التحليل — هل الخادم يعمل على المنفذ 8001؟",
  },

  // — Charts / panels (Call Intelligence) ——————————————————————————————————
  "table.analyzedCalls": { en: "Analyzed Calls", ar: "المكالمات المحللة" },
  "table.callsCount": { en: "{n} calls", ar: "{n} مكالمة" },
  "table.callsPage": { en: "{from}–{to} of {total} calls", ar: "{from}–{to} من {total} مكالمة" },
  "chart.sentimentDistribution": { en: "Sentiment Distribution", ar: "توزيع المشاعر" },
  "chart.uploadForSentiment": { en: "Upload transcripts to see sentiment breakdown", ar: "ارفع النصوص لعرض تفصيل المشاعر" },
  "chart.callCategories": { en: "Call Categories", ar: "فئات المكالمات" },
  "chart.uploadForCategory": { en: "Upload transcripts to see category breakdown", ar: "ارفع النصوص لعرض تفصيل الفئات" },
  "chart.intentClassification": { en: "Intent Classification", ar: "تصنيف النوايا" },
  "chart.uploadForIntent": { en: "Upload transcripts to see intent breakdown", ar: "ارفع النصوص لعرض تفصيل النوايا" },
  "intent.clearFilter": { en: "Clear filter", ar: "مسح الفلتر" },
  "intent.clickToFilter": { en: "Click to filter calls", ar: "انقر لتصفية المكالمات" },
  "intent.tone": { en: "tone", ar: "نبرة" },
  "chart.sentimentTrendWeek": { en: "Sentiment Trend by Week", ar: "اتجاه المشاعر أسبوعياً" },
  "chart.uploadForTrend": { en: "Upload transcripts to see the sentiment trend", ar: "ارفع النصوص لعرض اتجاه المشاعر" },
  "chart.topTopics": { en: "Top Topics", ar: "أبرز المواضيع" },
  "topics.byFrequency": { en: "By Frequency", ar: "حسب التكرار" },
  "topics.byNegativity": { en: "By Negativity", ar: "حسب السلبية" },
  "chart.uploadForTopics": { en: "Upload transcripts to see top topics", ar: "ارفع النصوص لعرض أبرز المواضيع" },

  // — Qatar map ————————————————————————————————————————————————————————————
  "map.callOrigins": { en: "CALL ORIGINS — QATAR", ar: "مصادر المكالمات — قطر" },
  "map.stateQatar": { en: "[STATE OF QATAR · 2026]", ar: "[دولة قطر · 2026]" },
  "map.totalCalls": { en: "TOTAL CALLS", ar: "إجمالي المكالمات" },
  "map.uploadToPopulate": { en: "Upload transcripts to populate", ar: "ارفع النصوص للتعبئة" },
  "map.topCities": { en: "ZONES BY CALL VOLUME", ar: "المناطق حسب حجم المكالمات" },
  "map.noCityData": { en: "No city data yet", ar: "لا توجد بيانات مدن بعد" },
  "map.unmapped": {
    en: "{n} zone(s) in data without coordinates:",
    ar: "{n} منطقة في البيانات بدون إحداثيات:",
  },
  "map.markerHint": {
    en: "Marker size scales with call volume. Hover a zone for its exact count.",
    ar: "يتناسب حجم العلامة مع حجم المكالمات. مرّر فوق منطقة لرؤية عددها الدقيق.",
  },

  // — CX Dashboard ————————————————————————————————————————————————————————
  "cx.title": { en: "CX Analytics Dashboard", ar: "لوحة تحليلات تجربة العملاء" },
  "cx.subtitle": {
    en: "Single source of truth for overall Customer Experience health across calls, text, and bot channels.",
    ar: "مصدر موحّد لصحة تجربة العملاء عبر قنوات المكالمات والنصوص والروبوت.",
  },
  "cx.resetFilters": { en: "Reset Filters", ar: "إعادة ضبط الفلاتر" },
  "cx.totalInteractions": { en: "Total Interactions", ar: "إجمالي التفاعلات" },
  "cx.overallSentiment": { en: "Overall Sentiment", ar: "المشاعر العامة" },
  "cx.cancellationRate": { en: "Cancellation Rate", ar: "معدل الإلغاء" },
  "cx.contactRate": { en: "Support Contact Rate", ar: "معدل التواصل مع الدعم" },
  "cx.avgResolution": { en: "Avg Resolution Time", ar: "متوسط زمن الحل" },
  "cx.botContainment": { en: "Bot Containment", ar: "احتواء الروبوت" },
  "cx.escalationRate": { en: "Escalation Rate", ar: "معدل التصعيد" },
  "cx.viewFullCall": { en: "View Full Call Report", ar: "عرض تقرير المكالمات الكامل" },
  "cx.topComplaints": { en: "Top Complaints", ar: "أبرز الشكاوى" },
  "cx.noCallData": { en: "No call data yet.", ar: "لا توجد بيانات مكالمات بعد." },
  "cx.textSentiment": { en: "Text Sentiment", ar: "مشاعر النصوص" },
  "cx.viewFullSentiment": { en: "View Full Sentiment Report", ar: "عرض تقرير المشاعر الكامل" },
  "cx.viewFullCancellation": { en: "View Full Cancellation Report", ar: "عرض تقرير الإلغاءات الكامل" },
  "cx.trainModelDrivers": { en: "Train the model or load cancellation data to see drivers.", ar: "درّب النموذج أو حمّل بيانات الإلغاء لعرض المحركات." },
  "cx.cancelledBy": { en: "Cancelled By", ar: "أُلغيت بواسطة" },
  "cx.topDrivers": { en: "Top Cancellation Drivers", ar: "أبرز محركات الإلغاء" },
  "cx.resolutionTime": { en: "Resolution Time", ar: "زمن الحل" },
  "cx.resolutionWip": {
    en: "Resolution-time tracking needs per-ticket open/close timestamps, which aren't ingested yet.",
    ar: "يتطلّب تتبّع زمن الحل طوابع فتح/إغلاق لكل تذكرة، وهي غير مُستوعَبة بعد.",
  },
  "cx.chatbotSummary": { en: "Chatbot Summary", ar: "ملخص روبوت الدردشة" },
  "cx.chatbotWip": {
    en: "Chatbot containment, fallback and unanswered-question analytics need the bot conversation logs, which aren't connected yet.",
    ar: "تحتاج تحليلات احتواء الروبوت والتحويل والأسئلة غير المُجابة إلى سجلات محادثات الروبوت، وهي غير متصلة بعد.",
  },
  "cx.containmentRate": { en: "Containment Rate", ar: "معدل الاحتواء" },
  "cx.fallbackRate": { en: "Fallback Rate", ar: "معدل التحويل" },
  "cx.avgBotTurns": { en: "Avg Bot Turns", ar: "متوسط أدوار الروبوت" },
  "cx.topUnanswered": { en: "Top Unanswered", ar: "أبرز غير المُجاب" },
  "cx.topUnansweredQuestions": { en: "Top Unanswered Questions", ar: "أبرز الأسئلة غير المُجابة" },
  "cx.chatbotInsight": {
    en: "41% of escalations happen within the first 2 bot turns — customers are bypassing the menu. An LLM-powered bot layer could contain an estimated 30% more chats.",
    ar: "41٪ من التصعيدات تحدث خلال أول دورين للروبوت — العملاء يتجاوزون القائمة. طبقة روبوت مدعومة بنموذج لغوي قد تحتوي نحو 30٪ محادثات إضافية.",
  },
  "cx.weeklyHealth": { en: "Weekly CX Health Score", ar: "مؤشر صحة تجربة العملاء الأسبوعي" },
  "cx.healthIs": { en: "CX Health is {label} this week", ar: "صحة تجربة العملاء {label} هذا الأسبوع" },
  "cx.healthGood": { en: "GOOD", ar: "جيدة" },
  "cx.healthFair": { en: "FAIR", ar: "مقبولة" },
  "cx.healthPoor": { en: "POOR", ar: "ضعيفة" },
  "cx.recentTrend": { en: "Recent Trend", ar: "الاتجاه الأخير" },
  "cx.scoreComposition": { en: "Behind the Score", ar: "ما وراء المؤشر" },
  "cx.compSentiment": { en: "Avg sentiment", ar: "متوسط المشاعر" },
  "cx.compSentimentDetail": { en: "{score} / 10", ar: "{score} / 10" },
  "cx.compCancellations": { en: "Cancellation rate", ar: "معدل الإلغاء" },
  "cx.compCancelDetail": { en: "{rate}% of orders", ar: "{rate}٪ من الطلبات" },
  "cx.footer": { en: "Clarity Analytics · CX Operations Dashboard", ar: "تحليلات Clarity · لوحة عمليات تجربة العملاء" },
  "cx.slaRef": { en: "{n}h SLA", ar: "هدف {n}س" },
  "cx.sentimentInsightEmpty": { en: "Not enough message data yet to surface a sentiment insight.", ar: "لا توجد بيانات رسائل كافية بعد لإظهار رؤية عن المشاعر." },
  "cx.cancelInsightEmpty": { en: "Not enough cancellation data yet to surface a zone insight.", ar: "لا توجد بيانات إلغاء كافية بعد لإظهار رؤية عن المناطق." },
  "cx.sentimentInsight": { en: "Negative sentiment peaks in W{week} at {pct}%.", ar: "تبلغ المشاعر السلبية ذروتها في الأسبوع {week} عند {pct}٪." },
  "cx.sentimentInsightDriver": { en: " Leading driver: {trigger}.", ar: " المحرّك الأبرز: {trigger}." },
  "cx.cancelInsight": { en: "{zone} has the highest cancellation rate at {rate}%.", ar: "تسجّل {zone} أعلى معدل إلغاء عند {rate}٪." },
  "empty.noCallData": { en: "No call data", ar: "لا بيانات مكالمات" },
  "empty.noSentimentTrend": { en: "No sentiment trend", ar: "لا اتجاه مشاعر" },
  "empty.noNegativeTopics": { en: "No negative topics", ar: "لا مواضيع سلبية" },
  "empty.noMessages": { en: "No messages", ar: "لا رسائل" },
  "empty.noCancellationTrend": { en: "No cancellation trend", ar: "لا اتجاه إلغاء" },
  "empty.noZoneData": { en: "No zone data", ar: "لا بيانات منطقة" },
  "empty.noTrendData": { en: "No trend data", ar: "لا بيانات اتجاه" },

  // — Support Messages page ————————————————————————————————————————————————
  "msg.title": { en: "Customer Support Messages", ar: "رسائل دعم العملاء" },
  "msg.subtitle": { en: "Analyze text-based support across App, WhatsApp, and Tickets.", ar: "حلّل الدعم النصي عبر التطبيق وواتساب والتذاكر." },
  "msg.alertSentimentSpike": { en: "Negative sentiment spike detected", ar: "تم رصد ارتفاع في المشاعر السلبية" },
  "msg.alertSlaExceeded": { en: "SLA targets exceeded", ar: "تم تجاوز أهداف مستوى الخدمة" },
  "msg.statTotal": { en: "Total Messages Analyzed", ar: "إجمالي الرسائل المحللة" },
  "msg.statNegative": { en: "Negative Sentiment", ar: "المشاعر السلبية" },
  "msg.statTopIntent": { en: "Most Common Intent", ar: "أكثر النوايا شيوعاً" },
  "msg.statTopChannel": { en: "Most Active Channel", ar: "أكثر القنوات نشاطاً" },
  "msg.statWow": { en: "Week-over-Week Vol", ar: "الحجم الأسبوعي" },
  "msg.footer": { en: "Clarity Call Intelligence · Support Messages", ar: "ذكاء مكالمات Clarity · رسائل الدعم" },
  "msg.sentimentBreachItem": {
    en: "Negative sentiment up {delta} pts week-over-week ({prev}% → {latest}%, limit {limit} pts)",
    ar: "ارتفعت المشاعر السلبية {delta} نقطة أسبوعياً ({prev}٪ ← {latest}٪، الحد {limit} نقطة)",
  },
  "msg.slaBreachItem": {
    en: "{n} {channel} conversations took longer than the {sla}h SLA to resolve",
    ar: "{n} محادثة عبر {channel} استغرقت حلّها أطول من هدف {sla}س",
  },
  "mft.messagesCount": { en: "{n} messages", ar: "{n} رسالة" },
  "mft.bot": { en: "Bot", ar: "روبوت" },
  "mft.pageRange": { en: "{from}–{to} of {total} messages", ar: "{from}–{to} من {total} رسالة" },
  "mft.flaggedForReview": { en: "Flagged for review", ar: "مُعلَّم للمراجعة" },

  // Top negative triggers
  "trig.title": { en: "Top 5 Negative Triggers", ar: "أبرز 5 محفزات سلبية" },
  "trig.empty": { en: "No negative triggers yet — run sentiment classification to populate this panel.", ar: "لا توجد محفزات سلبية بعد — شغّل تصنيف المشاعر لتعبئة هذه اللوحة." },
  "trig.up": { en: "Up", ar: "صعود" },
  "trig.down": { en: "Down", ar: "هبوط" },
  "trig.messages": { en: "messages", ar: "رسالة" },
  "trig.peakZone": { en: "Peak Zone:", ar: "منطقة الذروة:" },
  "trig.peakTime": { en: "Peak Time:", ar: "وقت الذروة:" },

  // Cross-channel comparison
  "ccc.title": { en: "Cross-Channel Comparison: Calls vs Messages", ar: "مقارنة بين القنوات: المكالمات مقابل الرسائل" },
  "ccc.empty": { en: "No cross-channel data yet — run sentiment classification to populate this chart.", ar: "لا توجد بيانات بين القنوات بعد — شغّل تصنيف المشاعر لتعبئة هذا المخطط." },
  "ccc.callsVolume": { en: "Calls Volume", ar: "حجم المكالمات" },
  "ccc.messagesVolume": { en: "Messages Volume", ar: "حجم الرسائل" },

  // Sentiment by zone/time
  "szt.byZone": { en: "Negative Sentiment % by Zone", ar: "٪ المشاعر السلبية حسب المنطقة" },
  "szt.byTime": { en: "Sentiment by Time of Day", ar: "المشاعر حسب وقت اليوم" },
  "szt.zoneEmpty": { en: "No zone data yet — run sentiment classification to populate this chart.", ar: "لا توجد بيانات منطقة بعد — شغّل تصنيف المشاعر لتعبئة هذا المخطط." },
  "szt.negativePct": { en: "Negative %", ar: "٪ سلبي" },

  // Message sentiment trend
  "mst.title": { en: "Message Sentiment Trend by Week", ar: "اتجاه مشاعر الرسائل أسبوعياً" },
  "mst.empty": { en: "No sentiment trend data yet — run sentiment classification to populate this chart.", ar: "لا توجد بيانات اتجاه مشاعر بعد — شغّل تصنيف المشاعر لتعبئة هذا المخطط." },

  // — Cancellations page ——————————————————————————————————————————————————
  "cancel.title": { en: "Cancellation Intelligence", ar: "ذكاء الإلغاءات" },
  "cancel.subtitle": { en: "Predictive risk models and root-cause analysis for order cancellations across Qatar.", ar: "نماذج خطورة تنبؤية وتحليل الأسباب الجذرية لإلغاءات الطلبات في قطر." },
  "cancel.alertBreach": { en: "Cancellation rate threshold breached", ar: "تم تجاوز حدّ معدل الإلغاء" },
  "cancel.breachItem": { en: "{zone} — {rate}% (limit {limit}%)", ar: "{zone} — {rate}٪ (الحد {limit}٪)" },
  "cancel.statTotal": { en: "Total Cancellations", ar: "إجمالي الإلغاءات" },
  "cancel.statWow": { en: "Week-over-Week Change", ar: "التغير الأسبوعي" },
  "cancel.statTopDriver": { en: "Top Driver", ar: "أبرز محرّك" },
  "cancel.statRiskZone": { en: "Highest-Risk Zone", ar: "أعلى منطقة خطورة" },
  "cancel.rateByWeek": { en: "Cancellation Rate by Week", ar: "معدل الإلغاء أسبوعياً" },
  "cancel.noTrend": { en: "No trend data available", ar: "لا توجد بيانات اتجاه" },
  "cancel.rateLegend": { en: "Cancellation Rate", ar: "معدل الإلغاء" },
  "cancel.topDriversModel": { en: "Top Cancellation Drivers (model)", ar: "أبرز محركات الإلغاء (النموذج)" },
  "cancel.byActor": { en: "Cancellations by Actor", ar: "الإلغاءات حسب الجهة" },
  "cancel.trainToSeeDrivers": { en: "Train the model to see driver importance", ar: "درّب النموذج لعرض أهمية المحركات" },
  "cancel.riskByZoneTime": { en: "Risk by Zone × Time of Day", ar: "الخطورة حسب المنطقة × وقت اليوم" },
  "cancel.noCrosstab": { en: "No cross-tab data available", ar: "لا توجد بيانات جدول متقاطع" },
  "cancel.rateByZone": { en: "Cancellation Rate by Zone", ar: "معدل الإلغاء حسب المنطقة" },
  "cancel.noZone": { en: "No zone data", ar: "لا توجد بيانات منطقة" },
  "cancel.rateByDay": { en: "Cancellation Rate by Day", ar: "معدل الإلغاء حسب اليوم" },
  "cancel.noDow": { en: "No day-of-week data", ar: "لا توجد بيانات أيام الأسبوع" },
  "cancel.liveQueue": { en: "Live High-Risk Queue", ar: "قائمة الخطورة العالية المباشرة" },
  "cancel.liveQueueDesc": { en: "Active orders scored by {engine}, ranked by cancellation probability.", ar: "طلبات نشطة مُقيَّمة بواسطة {engine}، مرتّبة حسب احتمال الإلغاء." },
  "cancel.scoringWith": { en: "Scoring orders with {engine}…", ar: "جارٍ تقييم الطلبات بواسطة {engine}…" },
  "cancel.modelNotTrained": { en: "The cancellation model has not been trained yet — switch the engine to Gemini for an LLM estimate, or train the model.", ar: "لم يُدرَّب نموذج الإلغاء بعد — بدّل المحرّك إلى Gemini لتقدير بنموذج لغوي، أو درّب النموذج." },
  "cancel.noActiveOrders": { en: "No active orders to score right now.", ar: "لا توجد طلبات نشطة لتقييمها الآن." },
  "cancel.noOrdersMatch": { en: "No orders matching filters.", ar: "لا طلبات مطابقة للفلاتر." },
  "cancel.queuePageRange": { en: "{from}–{to} of {total} orders", ar: "{from}–{to} من {total} طلب" },
  "cancel.hide": { en: "Hide", ar: "إخفاء" },
  "cancel.explain": { en: "Explain", ar: "تفسير" },
  "cancel.generatingExplanation": { en: "Generating Gemini explanation…", ar: "جارٍ توليد تفسير Gemini…" },
  "cancel.recommendedAction": { en: "Recommended action: ", ar: "الإجراء الموصى به: " },
  "cancel.noExplanation": { en: "No explanation available.", ar: "لا يوجد تفسير متاح." },
  "cancel.couldNotLoad": { en: "Could not load explanation.", ar: "تعذّر تحميل التفسير." },
  "cancel.modelPerformance": { en: "Model Performance", ar: "أداء النموذج" },
  "cancel.notTrained": { en: "Not trained", ar: "غير مدرَّب" },
  "cancel.runTraining": { en: "Run the training script to populate model metrics and enable live predictions.", ar: "شغّل سكربت التدريب لتعبئة مقاييس النموذج وتفعيل التنبؤات المباشرة." },
  "cancel.decisionThreshold": { en: "Decision Threshold", ar: "عتبة القرار" },
  "cancel.features": { en: "Features", ar: "الخصائص" },
  "cancel.trainingRows": { en: "Training Rows", ar: "صفوف التدريب" },
  "cancel.highRecall": { en: "High recall prioritised", ar: "أولوية للاستدعاء العالي" },
  "cancel.highRecallDesc": { en: " — ops would rather review a false alarm than miss a real cancellation.", ar: " — تفضّل العمليات مراجعة إنذار كاذب على تفويت إلغاء حقيقي." },
  "cancel.lastTrained": { en: "Last trained: {date}", ar: "آخر تدريب: {date}" },
  "cancel.driversReport": { en: "Cancellation Drivers Report", ar: "تقرير محركات الإلغاء" },
  "cancel.generatingReport": { en: "Generating the Gemini drivers report from live cancellation data…", ar: "جارٍ توليد تقرير محركات Gemini من بيانات الإلغاء المباشرة…" },
  "cancel.reportFirstRequest": { en: "The Gemini drivers report is generated on first request. Ensure the backend is running and try refreshing.", ar: "يُولَّد تقرير محركات Gemini عند أول طلب. تأكد من تشغيل الخادم وأعد التحديث." },
  "cancel.executiveSummary": { en: "Executive Summary", ar: "الملخص التنفيذي" },
  "cancel.topDrivers": { en: "Top Drivers", ar: "أبرز المحركات" },
  "cancel.actionLabel": { en: "Action: ", ar: "الإجراء: " },
  "cancel.highRiskSegments": { en: "High-Risk Segments", ar: "الشرائح عالية الخطورة" },
  "cancel.footer": { en: "Clarity Analytics · Cancellation Intelligence", ar: "تحليلات Clarity · ذكاء الإلغاءات" },
  "engine.mlModel": { en: "the ML model", ar: "نموذج التعلّم الآلي" },

  // Cancellation chat
  "cc.title": { en: "Ask the Cancellation Analyst", ar: "اسأل محلّل الإلغاءات" },
  "cc.intro": { en: "Ask natural-language questions about cancellations. Answers are grounded on live order data.", ar: "اطرح أسئلة بلغة طبيعية عن الإلغاءات. الإجابات مبنية على بيانات الطلبات المباشرة." },
  "cc.suggestion1": { en: "Why did cancellations spike recently?", ar: "لماذا ارتفعت الإلغاءات مؤخراً؟" },
  "cc.suggestion2": { en: "Which zones are getting worse?", ar: "أي المناطق تزداد سوءاً؟" },
  "cc.suggestion3": { en: "What drives merchant-side cancellations?", ar: "ما الذي يدفع الإلغاءات من جانب التاجر؟" },
  "cc.analyzing": { en: "Analyzing cancellation data…", ar: "جارٍ تحليل بيانات الإلغاء…" },
  "cc.placeholder": { en: "Ask about cancellation drivers, zones, trends…", ar: "اسأل عن محركات الإلغاء والمناطق والاتجاهات…" },
  "cc.error": { en: "Sorry — I couldn't reach the analysis service. Is the backend running?", ar: "عذراً — تعذّر الوصول إلى خدمة التحليل. هل الخادم يعمل؟" },

  // — Threshold alert ——————————————————————————————————————————————————————
  "ta.wouldNotifyVia": { en: "Would notify via", ar: "سيتم الإشعار عبر" },
  "ta.noChannels": { en: "No alert channels enabled — turn one on in Settings.", ar: "لا توجد قنوات تنبيه مفعّلة — فعّل واحدة من الإعدادات." },

  // — Notification panel ——————————————————————————————————————————————————
  "notif.markAllRead": { en: "Mark all read", ar: "تعليم الكل كمقروء" },
  "notif.unreadTotal": { en: "{unread} unread · {total} total", ar: "{unread} غير مقروء · {total} الإجمالي" },
  "notif.unreadOnly": { en: "Unread only", ar: "غير المقروء فقط" },
  "notif.checking": { en: "Checking for alerts…", ar: "جارٍ التحقق من التنبيهات…" },
  "notif.allCaughtUp": { en: "You're all caught up", ar: "أنت على اطّلاع بكل شيء" },
  "notif.noAlertsManager": { en: "No SLA breaches, high-risk orders, or helpfulness flags right now.", ar: "لا توجد تجاوزات لمستوى الخدمة أو طلبات عالية الخطورة أو إشارات فائدة الآن." },
  "notif.noAlertsEmployee": { en: "No SLA breaches or high-risk orders right now.", ar: "لا توجد تجاوزات لمستوى الخدمة أو طلبات عالية الخطورة الآن." },
  "notif.noMatch": { en: "No notifications match this filter.", ar: "لا إشعارات مطابقة لهذا الفلتر." },
  "notif.manageSettings": { en: "Manage notification settings", ar: "إدارة إعدادات الإشعارات" },
  "notif.chipAll": { en: "All", ar: "الكل" },
  "notif.chipSla": { en: "SLA", ar: "مستوى الخدمة" },
  "notif.chipRisk": { en: "Risk", ar: "الخطورة" },
  "notif.chipAgents": { en: "Agents", ar: "الموظفون" },
  "notif.aria": { en: "Notifications", ar: "الإشعارات" },

  // — Column filter ————————————————————————————————————————————————————————
  "cf.clear": { en: "Clear", ar: "مسح" },
  "cf.search": { en: "Search…", ar: "بحث…" },
  "cf.selectAll": { en: "Select all", ar: "تحديد الكل" },
  "cf.clearAll": { en: "Clear all", ar: "مسح الكل" },
  "cf.noMatches": { en: "No matches", ar: "لا تطابقات" },

  // — Call detail modal ————————————————————————————————————————————————————
  "cdm.transcript": { en: "Transcript", ar: "النص" },
  "cdm.analysis": { en: "Analysis", ar: "التحليل" },
  "cdm.noTranscript": { en: "No transcript available.", ar: "لا يوجد نص متاح." },
  "cdm.detectedCategory": { en: "Detected Category", ar: "الفئة المكتشفة" },
  "cdm.confidenceSuffix": { en: "{n}% confidence", ar: "{n}٪ ثقة" },
  "cdm.detectedIntent": { en: "Detected Intent", ar: "النية المكتشفة" },
  "cdm.overallSentiment": { en: "Overall Sentiment", ar: "المشاعر العامة" },
  "cdm.summary": { en: "Summary", ar: "الملخص" },
  "cdm.noSummary": { en: "No summary available.", ar: "لا يوجد ملخص متاح." },
  "cdm.flagForReview": { en: "Flag for Review", ar: "تعليم للمراجعة" },
  "cdm.downloadTranscript": { en: "Download Transcript", ar: "تنزيل النص" },

  // — Message detail modal ————————————————————————————————————————————————
  "mdm.confidence": { en: "Confidence", ar: "الثقة" },
  "mdm.merchant": { en: "Merchant", ar: "التاجر" },
  "mdm.handlingTime": { en: "Handling Time", ar: "زمن المعالجة" },
  "mdm.originalMessage": { en: "Original Message", ar: "الرسالة الأصلية" },
  "mdm.aiSuggestedReply": { en: "AI Suggested Reply", ar: "رد مقترح بالذكاء الاصطناعي" },
  "mdm.draft": { en: "Draft", ar: "مسودة" },
  "mdm.flaggedForReview": { en: "Flagged for Review", ar: "مُعلَّم للمراجعة" },
  "mdm.reopen": { en: "Reopen", ar: "إعادة فتح" },
  "mdm.markResolved": { en: "Mark as Resolved", ar: "تعليم كمحلول" },

  // — Help page ————————————————————————————————————————————————————————————
  "help.title": { en: "Help & Documentation", ar: "المساعدة والتوثيق" },
  "help.subtitle": { en: "Understand the metrics, learn the dashboards, and reach the analytics & engineering teams.", ar: "افهم المقاييس، وتعلّم اللوحات، وتواصل مع فريقي التحليلات والهندسة." },
  "help.glossary": { en: "CX Data Dictionary & Glossary", ar: "قاموس ومسرد بيانات تجربة العملاء" },
  "help.metricsDecoder": { en: "Metrics Decoder", ar: "مفكّك المقاييس" },
  "help.mlGuide": { en: "ML Classifier Guide", ar: "دليل مصنّف التعلّم الآلي" },
  "help.highRisk": { en: "High Risk", ar: "خطورة عالية" },
  "help.urgent": { en: "Urgent", ar: "عاجل" },
  "help.mlGuidePre": { en: "An order earns the ", ar: "يحصل الطلب على وسم " },
  "help.mlGuideMid": { en: " label when the cancellation-risk model scores it above the confidence threshold (Settings → ML Model Tuning). A message is marked ", ar: " عندما يقيّمه نموذج خطورة الإلغاء فوق حدّ الثقة (الإعدادات ← ضبط نموذج التعلّم الآلي). وتُوسَم الرسالة بـ" },
  "help.mlGuidePost": { en: " when it combines strongly negative sentiment with a time-sensitive intent (e.g. Late Delivery or Refund Request).", ar: " عندما تجمع بين مشاعر سلبية قوية ونية حساسة للوقت (مثل تأخّر التوصيل أو طلب استرداد)." },
  "help.walkthroughs": { en: "Interactive Walkthroughs & Onboarding", ar: "جولات تفاعلية وإعداد" },
  "help.walkthroughsWip": { en: "Guided product tours are still being built. They'll be available here soon.", ar: "الجولات الإرشادية للمنتج قيد الإنشاء. ستتوفّر هنا قريباً." },
  "help.startTour": { en: "Start tour", ar: "بدء الجولة" },
  "help.faq": { en: "FAQ & Best Practices", ar: "الأسئلة الشائعة وأفضل الممارسات" },
  "help.feedback": { en: "Internal Escalation & Feedback", ar: "التصعيد الداخلي والملاحظات" },
  "help.feedbackDesc": { en: "Report a bug, request a feature, or flag an incorrect AI label directly to the internal analytics & engineering teams.", ar: "أبلغ عن خلل، أو اطلب ميزة، أو أبلغ عن تصنيف خاطئ للذكاء الاصطناعي مباشرة إلى فريقي التحليلات والهندسة الداخليين." },
  "help.reportBug": { en: "Report a bug", ar: "الإبلاغ عن خلل" },
  "help.requestFeature": { en: "Request a feature", ar: "طلب ميزة" },
  "help.flagAi": { en: "Flag AI labeling", ar: "الإبلاغ عن تصنيف خاطئ" },
  "help.feedbackPlaceholder": { en: "Describe the issue, the page it occurred on, and what you expected to happen…", ar: "صف المشكلة، والصفحة التي حدثت فيها، وما الذي توقّعت حدوثه…" },
  "help.submitted": { en: "Submitted", ar: "تم الإرسال" },
  "help.submit": { en: "Submit", ar: "إرسال" },
  "help.footer": { en: "Clarity Analytics · Help & Documentation", ar: "تحليلات Clarity · المساعدة والتوثيق" },
  "help.metric.cancelRate": { en: "Cancellation Rate", ar: "معدل الإلغاء" },
  "help.metric.cancelRateHow": { en: "Cancelled orders ÷ total placed orders in the period, expressed as a %. Computed per zone and per merchant from the vendor_kpi feed.", ar: "الطلبات الملغاة ÷ إجمالي الطلبات في الفترة، كنسبة مئوية. تُحسب لكل منطقة ولكل تاجر من تغذية vendor_kpi." },
  "help.metric.wow": { en: "WoW Trend", ar: "الاتجاه الأسبوعي" },
  "help.metric.wowHow": { en: "Week-over-week change: (this week − last week) ÷ last week. A +12% WoW means the metric rose 12% versus the prior 7-day window.", ar: "التغير الأسبوعي: (هذا الأسبوع − الأسبوع الماضي) ÷ الأسبوع الماضي. ‎+12٪‎ تعني ارتفاع المقياس 12٪ مقارنة بالنافذة السابقة (7 أيام)." },
  "help.metric.nlp": { en: "NLP Accuracy", ar: "دقة معالجة اللغة" },
  "help.metric.nlpHow": { en: "Share of messages where the model's predicted intent matched a human-reviewed label, across the audited sample set.", ar: "نسبة الرسائل التي طابقت فيها النية المتوقعة من النموذج تصنيفاً مراجَعاً بشرياً، عبر عيّنة التدقيق." },
  "help.metric.sentiment": { en: "Sentiment Score", ar: "مؤشر المشاعر" },
  "help.metric.sentimentHow": { en: "Weighted blend of positive/neutral/negative classifications per interaction, normalised to a 0–10 scale. Higher is better.", ar: "مزيج مرجّح من تصنيفات إيجابي/محايد/سلبي لكل تفاعل، مُعاير على مقياس 0–10. الأعلى أفضل." },
  "help.guide.callDesc": { en: "Transcripts, intent tagging, sentiment and the Qatar coverage map.", ar: "النصوص ووسم النوايا والمشاعر وخريطة التغطية في قطر." },
  "help.guide.msgDesc": { en: "Cross-channel sentiment, negative triggers and zone/time analysis.", ar: "المشاعر بين القنوات والمحفزات السلبية وتحليل المنطقة/الوقت." },
  "help.guide.cancelDesc": { en: "Risk drivers, merchant × time heatmap and live high-risk orders.", ar: "محركات الخطورة وخريطة حرارية للتاجر × الوقت والطلبات المباشرة عالية الخطورة." },
  "help.faq.q1": { en: "What should I do when 'Late Preparation' is the top cancellation driver?", ar: "ماذا أفعل عندما يكون «تأخّر التحضير» أبرز محرّك للإلغاء؟" },
  "help.faq.a1": { en: "Cross-reference the affected merchants on the Cancellations page, check prep-time outliers in vendor_kpi, and trigger a merchant ops review. Consider temporarily widening delivery ETAs for those vendors.", ar: "راجع التجار المتأثرين في صفحة الإلغاءات، وتحقّق من القيم الشاذة لزمن التحضير في vendor_kpi، وابدأ مراجعة عمليات للتاجر. وفكّر في توسيع أوقات التوصيل المتوقعة مؤقتاً لهؤلاء التجار." },
  "help.faq.q2": { en: "Why did a message get classified as the wrong intent?", ar: "لماذا صُنّفت رسالة بنية خاطئة؟" },
  "help.faq.a2": { en: "The NLP engine maps keywords to intents using the rules in Settings → ML Model Tuning. Add or adjust a Keyword → Intent mapping there, or lower the confidence threshold to capture edge cases.", ar: "يربط محرك معالجة اللغة الكلمات المفتاحية بالنوايا وفق القواعد في الإعدادات ← ضبط نموذج التعلّم الآلي. أضِف أو عدّل ربط كلمة مفتاحية بنية هناك، أو اخفض حدّ الثقة لالتقاط الحالات الحدّية." },
  "help.faq.q3": { en: "How are 'Live High-Risk Orders' chosen?", ar: "كيف تُختار «الطلبات المباشرة عالية الخطورة»؟" },
  "help.faq.a3": { en: "Orders scoring above the confidence threshold (Settings → ML Model Tuning) on the cancellation-risk model. Raise the threshold to surface fewer, higher-precision orders.", ar: "الطلبات التي تتجاوز حدّ الثقة (الإعدادات ← ضبط نموذج التعلّم الآلي) في نموذج خطورة الإلغاء. ارفع الحدّ لإظهار طلبات أقل وأعلى دقة." },
  "help.faq.q4": { en: "Counts look different between Calls and Messages — why?", ar: "لماذا تختلف الأعداد بين المكالمات والرسائل؟" },
  "help.faq.a4": { en: "They are separate channels with independent ingestion. The Cross-Channel panel on Support Messages reconciles shared intents across both.", ar: "هما قناتان منفصلتان باستيعاب مستقل. تُوفّق لوحة «بين القنوات» في رسائل الدعم بين النوايا المشتركة بينهما." },

  // — Chatbot page ————————————————————————————————————————————————————————
  "bot.title": { en: "Clarity Chatbot", ar: "روبوت Clarity" },
  "bot.greeting": { en: "Hello, I'm Clarity Intelligence", ar: "مرحباً، أنا ذكاء Clarity" },
  "bot.intro": { en: "I can analyze your dashboard data, summarize sentiment trends, and provide insights. How can I help you today?", ar: "يمكنني تحليل بيانات لوحتك، وتلخيص اتجاهات المشاعر، وتقديم الرؤى. كيف يمكنني مساعدتك اليوم؟" },
  "bot.suggestion1": { en: "Summarize the latest sentiment trends", ar: "لخّص أحدث اتجاهات المشاعر" },
  "bot.suggestion2": { en: "Which areas have the most complaints?", ar: "أي المناطق بها أكثر الشكاوى؟" },
  "bot.suggestion3": { en: "Show me restaurant insights", ar: "أرني رؤى المطاعم" },
  "bot.suggestion4": { en: "What is our overall containment rate?", ar: "ما معدل الاحتواء العام لدينا؟" },
  "bot.analyzing": { en: "Analyzing dashboard data...", ar: "جارٍ تحليل بيانات اللوحة..." },
  "bot.attachImage": { en: "Attach Image", ar: "إرفاق صورة" },
  "bot.voiceInput": { en: "Voice Input", ar: "إدخال صوتي" },
  "bot.placeholder": { en: "Ask Clarity about the dashboard data...", ar: "اسأل Clarity عن بيانات اللوحة..." },
  "bot.disclaimer": { en: "AI can make mistakes. Consider verifying important information with the raw analytics tables.", ar: "قد يخطئ الذكاء الاصطناعي. ننصح بالتحقق من المعلومات المهمة من جداول التحليلات الأصلية." },
  "bot.error": { en: "Sorry, I encountered an error. Please try again later.", ar: "عذراً، واجهت خطأً. يرجى المحاولة لاحقاً." },
  "bot.speechUnsupported": { en: "Speech recognition is not supported in your browser.", ar: "التعرّف على الكلام غير مدعوم في متصفحك." },
}

// ---------------------------------------------------------------------------
// Value translations — for enumerable *data* labels that show up in pills,
// dropdowns, chart axes and status chips (sentiments, categories, channels,
// risk levels, statuses, place/category names…). Free-form backend strings
// (zone names, agent names, AI prose) intentionally fall through unchanged.
// ---------------------------------------------------------------------------
const valueTranslations: Record<string, string> = {
  // Sentiments
  Positive: "إيجابي",
  Neutral: "محايد",
  Negative: "سلبي",
  // Call categories
  Billing: "الفواتير",
  Technical: "تقني",
  Returns: "المرتجعات",
  Roaming: "التجوال",
  "Account Access": "الوصول للحساب",
  Complaints: "الشكاوى",
  General: "عام",
  // Agent helpfulness
  "Highly Helpful": "مفيد جداً",
  Helpful: "مفيد",
  Unhelpful: "غير مفيد",
  "N/A": "غير متاح",
  // Customer behavior / mood
  Cooperative: "متعاون",
  Polite: "مهذّب",
  Frustrated: "مُحبَط",
  Angry: "غاضب",
  // Channels
  WhatsApp: "واتساب",
  App: "التطبيق",
  Ticket: "تذكرة",
  // Message intents
  Complaint: "شكوى",
  Refund: "استرداد",
  "Order Query": "استفسار طلب",
  Cancellation: "إلغاء",
  Praise: "إشادة",
  // Time of day (messages)
  Morning: "صباحاً",
  Afternoon: "ظهراً",
  Evening: "مساءً",
  Night: "ليلاً",
  // Time buckets (cancellations)
  Lunch: "الغداء",
  Dinner: "العشاء",
  "Late Night": "وقت متأخر",
  // Risk levels
  high: "مرتفع",
  medium: "متوسط",
  low: "منخفض",
  "All Risks": "كل المخاطر",
  High: "مرتفع",
  Medium: "متوسط",
  Low: "منخفض",
  // Review status
  Flagged: "مُعلَّم",
  "Not flagged": "غير مُعلَّم",
  Resolved: "محلول",
  Unresolved: "غير محلول",
  // Prediction engines
  auto: "تلقائي",
  model: "نموذج",
  gemini: "Gemini",
  // Cancellation actors (who cancelled the order)
  Customer: "العميل",
  Vendor: "التاجر",
  Clarity: "Clarity",
  Unknown: "غير معروف",
  // Zone/category scope (CX)
  "All Zones": "كل المناطق",
  "All Categories": "كل الفئات",
  "Al Rayyan": "الريان",
  "West Bay": "الخليج الغربي",
  "Al Wakra": "الوكرة",
  "Al Wakrah": "الوكرة",
  Lusail: "لوسيل",
  "Al Khor": "الخور",
  "Al Daayen": "الظعاين",
  Doha: "الدوحة",
  "Umm Salal": "أم صلال",
  Mesaieed: "مسيعيد",
  Dukhan: "دخان",
  Restaurant: "مطعم",
  Grocery: "بقالة",
  Pharmacy: "صيدلية",
  "Dark Kitchen": "مطبخ مظلم",
  // Verticals (filter options / badges / breakdown rows)
  Restaurants: "المطاعم",
  Market: "السوق",
  "Health & Wellness": "الصحة والعافية",
  Stars: "النجوم",
  Flowers: "الزهور",
  Charity: "الأعمال الخيرية",
  "Last Mile": "الميل الأخير",
  Pets: "الحيوانات الأليفة",
  "Pet Grooming": "العناية بالحيوانات",
  Events: "الفعاليات",
  Salons: "الصالونات",
  OUTLET: "أوتلت",
  Other: "أخرى",
  // Day-of-week abbreviations (cancellations bar chart)
  Mon: "إثنين",
  Tue: "ثلاثاء",
  Wed: "أربعاء",
  Thu: "خميس",
  Fri: "جمعة",
  Sat: "سبت",
  Sun: "أحد",
}

type Vars = Record<string, string | number>

function translate(lang: Lang, key: string, vars?: Vars): string {
  const entry = translations[key]
  let str = entry ? entry[lang] ?? entry.en : key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.split(`{${k}}`).join(String(v))
    }
  }
  return str
}

/** Returns a `t(key, vars?)` translator bound to the active language. */
export function useT() {
  const { settings } = useSettings()
  const lang = settings.language
  return useCallback(
    (key: string, vars?: Vars) => translate(lang, key, vars),
    [lang],
  )
}

/** The active language and its text direction. */
export function useLocale(): { lang: Lang; dir: "rtl" | "ltr" } {
  const { settings } = useSettings()
  const lang = settings.language
  return { lang, dir: lang === "ar" ? "rtl" : "ltr" }
}

/**
 * Returns a `tv(value)` translator for enumerable *data* values (sentiments,
 * categories, channels, risk levels, statuses…). In English it's the identity;
 * in Arabic it maps known values and passes unknown (free-form) strings through.
 * Safe for `null`/`undefined` — returns "—" so chart axes never break.
 */
export function useTV() {
  const { settings } = useSettings()
  const ar = settings.language === "ar"
  return useCallback(
    (value: string | null | undefined): string => {
      if (value == null || value === "") return "—"
      if (!ar) return value
      return valueTranslations[value] ?? value
    },
    [ar],
  )
}
