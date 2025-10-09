const nodemailer = require('nodemailer');

// NOTE: You must configure these environment variables in your Netlify project settings.
// EMAIL_HOST: 'smtp.example.com'
// EMAIL_PORT: 587
// EMAIL_USER: 'your-email@example.com'
// EMAIL_PASS: 'your-email-password'
// CONTACT_EMAIL_RECIPIENT: 'recipient-email@example.com'

const createLogger = (context) => (level, message, extra = {}) => {
    try {
        console.log(JSON.stringify({
            level: level.toUpperCase(),
            functionName: context?.functionName || 'contact',
            awsRequestId: context?.awsRequestId,
            message,
            ...extra
        }));
    } catch (e) {
        console.log(JSON.stringify({
            level: 'ERROR',
            functionName: context?.functionName || 'contact',
            awsRequestId: context?.awsRequestId,
            message: 'Failed to serialize log message.',
            originalMessage: message,
            serializationError: e.message,
        }));
    }
};

exports.handler = async function(event, context) {
  const log = createLogger(context);
  const clientIp = event.headers['x-nf-client-connection-ip'];
  
  log('info', 'Function invoked.', { httpMethod: event.httpMethod, clientIp });

  if (event.httpMethod !== 'POST') {
    log('warn', `Method Not Allowed: ${event.httpMethod}`);
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { name, email, message } = JSON.parse(event.body);

    if (!name || !email || !message) {
      log('error', 'Missing required form fields.', { senderName: name, senderEmail: email });
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required form fields.' }) };
    }

    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: process.env.EMAIL_PORT == 465,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: `"${name}" <${process.env.EMAIL_USER}>`,
      replyTo: email,
      to: process.env.CONTACT_EMAIL_RECIPIENT,
      subject: `New contact form submission from ${name}`,
      text: message,
      html: `<p>You have a new contact form submission from:</p>
             <p><strong>Name:</strong> ${name}</p>
             <p><strong>Email:</strong> ${email}</p>
             <p><strong>Message:</strong></p>
             <p>${message.replace(/\n/g, '<br>')}</p>`,
    };

    log('info', 'Attempting to send email.');
    await transporter.sendMail(mailOptions);
    log('info', 'Email sent successfully.');
    
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Message sent successfully!' }),
    };
  } catch (error) {
    log('error', 'Failed to send email.', { errorMessage: error.message, stack: error.stack });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to send message.' }),
    };
  }
};