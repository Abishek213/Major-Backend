// authMiddleware.js
import jwt from 'jsonwebtoken';
import User from '../model/user.schema.js';

export const authenticateUser = async (req, res, next) => {
  let token;

  try {
    // Extract token from Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    // Check if token is present
    if (!token) {
      return res.status(401).json({ message: 'Authorization denied: No token provided' });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Find the user associated with the token
    const user = await User.findById(decoded.user.id).select('-password'); // Exclude password for security
    if (!user) {
      return res.status(401).json({ message: 'Authorization denied: User not found' });
    }

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    console.error("Authentication error:", error.message);

    // Handle specific JWT errors
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Authorization denied: Token expired' });
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Authorization denied: Invalid token' });
    } else {
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }
};