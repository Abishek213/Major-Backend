import bcryptjs from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import { sendEmailOTP as sendEmailOtpService } from "../services/email.service.js";
import { sendMobileOTP as sendMobileOtpService } from "../services/sms.service.js";
import { generateOTP } from "../services/otp.service.js";
import User from "../model/user.schema.js";
import Role from "../model/role.schema.js";
import path from "path";
import fs from "fs";

export const signup = async (req, res) => {
  try {
    const { fullname, email, password, role, contactNo, organizerDetails } =
      req.body;

    // Validate input
    if (!fullname || !email || !password || !role || !contactNo) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Check if user exists
    const userExist = await User.findOne({ email });
    if (userExist) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Find role
    const foundRole = await Role.findOne({ role_Name: role });
    if (!foundRole) {
      return res.status(400).json({ message: "Invalid role" });
    }

    // Hash password
    const hashedPassword = await bcryptjs.hash(password, 10);

    // Create user
    const createdUser = new User({
      fullname,
      email,
      password: hashedPassword,
      contactNo,
      role: foundRole._id,
      isEmailVerified: false,
      isMobileVerified: false,
      emailSubscribed: true,
      authProvider: "local",
    });

    // Add organizer details if role is Organizer
    if (role === "Organizer" && organizerDetails) {
      createdUser.organizerDetails = {
        businessName: organizerDetails?.businessName || "",
        contactPerson: organizerDetails?.contactPerson || "",
        contactPhone: organizerDetails?.contactPhone || "",
        establishedYear: organizerDetails?.establishedYear || null,
        expertise: Array.isArray(organizerDetails?.expertise)
          ? organizerDetails.expertise
          : [],
        serviceAreas: Array.isArray(organizerDetails?.serviceAreas)
          ? organizerDetails.serviceAreas
          : [],
        pricing: organizerDetails?.pricing || {},
      };
    }

    await createdUser.save();

    const token = jwt.sign(
      {
        userId: createdUser._id,
        role: foundRole.role_Name,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.status(201).json({
      message: "User created successfully",
      token,
      user: {
        _id: createdUser._id,
        fullname: createdUser.fullname,
        email: createdUser.email,
        contactNo: createdUser.contactNo,
        role: foundRole.role_Name,
        isEmailVerified: createdUser.isEmailVerified,
        isMobileVerified: createdUser.isMobileVerified,
        emailSubscribed: createdUser.emailSubscribed,
      },
    });
  } catch (error) {
    console.error("Error during signup:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const login = async (req, res) => {
  try {
    console.log("Login Request Body:", req.body);
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Please provide email and password" });
    }

    const user = await User.findOne({ email }).populate("role");
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcryptjs.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        user: {
          id: user._id,
          fullname: user.fullname,
          email: user.email,
          role: user.role.role_Name,
        },
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    console.log("Login Response:", {
      message: "Login successful",
      token,
      user: {
        _id: user._id,
        fullname: user.fullname,
        email: user.email,
        role: user.role.role_Name,
        isEmailVerified: user.isEmailVerified,
        isMobileVerified: user.isMobileVerified,
        emailSubscribed: user.emailSubscribed,
      },
    });

    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        _id: user._id,
        fullname: user.fullname,
        email: user.email,
        role: user.role.role_Name,
        isEmailVerified: user.isEmailVerified,
        isMobileVerified: user.isMobileVerified,
        emailSubscribed: user.emailSubscribed,
      },
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message: error.message });
  }
};

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export const googleAuth = async (req, res) => {
  try {
    const { tokenId } = req.body;
    const ticket = await googleClient.verifyIdToken({
      idToken: tokenId,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { email, name, sub: googleId } = payload;

    let user = await User.findOne({ email }).populate("role");
    if (!user) {
      const defaultRole = await Role.findOne({ role_Name: "User" });
      if (!defaultRole)
        return res.status(500).json({ message: "Default role not found" });
      user = new User({
        fullname: name,
        email,
        googleId,
        authProvider: "google",
        isEmailVerified: true,
        role: defaultRole._id,
        contactNo: "0000000000",
        password: crypto.randomBytes(20).toString("hex"),
      });
      await user.save();
    } else {
      if (!user.googleId) {
        user.googleId = googleId;
        user.authProvider = "google";
        user.isEmailVerified = true;
        await user.save();
      }
    }

    const token = jwt.sign(
      {
        user: {
          id: user._id,
          fullname: user.fullname,
          email: user.email,
          role: user.role.role_Name,
        },
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.status(200).json({
      message: "Google authentication successful",
      token,
      user: {
        _id: user._id,
        fullname: user.fullname,
        email: user.email,
        role: user.role.role_Name,
        isEmailVerified: user.isEmailVerified,
        isMobileVerified: user.isMobileVerified,
        emailSubscribed: user.emailSubscribed,
      },
    });
  } catch (error) {
    console.error("Google auth error:", error);
    res.status(500).json({ message: "Google authentication failed" });
  }
};

export const sendEmailOTP = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email required" });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.isEmailVerified)
      return res.status(400).json({ message: "Email already verified" });

    const otp = generateOTP();
    const expiry = new Date(Date.now() + 10 * 60 * 1000);

    user.emailVerificationOTP = otp;
    user.otpExpiry = expiry;
    await user.save();

    await sendEmailOtpService(email, otp);
    res.status(200).json({ message: "OTP sent to email" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to send OTP" });
  }
};

export const verifyEmailOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.isEmailVerified)
      return res.status(400).json({ message: "Email already verified" });

    if (user.emailVerificationOTP !== otp || user.otpExpiry < new Date()) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    user.isEmailVerified = true;
    user.emailVerificationOTP = undefined;
    user.otpExpiry = undefined;
    await user.save();

    res.status(200).json({ message: "Email verified successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Verification failed" });
  }
};

export const sendMobileOTP = async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile)
      return res.status(400).json({ message: "Mobile number required" });

    const user = await User.findOne({ contactNo: mobile });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.isMobileVerified)
      return res.status(400).json({ message: "Mobile already verified" });

    const otp = generateOTP();
    const expiry = new Date(Date.now() + 10 * 60 * 1000);

    user.mobileVerificationOTP = otp;
    user.otpExpiry = expiry;
    await user.save();

    await sendMobileOtpService(mobile, otp);
    res.status(200).json({ message: "OTP sent to mobile" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to send OTP" });
  }
};

export const verifyMobileOTP = async (req, res) => {
  try {
    const { mobile, otp } = req.body;
    const user = await User.findOne({ contactNo: mobile });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.isMobileVerified)
      return res.status(400).json({ message: "Mobile already verified" });

    if (user.mobileVerificationOTP !== otp || user.otpExpiry < new Date()) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    user.isMobileVerified = true;
    user.mobileVerificationOTP = undefined;
    user.otpExpiry = undefined;
    await user.save();

    res.status(200).json({ message: "Mobile verified successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Verification failed" });
  }
};

export const toggleEmailSubscription = async (req, res) => {
  try {
    const userId = req.user.id;
    const { subscribed } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.emailSubscribed = subscribed;
    await user.save();
    res.status(200).json({
      message: "Subscription updated",
      emailSubscribed: user.emailSubscribed,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update subscription" });
  }
};

export const getUserByEmail = async (req, res) => {
  try {
    const { email } = req.params;

    if (!email) {
      return res.status(400).json({ message: "Email parameter is required" });
    }

    const user = await User.findOne({ email }).populate("role");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      user: {
        _id: user._id,
        fullname: user.fullname,
        email: user.email,
        role: user.role.role_Name,
        isEmailVerified: user.isEmailVerified,
        isMobileVerified: user.isMobileVerified,
        emailSubscribed: user.emailSubscribed,
      },
    });
  } catch (error) {
    console.error("Error fetching user by email:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const getAllUsers = async (req, res) => {
  try {
    // Fetch all users and populate their roles
    const users = await User.find()
      .populate("role")
      .select("-password") // Exclude password from the response
      .sort({ createdAt: -1 }); // Sort by newest first

    // Group users by role
    const usersByRole = users.reduce((acc, user) => {
      const roleName = user.role.role_Name;
      if (!acc[roleName]) {
        acc[roleName] = [];
      }
      acc[roleName].push({
        _id: user._id,
        fullname: user.fullname,
        email: user.email,
        createdAt: user.createdAt,
      });
      return acc;
    }, {});

    // Get total counts
    const userCounts = {
      total: users.length,
      byRole: Object.keys(usersByRole).reduce((acc, role) => {
        acc[role] = usersByRole[role].length;
        return acc;
      }, {}),
    };

    res.status(200).json({
      users: usersByRole,
      counts: userCounts,
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const addToWishlist = async (req, res) => {
  try {
    const { eventId } = req.body;
    const userId = req.user.id; // From auth middleware

    // Validate eventId
    if (!eventId) {
      return res.status(400).json({ message: "Event ID is required" });
    }

    // Find user and update wishlist
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if event already in wishlist
    if (user.wishlist.includes(eventId)) {
      return res.status(400).json({ message: "Event already in wishlist" });
    }

    // Add to wishlist
    user.wishlist.push(eventId);
    await user.save();

    res.status(200).json({
      message: "Event added to wishlist",
      wishlist: user.wishlist,
    });
  } catch (error) {
    console.error("Error adding to wishlist:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const removeFromWishlist = async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.id;

    // Validate eventId
    if (!eventId) {
      return res.status(400).json({ message: "Event ID is required" });
    }

    // Find user and update wishlist
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if event exists in wishlist
    const eventIndex = user.wishlist.findIndex(
      (id) => id.toString() === eventId
    );
    if (eventIndex === -1) {
      return res.status(404).json({ message: "Event not found in wishlist" });
    }

    // Remove from wishlist using splice for accurate removal
    user.wishlist.splice(eventIndex, 1);
    await user.save();

    res.status(200).json({
      message: "Event removed from wishlist",
      wishlist: user.wishlist,
    });
  } catch (error) {
    console.error("Error removing from wishlist:", error);
    // Check if error is a MongoDB CastError (invalid ID format)
    if (error.name === "CastError") {
      return res.status(400).json({ message: "Invalid event ID format" });
    }
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const getWishlist = async (req, res) => {
  try {
    const userId = req.user.id; // From auth middleware

    // Find user and populate wishlist with event details
    const user = await User.findById(userId).populate("wishlist");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      wishlist: user.wishlist,
    });
  } catch (error) {
    console.error("Error fetching wishlist:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const getUserProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId)
      .populate("role", "role_Name")
      .select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      user: {
        _id: user._id,
        fullname: user.fullname,
        email: user.email,
        contactNo: user.contactNo,
        role: user.role.role_Name,
        profileImage: user.profileImage,
        isEmailVerified: user.isEmailVerified,
        isMobileVerified: user.isMobileVerified,
        emailSubscribed: user.emailSubscribed,
      },
    });
  } catch (error) {
    console.error("Profile fetch error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { fullname, contactNo } = req.body;

    if (!fullname || !contactNo) {
      return res
        .status(400)
        .json({ message: "Fullname and contact number are required" });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { fullname, contactNo },
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      message: "Profile updated successfully",
      user: {
        _id: user._id,
        fullname: user.fullname,
        email: user.email,
        contactNo: user.contactNo,
      },
    });
  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const uploadProfileImage = async (req, res) => {
  try {
    const image = req.files?.image;
    const userId = req.user.id; // From auth middleware

    // Validate inputs
    if (!image) {
      return res.status(400).json({ message: "No image uploaded" });
    }

    // Find the user to ensure they exist
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/gif"];
    if (!allowedTypes.includes(image.mimetype)) {
      return res.status(400).json({
        message: "Invalid file type. Only JPEG, PNG, and GIF are allowed",
      });
    }

    // Generate unique filename
    const filename = `profile-${userId}-${Date.now()}.${image.name
      .split(".")
      .pop()}`;
    const uploadDir = path.join(process.cwd(), "uploads", "profiles");

    // Ensure directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const uploadPath = path.join(uploadDir, filename);

    // Delete existing profile image if it exists
    if (user.profileImage) {
      const oldImagePath = path.join(process.cwd(), user.profileImage);
      if (fs.existsSync(oldImagePath)) {
        fs.unlinkSync(oldImagePath);
      }
    }

    // Save file
    await image.mv(uploadPath);

    // Update user with image URL
    const imageUrl = `/uploads/profiles/${filename}`;
    user.profileImage = imageUrl;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Profile image uploaded successfully",
      imageUrl,
    });
  } catch (error) {
    console.error("Profile image upload error:", error);
    res.status(500).json({
      success: false,
      message: "Profile image upload failed",
      error: error.message,
    });
  }
};

export const getNotificationPreferences = async (req, res) => {
  try {
    const userId = req.user.id; // from auth middleware
    const user = await User.findById(userId).select("notificationPreferences");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    // Return defaults if field doesn't exist yet
    const prefs = user.notificationPreferences || {
      soundEnabled: true,
      toastEnabled: true,
    };
    res.status(200).json({ preferences: prefs });
  } catch (error) {
    console.error("Error fetching notification preferences:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const updateNotificationPreferences = async (req, res) => {
  try {
    const userId = req.user.id;
    const { soundEnabled, toastEnabled } = req.body; // include any other fields

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { notificationPreferences: { soundEnabled, toastEnabled } } },
      { new: true, runValidators: true }
    ).select("notificationPreferences");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({ preferences: user.notificationPreferences });
  } catch (error) {
    console.error("Error updating notification preferences:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
