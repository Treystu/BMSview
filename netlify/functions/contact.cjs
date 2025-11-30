const nodemailer = require('nodemailer');
const { createLoggerFromEvent, createTimer } = require("./utils/logger.cjs");
const { getCorsHeaders } = require('./utils/cors.cjs');

function validateEnvironment(log) {
  const required = ['EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_USER', 'EMAIL_PASS', 'CONTACT_EMAIL_RECIPIENT'];
  const missing = required.filter(v => !process.env[v]);
  if (missing.length > 0) {
    log.error('Missing required environment variables', { missing });
    return false;
  }
  return true;
}

exports.handler = async function(event, context) {
  const headers = getCorsHeaders(event);
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }
  
  const log = createLoggerFromEvent('contact', event, context);
  log.entry({ method: event.httpMethod, path: event.path });
  const timer = createTimer(log, 'contact-form');
  
  if (!validateEnvironment(log)) {
    log.exit(500);
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }

  if (event.httpMethod !== 'POST') {
    log.warn('Method not allowed', { method: event.httpMethod });
    log.exit(405);
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  try {
    let body;
    try {
        const bodyLength = event.body ? event.body.length : 0;
        log.debug('Parsing request body', { bodyLength });
        body = JSON.parse(event.body);
        log.debug('Request body parsed successfully');
    } catch (e) {
        log.error('Failed to parse request body', { error: e.message });
        log.exit(400);
        return { 
          statusCode: 400, 
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Invalid JSON in request body.' }) 
        };
    }
    
    const { name, email, message } = body;
    log.info('Processing contact form submission', { senderName: name, senderEmail: email });

    if (!name || !email || !message) {
      log.warn('Missing required form fields');
      log.exit(400);
      return { 
        statusCode: 400, 
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing required form fields.' }) 
      };
    }
    
    const { EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS, CONTACT_EMAIL_RECIPIENT } = process.env;
    
    log.debug('Nodemailer environment loaded', {
      hasHost: !!EMAIL_HOST,
      hasPort: !!EMAIL_PORT,
      hasUser: !!EMAIL_USER,
      hasPass: !!EMAIL_PASS,
      hasRecipient: !!CONTACT_EMAIL_RECIPIENT,
    });

    const transportConfig = {
      host: EMAIL_HOST,
      port: EMAIL_PORT,
      secure: EMAIL_PORT == 465,
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS,
      },
    };
    log.debug('Creating nodemailer transporter', { host: EMAIL_HOST, port: EMAIL_PORT });

    const transporter = nodemailer.createTransport(transportConfig);

    const mailOptions = {
      from: `"${name}" <${EMAIL_USER}>`,
      replyTo: email,
      to: CONTACT_EMAIL_RECIPIENT,
      subject: `New contact form submission from ${name}`,
      text: message,
      html: `<p>You have a new contact form submission from:</p>
             <p><strong>Name:</strong> ${name}</p>
             <p><strong>Email:</strong> ${email}</p>
             <p><strong>Message:</strong></p>
             <p>${message.replace(/\n/g, '<br>')}</p>`,
    };
    log.debug('Mail options prepared', { recipient: CONTACT_EMAIL_RECIPIENT });

    log.debug('Attempting to send email via nodemailer');
    const info = await sendMailWithRetry(transporter, mailOptions, log);
    
    timer.end({ success: true });
    log.info('Email sent successfully', { messageId: info.messageId });
    log.exit(200);
    
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Message sent successfully!' }),
    };
  } catch (error) {
    timer.end({ error: true });
    log.error('Failed to send email', { error: error.message, stack: error.stack });
    log.exit(500);
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to send message.' }),
    };
  }
};

async function sendMailWithRetry(transporter, mailOptions, log, retries = 3, delay = 1000) {
  try {
    return await transporter.sendMail(mailOptions);
  } catch (error) {
    if (retries > 0) {
      log.warn('Failed to send email, retrying', { error: error.message, retriesLeft: retries });
      await new Promise(resolve => setTimeout(resolve, delay));
      return await sendMailWithRetry(transporter, mailOptions, log, retries - 1, delay * 2);
    }
    throw error;
  }
}
