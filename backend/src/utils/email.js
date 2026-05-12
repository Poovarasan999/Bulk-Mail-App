const nodemailer = require("nodemailer");

const timeouts = {
  connectionTimeout: 25_000,
  greetingTimeout: 25_000,
  socketTimeout: 25_000,
};

/**
 * Gmail on cloud (Render, etc.): `service: "gmail"` often hangs or auth-fails.
 * Use explicit smtp.gmail.com. Default 465; set GMAIL_SMTP_PORT=587 if 465 is blocked.
 * Optional SMTP_URL for SendGrid / Resend / Mailgun.
 */
const getTransporter = () => {
  if (process.env.SMTP_URL?.trim()) {
    return nodemailer.createTransport(process.env.SMTP_URL.trim(), timeouts);
  }

  const user = process.env.MAIL_USER?.trim();
  const pass = process.env.MAIL_PASS?.trim();

  if (!user || !pass) {
    const err = new Error(
      "MAIL_USER and MAIL_PASS are not set (use a Google App Password for Gmail)."
    );
    err.code = "MAIL_CONFIG_MISSING";
    throw err;
  }

  const host = process.env.MAIL_HOST?.trim();
  if (host) {
    const port = Number(process.env.MAIL_PORT) || 587;
    const secure =
      String(process.env.MAIL_SECURE || "").toLowerCase() === "true" ||
      port === 465;
    return nodemailer.createTransport({
      host,
      port,
      secure,
      requireTLS: !secure && port === 587,
      auth: { user, pass },
      ...timeouts,
    });
  }

  const service = (process.env.MAIL_SERVICE || "gmail").toLowerCase();
  if (service === "gmail") {
    const port = Number(process.env.GMAIL_SMTP_PORT) || 465;
    if (port === 587) {
      return nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        requireTLS: true,
        auth: { user, pass },
        ...timeouts,
      });
    }
    return nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass },
      ...timeouts,
    });
  }

  return nodemailer.createTransport({
    service,
    auth: { user, pass },
    ...timeouts,
  });
};

module.exports = { getTransporter };
