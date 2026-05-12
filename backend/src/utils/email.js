const nodemailer = require("nodemailer");

const getTransporter = () =>
  nodemailer.createTransport({
    service: process.env.MAIL_SERVICE || "gmail",
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    },
  });

module.exports = { getTransporter };
