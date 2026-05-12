const dns = require("dns");
const dnsPromises = require("dns").promises;
const nodemailer = require("nodemailer");

if (typeof dns.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first");
}

const timeouts = {
  connectionTimeout: 20_000,
  greetingTimeout: 20_000,
  socketTimeout: 20_000,
};

let cachedGmailIp = null;
let cachedAt = 0;
const CACHE_MS = 5 * 60 * 1000;

const lookupIpv4Os = (hostname) =>
  new Promise((resolve, reject) => {
    dns.lookup(hostname, { family: 4 }, (err, address) => {
      if (err) return reject(err);
      resolve(address);
    });
  });

const resolveGmailIpv4 = async () => {
  const now = Date.now();
  if (cachedGmailIp && now - cachedAt < CACHE_MS) {
    return cachedGmailIp;
  }
  let address;
  try {
    const addrs = await dnsPromises.resolve4("smtp.gmail.com");
    if (addrs && addrs.length > 0) address = addrs[0];
  } catch (err) {
    console.warn(`[mail] resolve4 failed (${err.message}); falling back to OS lookup`);
  }
  if (!address) {
    address = await lookupIpv4Os("smtp.gmail.com");
  }
  cachedGmailIp = address;
  cachedAt = now;
  console.log(`[mail] Using Gmail IPv4: ${cachedGmailIp}`);
  return cachedGmailIp;
};

const buildGmailTransport = (port, ipv4Host) => {
  const auth = {
    user: process.env.MAIL_USER?.trim(),
    pass: process.env.MAIL_PASS?.trim(),
  };
  const tls = { servername: "smtp.gmail.com" };
  if (port === 465) {
    return nodemailer.createTransport({
      host: ipv4Host,
      port: 465,
      secure: true,
      auth,
      tls,
      ...timeouts,
    });
  }
  return nodemailer.createTransport({
    host: ipv4Host,
    port: 587,
    secure: false,
    requireTLS: true,
    auth,
    tls,
    ...timeouts,
  });
};

const ensureCreds = () => {
  const user = process.env.MAIL_USER?.trim();
  const pass = process.env.MAIL_PASS?.trim();
  if (!user || !pass) {
    const err = new Error(
      "MAIL_USER and MAIL_PASS are not set (use a Google App Password for Gmail)."
    );
    err.code = "MAIL_CONFIG_MISSING";
    throw err;
  }
};

const getCustomTransport = () => {
  if (process.env.SMTP_URL?.trim()) {
    return nodemailer.createTransport(process.env.SMTP_URL.trim(), timeouts);
  }
  const host = process.env.MAIL_HOST?.trim();
  if (!host) return null;

  const port = Number(process.env.MAIL_PORT) || 587;
  const secure =
    String(process.env.MAIL_SECURE || "").toLowerCase() === "true" ||
    port === 465;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure && port === 587,
    auth: {
      user: process.env.MAIL_USER.trim(),
      pass: process.env.MAIL_PASS.trim(),
    },
    ...timeouts,
  });
};

/**
 * Send mail. If using Gmail (default), pre-resolves to IPv4 so the socket never
 * tries IPv6, and auto-retries on the alternate port (587 ↔ 465) on network errors.
 */
const sendMailWithFallback = async (message) => {
  const custom = getCustomTransport();
  if (custom) {
    return custom.sendMail(message);
  }

  ensureCreds();

  const ipv4Host = await resolveGmailIpv4();
  const preferredPort = Number(process.env.GMAIL_SMTP_PORT) || 587;
  const fallbackPort = preferredPort === 465 ? 587 : 465;
  const transporters = [
    buildGmailTransport(preferredPort, ipv4Host),
    buildGmailTransport(fallbackPort, ipv4Host),
  ];

  const networkErrPattern =
    /timeout|ETIMEDOUT|ECONNRESET|ENETUNREACH|ESOCKET|EHOSTUNREACH/i;
  let lastError;

  for (let i = 0; i < transporters.length; i += 1) {
    try {
      return await transporters[i].sendMail(message);
    } catch (err) {
      lastError = err;
      const retryable = networkErrPattern.test(err.message || "");
      if (!retryable || i === transporters.length - 1) {
        throw err;
      }
      console.warn(
        `[mail] port ${i === 0 ? preferredPort : fallbackPort} failed (${err.message}). Trying next port...`
      );
    }
  }

  throw lastError;
};

module.exports = { sendMailWithFallback };
