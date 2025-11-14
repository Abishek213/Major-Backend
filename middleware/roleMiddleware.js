export const isAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'Admin') {
      return next();
    } else {
      return res.status(403).json({ message: 'Access denied, Admin role required' });
    }
  };
  
  export const isOrganizer = (req, res, next) => {
    if (req.user && req.user.role === 'Organizer') {
      return next();
    } else {
      return res.status(403).json({ message: 'Access denied, Organizer role required' });
    }
  };
  
  export const isUser = (req, res, next) => {
    if (req.user && req.user.role === 'User') {
      return next();
    } else {
      return res.status(403).json({ message: 'Access denied, User role required' });
    }
  };
  