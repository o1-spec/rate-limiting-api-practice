import { registeredAccounts, users } from "../data/mockData.js";

export const login = (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const account = registeredAccounts.find((a) => a.email === email);

  if (!account || account.password !== password) {
    return res.status(401).json({ error: "Invalid credentials." });
  }

  const user = users.find((u) => u.id === account.id);

  const fakeToken = `fake-jwt-token-${account.id}-${Date.now()}`;

  res.status(200).json({
    message: "Login successful.",
    token: fakeToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
};

export const register = (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email, and password are required." });
  }

  const exists = registeredAccounts.find((a) => a.email === email);
  if (exists) {
    return res.status(409).json({ error: "An account with that email already exists." });
  }

  const newId = `u${Date.now()}`;

  const newAccount = { id: newId, email, password, role: "user" };
  const newUser = {
    id: newId,
    name,
    email,
    role: "user",
    createdAt: new Date().toISOString(),
  };

  registeredAccounts.push(newAccount);
  users.push(newUser);

  res.status(201).json({
    message: "Account created successfully.",
    user: {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
      createdAt: newUser.createdAt,
    },
  });
};

// ─── POST /auth/logout ───────────────────────────────────────────────────────
export const logout = (req, res) => {
  // Stateless — nothing to invalidate. In a real system you'd blacklist the JWT.
  res.status(200).json({ message: "Logged out successfully." });
};
