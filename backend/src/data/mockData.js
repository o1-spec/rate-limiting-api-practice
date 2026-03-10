// ─── In-memory Users ───────────────────────────────────────────────────────────
// This acts as a fake "users table". Controllers read and write directly to
// these arrays so everything is stateful for the duration of the process.

export const users = [
  {
    id: "u1",
    name: "Alice Johnson",
    email: "alice@example.com",
    role: "admin",
    createdAt: "2025-01-10T08:00:00.000Z",
  },
  {
    id: "u2",
    name: "Bob Smith",
    email: "bob@example.com",
    role: "user",
    createdAt: "2025-02-14T10:30:00.000Z",
  },
  {
    id: "u3",
    name: "Carol White",
    email: "carol@example.com",
    role: "user",
    createdAt: "2025-03-01T14:15:00.000Z",
  },
  {
    id: "u4",
    name: "David Lee",
    email: "david@example.com",
    role: "moderator",
    createdAt: "2025-03-05T09:00:00.000Z",
  },
];

// ─── In-memory Data Records ─────────────────────────────────────────────────
// Simulates a generic data resource (like "posts", "products", "records", etc.)
// The gateway's /api/data routes are protected and rate-limited more aggressively.

export const dataRecords = [
  {
    id: "d1",
    title: "Market Analysis Q1",
    category: "finance",
    value: 4200,
    createdBy: "u1",
    createdAt: "2025-01-15T09:00:00.000Z",
  },
  {
    id: "d2",
    title: "User Growth Report",
    category: "analytics",
    value: 1870,
    createdBy: "u2",
    createdAt: "2025-02-20T11:00:00.000Z",
  },
  {
    id: "d3",
    title: "Infrastructure Cost Summary",
    category: "ops",
    value: 8300,
    createdBy: "u1",
    createdAt: "2025-02-28T16:45:00.000Z",
  },
  {
    id: "d4",
    title: "Security Audit Results",
    category: "security",
    value: 0,
    createdBy: "u4",
    createdAt: "2025-03-03T08:30:00.000Z",
  },
];

// ─── Fake registered accounts for auth simulation ───────────────────────────
// Passwords are plain text here intentionally — this is mock data only.
// A real backend would hash passwords with bcrypt.

export const registeredAccounts = [
  { id: "u1", email: "alice@example.com", password: "password123", role: "admin" },
  { id: "u2", email: "bob@example.com", password: "password123", role: "user" },
  { id: "u3", email: "carol@example.com", password: "password123", role: "user" },
  { id: "u4", email: "david@example.com", password: "password123", role: "moderator" },
];
