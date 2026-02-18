import User from "../model/user.schema.js";

export const verifyDashboardAccess = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).populate("role");

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    const roleName = user.role?.role_Name?.toLowerCase();

    const isOrganizer = roleName === "organizer";
    const isAdmin = roleName === "admin";

    if (!isOrganizer && !isAdmin) {
      return res.status(403).json({
        message: "Access denied: Organizer role required",
      });
    }

    const organizerIdFromParam = req.params.organizerId;
    if (isOrganizer && organizerIdFromParam) {
      if (req.user.id.toString() !== organizerIdFromParam.toString()) {
        return res.status(403).json({
          message: "Access denied: You can only access your own dashboard",
        });
      }
    }

    next();
  } catch (error) {
    console.error("verifyDashboardAccess error:", error);
    return res.status(500).json({
      message: "Server error during dashboard access verification",
      error: error.message,
    });
  }
};
