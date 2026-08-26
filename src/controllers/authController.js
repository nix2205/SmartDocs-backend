const User = require("../models/User");
const {
  hashPassword,
  verifyPassword,
  signToken,
} = require("../services/authService");

const cleanUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
});

const register = async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "Name, email and password are required." });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, message: "Password must contain at least 8 characters." });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ success: false, message: "An account with this email already exists." });
    }

    const passwordHash = await hashPassword(password);
    const user = await User.create({ name, email, passwordHash });
    const token = signToken({ sub: String(user._id), name: user.name, email: user.email });

    return res.status(201).json({ success: true, token, user: cleanUser(user) });
  } catch (error) {
    console.error("Registration failed:", error);
    return res.status(500).json({ success: false, message: "Failed to create account." });
  }
};

const login = async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    const user = await User.findOne({ email });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    const token = signToken({ sub: String(user._id), name: user.name, email: user.email });
    return res.json({ success: true, token, user: cleanUser(user) });
  } catch (error) {
    console.error("Login failed:", error);
    return res.status(500).json({ success: false, message: "Failed to log in." });
  }
};

const me = async (req, res) => {
  const user = await User.findById(req.user.id).select("name email createdAt").lean();
  if (!user) {
    return res.status(404).json({ success: false, message: "User not found." });
  }
  return res.json({ success: true, user: { id: user._id, name: user.name, email: user.email } });
};

module.exports = { register, login, me };
