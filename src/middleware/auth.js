const { verifyToken } = require("../services/authService");

const requireAuth = (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const payload = verifyToken(header.slice(7).trim());
    req.user = {
      id: payload.sub,
      name: payload.name,
      email: payload.email,
    };
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Your session is invalid or has expired." });
  }
};

module.exports = { requireAuth };
