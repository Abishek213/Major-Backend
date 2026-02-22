import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: process.env.EMAIL_PORT === "465",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export const sendEmailOTP = async (to, otp) => {
  await transporter.sendMail({
    from: `"Eventa" <${process.env.EMAIL_USER}>`,
    to,
    subject: "Your OTP for Email Verification",
    html: `<h2>OTP: ${otp}</h2><p>Valid for 10 minutes.</p>`,
  });
};
