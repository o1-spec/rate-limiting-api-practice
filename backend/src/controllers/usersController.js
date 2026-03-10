import { users } from "../data/mockData.js";

export const getAllUsers = (req, res) => {
  res.status(200).json({
    count: users.length,
    users,
  });
};

export const getUserById = (req, res) => {
  const user = users.find((u) => u.id === req.params.id);

  if (!user) {
    return res.status(404).json({ error: `User with id '${req.params.id}' not found.` });
  }

  res.status(200).json({ user });
};

export const updateUser = (req, res) => {
  const index = users.findIndex((u) => u.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ error: `User with id '${req.params.id}' not found.` });
  }

  const allowedFields = ["name", "email", "role"];
  const updates = {};

  for (const key of allowedFields) {
    if (req.body[key] !== undefined) {
      updates[key] = req.body[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No valid fields provided. Allowed: name, email, role." });
  }

  users[index] = { ...users[index], ...updates };

  res.status(200).json({
    message: "User updated successfully.",
    user: users[index],
  });
};
