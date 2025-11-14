import jwt from 'jsonwebtoken';
import User from '../model/user.schema.js';

// Middleware to protect admin routes
export const protectAdmin = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get fresh user data from database to ensure current role
    const user = await User.findById(decoded.user.id).populate('role'); // Populate the role field

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    // Check if user has admin role
    if (user.role.role_Name !== 'Admin') { // Check role_Name after population
      return res.status(403).json({ message: 'Access denied. Admin privileges required.' });
    }

    // Attach full user object to request for use in controllers
    req.user = user;
    next();
  } catch (error) {
    console.error('Admin middleware error:', error);
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token' });
    }
    res.status(500).json({ message: 'Server error' });
  }
};
