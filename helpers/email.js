// helpers/email.js — outbound-only email sender.
//
// config.email.transport:
//   'console' (default) — prints the message to stdout. Use for local dev.
//   'smtp'              — talks SMTP using the smtp.* block in config.
//   'ses'               — AWS SES (SESv2). Uses the aws.* block credentials
//                         (the EC2 instance profile in prod — add ses:SendEmail
//                         to its IAM policy) and aws.region. Outbound only.
//
// `from` is the no-reply sender; `replyTo` (optional) is set as the Reply-To
// header AND appended to every email body so recipients know where to reach a
// human (the from address itself does not receive mail).
//
// email.showLinksInBrowser (TESTING / TEMPORARY) does NOT change anything
// here: the message is still sent through the configured transport. The
// routes additionally hand the link back to the browser (routes/api.js).

const nodemailer = require('nodemailer');

function buildTransporter(emailCfg) {
  if (emailCfg.transport === 'smtp') {
    const s = emailCfg.smtp || {};
    return nodemailer.createTransport({
      host: s.host,
      port: s.port || 587,
      secure: !!s.secure,
      auth: (s.user || s.password) ? { user: s.user, pass: s.password } : undefined
    });
  }
  // Console transport — stream-style stub object that just logs.
  return {
    sendMail(opts) {
      console.log('\n────── EMAIL (console transport) ──────');
      console.log(`From:     ${opts.from}`);
      console.log(`To:       ${opts.to}`);
      if (opts.replyTo) console.log(`Reply-To: ${opts.replyTo}`);
      console.log(`Subject:  ${opts.subject}`);
      console.log('────');
      console.log(opts.text || opts.html);
      console.log('───────────────────────────────────────\n');
      return Promise.resolve({ messageId: 'console-' + Date.now() });
    }
  };
}

// Outbound-only send via AWS SES v2. SDK is lazy-required so the app boots
// without it (callers get AWS_SDK_MISSING only when 'ses' transport is used).
async function sendViaSes(appConfig, { from, to, replyTo, subject, text, html }) {
  let sdk;
  try { sdk = require('@aws-sdk/client-sesv2'); }
  catch (e) {
    const err = new Error('@aws-sdk/client-sesv2 is not installed. Run `npm install @aws-sdk/client-sesv2`.');
    err.code = 'AWS_SDK_MISSING';
    throw err;
  }
  const aws = appConfig.aws || {};
  const region = aws.region || 'us-east-1';
  const clientOpts = { region };
  // Instance profile in AWS, otherwise static keys from the aws block.
  if (!aws.runningInAws && aws.accessKeyId && aws.secretAccessKey) {
    clientOpts.credentials = { accessKeyId: aws.accessKeyId, secretAccessKey: aws.secretAccessKey };
  }
  const client = new sdk.SESv2Client(clientOpts);
  const cmd = new sdk.SendEmailCommand({
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    ReplyToAddresses: replyTo ? [replyTo] : undefined,
    Content: { Simple: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: {
        Text: { Data: text, Charset: 'UTF-8' },
        Html: { Data: html, Charset: 'UTF-8' }
      }
    } }
  });
  try {
    return await client.send(cmd);
  } catch (err) {
    console.error('[email] SES send failed:', err.message);
    throw err;
  }
}

async function sendEmail(appConfig, { to, subject, text, html }) {
  const cfg = appConfig.email || {};
  const from = cfg.from || 'noreply@example.org';
  const replyTo = (cfg.replyTo || '').trim();

  // Append a "how to reach a human" footer to every email, since `from` is a
  // no-reply address that doesn't receive mail.
  const text2 = replyTo ? `${text}\n\nNeed to reach us? Email ${replyTo}.` : text;
  const html2 = replyTo
    ? `${html}\n<p style="color:#777;font-size:12px;">Need to reach us? Email <a href="mailto:${replyTo}">${replyTo}</a>.</p>`
    : html;

  if (cfg.transport === 'ses') {
    return sendViaSes(appConfig, { from, to, replyTo, subject, text: text2, html: html2 });
  }
  const transporter = buildTransporter(cfg);
  try {
    await transporter.sendMail({
      from,
      to,
      replyTo: replyTo || undefined,
      subject,
      text: text2,
      html: html2
    });
  } catch (err) {
    console.error('[email] Send failed:', err.message);
    throw err;
  }
}

// Escape user-controlled values (the member's first name) before they go
// into the HTML body.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function sendVerificationEmail(appConfig, { to, firstName, verifyUrl, expiresMinutes }) {
  const greetName = firstName || 'there';
  const appTitle = appConfig.appTitle || 'Mission Men of Anna';
  const mins = expiresMinutes || 60;
  const expiry = `This link expires in ${mins} minute${mins === 1 ? '' : 's'}.`;
  const subject = `${appTitle}: Verify your email address`;
  const text = [
    `Hi ${greetName},`,
    '',
    `Thanks for joining ${appTitle}.`,
    'Click the link below to confirm your email address:',
    '',
    verifyUrl,
    '',
    expiry,
    'If you did not sign up, you can ignore this email.'
  ].join('\n');
  const html = `
    <p>Hi ${esc(greetName)},</p>
    <p>Thanks for joining <strong>${esc(appTitle)}</strong>.</p>
    <p>Click the link below to confirm your email address:</p>
    <p><a href="${verifyUrl}">${verifyUrl}</a></p>
    <p style="color:#777;font-size:12px;">${expiry} If you did not sign up, you can ignore this email.</p>
  `;
  return sendEmail(appConfig, { to, subject, text, html });
}

async function sendPasswordResetEmail(appConfig, { to, firstName, resetUrl, ttlHours }) {
  const greetName = firstName || 'there';
  const appTitle = appConfig.appTitle || 'Mission Men of Anna';
  const subject = `${appTitle}: Reset your password`;
  const text = [
    `Hi ${greetName},`,
    '',
    `We received a request to reset the password on your ${appTitle} account.`,
    'Click the link below to choose a new password:',
    '',
    resetUrl,
    '',
    `This link can be used once and expires in ${ttlHours || 2} hour(s).`,
    'If you did not request a password reset, you can safely ignore this email — your password will not change.'
  ].join('\n');
  const html = `
    <p>Hi ${esc(greetName)},</p>
    <p>We received a request to reset the password on your <strong>${esc(appTitle)}</strong> account.</p>
    <p>Click the link below to choose a new password:</p>
    <p><a href="${resetUrl}">${resetUrl}</a></p>
    <p style="color:#777;font-size:12px;">This link can be used once and expires in ${ttlHours || 2} hour(s). If you did not request a password reset, you can safely ignore this email — your password will not change.</p>
  `;
  return sendEmail(appConfig, { to, subject, text, html });
}

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail
};
