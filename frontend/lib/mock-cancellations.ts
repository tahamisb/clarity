export const weeklyCancellationRates = [
  { week: "W1", total: 4.2, merchant: 1.8, customer: 2.4 },
  { week: "W2", total: 4.5, merchant: 2.0, customer: 2.5 },
  { week: "W3", total: 4.1, merchant: 1.7, customer: 2.4 },
  { week: "W4", total: 4.8, merchant: 2.2, customer: 2.6 },
  { week: "W5", total: 6.5, merchant: 3.5, customer: 3.0, spike: "Peak — Week of Feb 3: High rain, West Bay zone" },
  { week: "W6", total: 4.6, merchant: 2.1, customer: 2.5 },
  { week: "W7", total: 4.3, merchant: 1.9, customer: 2.4 },
  { week: "W8", total: 4.7, merchant: 2.3, customer: 2.4 },
  { week: "W9", total: 4.4, merchant: 1.8, customer: 2.6 },
  { week: "W10", total: 4.9, merchant: 2.4, customer: 2.5 },
  { week: "W11", total: 5.1, merchant: 2.6, customer: 2.5 },
  { week: "W12", total: 4.5, merchant: 2.0, customer: 2.5 },
];

export const topDrivers = [
  { driver: "Late Preparation", count: 3240, percentage: 38 },
  { driver: "Driver No-show", count: 1960, percentage: 23 },
  { driver: "Customer Changed Mind", count: 1108, percentage: 13 },
  { driver: "Out of Stock", count: 937, percentage: 11 },
  { driver: "Wrong Items Sent", count: 596, percentage: 7 },
  { driver: "Payment Failure", count: 341, percentage: 4 },
  { driver: "Long Estimated Wait", count: 256, percentage: 3 },
  { driver: "App Error at Checkout", count: 85, percentage: 1 },
];

// Merchant Categories: Restaurant, Grocery, Pharmacy, Dark Kitchen
// Times: Morning, Afternoon, Evening, Night
export const heatmapData = [
  { merchant: "Restaurant", time: "Morning", rate: 2.1 },
  { merchant: "Restaurant", time: "Afternoon", rate: 3.8 },
  { merchant: "Restaurant", time: "Evening", rate: 5.2 },
  { merchant: "Restaurant", time: "Night", rate: 4.1 },

  { merchant: "Grocery", time: "Morning", rate: 1.5 },
  { merchant: "Grocery", time: "Afternoon", rate: 2.2 },
  { merchant: "Grocery", time: "Evening", rate: 3.5 },
  { merchant: "Grocery", time: "Night", rate: 2.8 },

  { merchant: "Pharmacy", time: "Morning", rate: 1.1 },
  { merchant: "Pharmacy", time: "Afternoon", rate: 1.4 },
  { merchant: "Pharmacy", time: "Evening", rate: 1.9 },
  { merchant: "Pharmacy", time: "Night", rate: 2.3 },

  { merchant: "Dark Kitchen", time: "Morning", rate: 3.5 },
  { merchant: "Dark Kitchen", time: "Afternoon", rate: 4.6 },
  { merchant: "Dark Kitchen", time: "Evening", rate: 8.7 },
  { merchant: "Dark Kitchen", time: "Night", rate: 7.2 },
];

export const highRiskOrders = [
  { id: "ORD-9821A", customerId: "Customer #5541", merchant: "Burger Boutique", zone: "West Bay", sizeQAR: 145, day: "Friday", time: "Evening", riskScore: 88, riskFactor: "Late prep + Evening + West Bay" },
  { id: "ORD-9822B", customerId: "Customer #8230", merchant: "Al Meera", zone: "Al Rayyan", sizeQAR: 320, day: "Monday", time: "Afternoon", riskScore: 54, riskFactor: "Out of Stock history" },
  { id: "ORD-9823C", customerId: "Customer #1022", merchant: "Dark Kitchen Hub", zone: "Lusail", sizeQAR: 85, day: "Friday", time: "Evening", riskScore: 92, riskFactor: "Driver shortage + Dark Kitchen" },
  { id: "ORD-9824D", customerId: "Customer #4410", merchant: "KFC", zone: "Al Wakra", sizeQAR: 65, day: "Saturday", time: "Night", riskScore: 76, riskFactor: "Late prep + Night" },
  { id: "ORD-9825E", customerId: "Customer #9921", merchant: "Kulud Pharmacy", zone: "West Bay", sizeQAR: 45, day: "Wednesday", time: "Morning", riskScore: 32, riskFactor: "Low risk" },
  { id: "ORD-9826F", customerId: "Customer #1105", merchant: "Pizza Hut", zone: "Al Daayen", sizeQAR: 110, day: "Thursday", time: "Evening", riskScore: 81, riskFactor: "Customer cancellation history" },
  { id: "ORD-9827G", customerId: "Customer #6632", merchant: "Monoprix", zone: "West Bay", sizeQAR: 450, day: "Sunday", time: "Afternoon", riskScore: 45, riskFactor: "High value + Medium wait" },
  { id: "ORD-9828H", customerId: "Customer #2214", merchant: "Cloud Kitchen 5", zone: "Al Rayyan", sizeQAR: 75, day: "Friday", time: "Evening", riskScore: 89, riskFactor: "Dark Kitchen + Peak Hour" },
  { id: "ORD-9829I", customerId: "Customer #7743", merchant: "McDonald's", zone: "Al Khor", sizeQAR: 55, day: "Tuesday", time: "Night", riskScore: 68, riskFactor: "Driver distance" },
  { id: "ORD-9830J", customerId: "Customer #3388", merchant: "Carrefour", zone: "Lusail", sizeQAR: 280, day: "Friday", time: "Morning", riskScore: 61, riskFactor: "Out of stock probability" },
  { id: "ORD-9831K", customerId: "Customer #8812", merchant: "Basta 23", zone: "West Bay", sizeQAR: 195, day: "Thursday", time: "Evening", riskScore: 84, riskFactor: "Late prep + West Bay traffic" },
  { id: "ORD-9832L", customerId: "Customer #5501", merchant: "Wellcare Pharmacy", zone: "Al Wakra", sizeQAR: 120, day: "Monday", time: "Afternoon", riskScore: 28, riskFactor: "Low risk" },
  { id: "ORD-9833M", customerId: "Customer #4499", merchant: "Hardee's", zone: "Al Rayyan", sizeQAR: 90, day: "Saturday", time: "Night", riskScore: 71, riskFactor: "Late prep + Night" },
  { id: "ORD-9834N", customerId: "Customer #1123", merchant: "Lulu Hypermarket", zone: "Al Daayen", sizeQAR: 550, day: "Sunday", time: "Evening", riskScore: 58, riskFactor: "Complex order + Evening" },
  { id: "ORD-9835O", customerId: "Customer #9988", merchant: "Shawarma Station", zone: "Lusail", sizeQAR: 40, day: "Friday", time: "Night", riskScore: 94, riskFactor: "Driver no-show probability" },
];

export const zoneRates = [
  { zone: "West Bay", rate: 6.8 },
  { zone: "Lusail", rate: 5.5 },
  { zone: "Al Rayyan", rate: 4.2 },
  { zone: "Al Wakra", rate: 3.8 },
  { zone: "Al Daayen", rate: 3.2 },
  { zone: "Al Khor", rate: 2.9 },
];

export const dayOfWeekRates = [
  { day: "Mon", rate: 3.8 },
  { day: "Tue", rate: 3.9 },
  { day: "Wed", rate: 4.1 },
  { day: "Thu", rate: 4.8 },
  { day: "Fri", rate: 7.2 },
  { day: "Sat", rate: 6.5 },
  { day: "Sun", rate: 4.0 },
];
