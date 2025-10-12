const nodemailer = require('nodemailer');
const { createLogger } = require("./utils/logger.js");

exports.handler = async function(event, context) {
  const log = createLogger('contact', context);
  const clientIp = event.headers['x-nf-client-connection-ip'];
  const logContext = { clientIp, httpMethod: event.httpMethod };

  log('debug', 'Function invoked.', { ...logContext, headers: event.headers });

  if (event.httpMethod !== 'POST') {
    log('warn', `Method Not Allowed: ${event.httpMethod}`, logContext);
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    let body;
    try {
        body = JSON.parse(event.body);
        log('debug', 'Request body parsed successfully.', logContext);
    } catch (e) {
        log('error', 'Failed to parse request body.', { ...logContext, error: e.message, body: event.body });
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON in request body.' }) };
    }
    
    const { name, email, message } = body;
    const submissionContext = { ...logContext, senderName: name, senderEmail: email };
    log('info', 'Processing contact form submission.', submissionContext);

    if (!name || !email || !message) {
      log('warn', 'Missing required form fields.', submissionContext);
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required form fields.' }) };
    }
    
    const { EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS, CONTACT_EMAIL_RECIPIENT } = process.env;
    const transportConfig = {
      host: EMAIL_HOST,
      port: EMAIL_PORT,
      secure: EMAIL_PORT == 465,
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS,
      },
    };
    log('debug', 'Creating nodemailer transporter.', { ...submissionContext, host: EMAIL_HOST, port: EMAIL_PORT, user: EMAIL_USER });

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
    log('debug', 'Mail options prepared.', { ...submissionContext, recipient: CONTACT_EMAIL_RECIPIENT });

    log('debug', 'Attempting to send email via nodemailer.');
    const info = await transporter.sendMail(mailOptions);
    log('info', 'Email sent successfully via nodemailer.', { ...submissionContext, messageId: info.messageId, response: info.response });
    
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Message sent successfully!' }),
    };
  } catch (error) {
    log('error', 'Failed to send email.', { ...logContext, errorMessage: error.message, stack: error.stack });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to send message.' }),
    };
  }
};
