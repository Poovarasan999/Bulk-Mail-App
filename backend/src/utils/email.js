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

const ipCache = new Map();
const CACHE_MS = 5 * 60 * 1000;

const lookupIpv4Os = (hostname) =>
  new Promise((resolve, reject) => {
    dns.lookup(hostname, { family: 4 }, (err, address) => {
      if (err) return reject(err);
      resolve(address);
    });
  });

const resolveIpv4 = async (hostname) => {
  const cached = ipCache.get(hostname);
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.ip;

  let address;
  try {
    const addrs = await dnsPromises.resolve4(hostname);
    if (addrs && addrs.length > 0) address = addrs[0];
  } catch (err) {
    console.warn(`[mail] resolve4 ${hostname} failed (${err.message}); falling back to OS lookup`);
  }
  if (!address) {
    address = await lookupIpv4Os(hostname);
  }
  ipCache.set(hostname, { ip: address, at: now });
  console.log(`[mail] Resolved ${hostname} → IPv4 ${address}`);
  return address;
};

const ensureCreds = () => {
  const user = process.env.MAIL_USER?.trim();
  const pass = process.env.MAIL_PASS?.trim();
  if (!user || !pass) {
    const err = new Error(
      "MAIL_USER and MAIL_PASS are not set."
    );
    err.code = "MAIL_CONFIG_MISSING";
    throw err;
  }
};

const buildTransport = ({ host, ipv4Host, port, secure, auth }) =>
  nodemailer.createTransport({
    host: ipv4Host || host,
    port,
    secure,
    requireTLS: !secure && port === 587,
    auth,
    tls: { servername: host },
    ...timeouts,
  });

/**
 * Build ordered list of transporters with their hostnames.
 * Each entry: { host, port, secure, auth }
 */
const planTransports = () => {
  const auth = {
    user: process.env.MAIL_USER?.trim(),
    pass: process.env.MAIL_PASS?.trim(),
  };

  if (process.env.SMTP_URL?.trim()) {
    return [{ smtpUrl: process.env.SMTP_URL.trim() }];
  }

  const customHost = process.env.MAIL_HOST?.trim();
  if (customHost) {
    const port = Number(process.env.MAIL_PORT) || 587;
    const secure =
      String(process.env.MAIL_SECURE || "").toLowerCase() === "true" ||
      port === 465;
    return [{ host: customHost, port, secure, auth }];
  }

  const preferredPort = Number(process.env.GMAIL_SMTP_PORT) || 587;
  const fallbackPort = preferredPort === 465 ? 587 : 465;
  return [
    { host: "smtp.gmail.com", port: preferredPort, secure: preferredPort === 465, auth },
    { host: "smtp.gmail.com", port: fallbackPort, secure: fallbackPort === 465, auth },
  ];
};

const parseAddress = (raw) => {
  const str = String(raw || "").trim();
  const match = str.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1] || undefined, email: match[2] };
  return { email: str };
};

const parseRecipientList = (raw) => {
  if (Array.isArray(raw)) return raw.map((r) => parseAddress(r)).filter((r) => r.email);
  return String(raw || "")
    .split(/[,;]/)
    .map((s) => parseAddress(s))
    .filter((r) => r.email);
};

/** Send via Brevo HTTPS API — works on any cloud (no SMTP ports needed). */
const sendViaBrevoHttp = async (message) => {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  if (!apiKey) return null;

  const sender = parseAddress(message.from);
  if (!sender.email) {
    throw new Error("BREVO_API_KEY set but MAIL_FROM is empty.");
  }

  const payload = {
    sender: { email: sender.email, name: sender.name || "Bulk Mail App" },
    to: parseRecipientList(message.to),
    subject: message.subject,
    textContent: message.text,
  };
  if (message.html) payload.htmlContent = message.html;

  console.log(
    `[mail] using Brevo HTTPS API → ${payload.to.length} recipient(s) from ${sender.email}`
  );

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = data.message || data.code || response.statusText;
    throw new Error(`Brevo API ${response.status}: ${reason}`);
  }
  return data;
};

const sendMailWithFallback = async (message) => {
  const apiResult = await sendViaBrevoHttp(message);
  if (apiResult) return apiResult;

  const plans = planTransports();

  if (plans[0].smtpUrl) {
    const tx = nodemailer.createTransport(plans[0].smtpUrl, timeouts);
    console.log("[mail] using SMTP_URL transport");
    return tx.sendMail(message);
  }

  ensureCreds();

  const networkErrPattern =
    /timeout|ETIMEDOUT|ECONNRESET|ENETUNREACH|ESOCKET|EHOSTUNREACH|EAI_AGAIN/i;
  let lastError;

  for (let i = 0; i < plans.length; i += 1) {
    const plan = plans[i];
    try {
      const ipv4Host = await resolveIpv4(plan.host);
      const tx = buildTransport({ ...plan, ipv4Host });
      console.log(`[mail] attempt ${i + 1}: ${plan.host}:${plan.port} (via ${ipv4Host})`);
      return await tx.sendMail(message);
    } catch (err) {
      lastError = err;
      const retryable = networkErrPattern.test(err.message || "");
      console.warn(`[mail] attempt ${i + 1} failed: ${err.message}`);
      if (!retryable || i === plans.length - 1) {
        throw err;
      }
      console.warn(`[mail] trying next transport...`);
    }
  }

  throw lastError;
};

module.exports = { sendMailWithFallback };
