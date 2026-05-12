const mongoose = require("mongoose");
const EmailRecord = require("../models/EmailRecord");
const { sendMailWithFallback } = require("../utils/email");

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const parseRecipients = (input) => {
  if (Array.isArray(input)) {
    return input.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof input === "string") {
    return input
      .split(/[,\n;]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

const validatePayload = ({ subject, body, recipients }) => {
  if (!subject || !body || recipients.length === 0) {
    return "Subject, body and at least one recipient are required.";
  }

  const invalidEmails = recipients.filter((email) => !emailRegex.test(email));
  if (invalidEmails.length > 0) {
    return `Invalid email addresses: ${invalidEmails.join(", ")}`;
  }

  return "";
};

const sendBulkMail = async (req, res) => {
  const subject = String(req.body.subject || "").trim();
  const body = String(req.body.body || "").trim();
  const recipients = parseRecipients(req.body.recipients);

  const validationError = validatePayload({ subject, body, recipients });
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  try {
    await sendMailWithFallback({
      from: process.env.MAIL_FROM || process.env.MAIL_USER,
      to: recipients.join(", "),
      subject,
      text: body,
    });

    const record = await EmailRecord.create({
      subject,
      body,
      recipients,
      status: "success",
    });

    return res.status(200).json({
      message: `Email sent to ${recipients.length} recipient(s).`,
      record,
    });
  } catch (error) {
    console.error("[mail] send failed:", error.message, error.responseCode || "");

    if (error.code === "MAIL_CONFIG_MISSING") {
      return res.status(503).json({
        message: error.message,
        error: "Set MAIL_USER and MAIL_PASS on the server (Render → Environment) and restart.",
      });
    }

    let record = null;
    try {
      record = await EmailRecord.create({
        subject,
        body,
        recipients,
        status: "failed",
        errorMessage: error.message,
      });
    } catch (dbErr) {
      console.error("[mail] could not save failed record:", dbErr.message);
    }

    let detail = error.message || "SMTP error";
    if (/Invalid login|535|534|EAUTH|authentication failed/i.test(detail)) {
      detail +=
        " Use a 16-character Google App Password (not your Gmail password).";
    } else if (/timeout|ETIMEDOUT|ECONNRESET|ENETUNREACH|ESOCKET|EHOSTUNREACH/i.test(detail)) {
      detail =
        "Could not connect to Gmail SMTP. Your network/ISP is blocking outbound ports 587 and 465. " +
        "Try a mobile hotspot or a different network, or set SMTP_URL (Resend / Brevo / SendGrid) which uses HTTPS-friendly SMTP.";
    }

    return res.status(500).json({
      message: "Failed to send email.",
      error: detail,
      record,
    });
  }
};

const getEmailHistory = async (_req, res) => {
  try {
    const records = await EmailRecord.find().sort({ createdAt: -1 }).limit(100);
    return res.status(200).json(records);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch email history.",
      error: error.message,
    });
  }
};

const deleteEmailRecord = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid record id." });
  }

  try {
    const deleted = await EmailRecord.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ message: "Record not found." });
    }
    return res.status(200).json({ message: "History entry removed." });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to delete history entry.",
      error: error.message,
    });
  }
};

module.exports = { sendBulkMail, getEmailHistory, deleteEmailRecord };
