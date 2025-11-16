const nodemailer = require('nodemailer');

// Create transporter
const createTransporter = () => {
  return nodemailer.createTransporter({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
};

// Email templates
const templates = {
  emailVerification: (data) => ({
    subject: 'Welcome to Ed Share - Verify Your Email',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">Welcome to Ed Share!</h2>
        <p>Hi ${data.name},</p>
        <p>Thank you for registering with Ed Share. Please verify your email address by clicking the button below:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${data.verificationLink}" 
             style="background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Verify Email Address
          </a>
        </div>
        <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">${data.verificationLink}</p>
        <p>This link will expire in 24 hours.</p>
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
        <p style="color: #666; font-size: 14px;">
          If you didn't create an account with Ed Share, please ignore this email.
        </p>
      </div>
    `
  }),

  passwordReset: (data) => ({
    subject: 'Ed Share - Password Reset Request',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626;">Password Reset Request</h2>
        <p>Hi ${data.name},</p>
        <p>We received a request to reset your password for your Ed Share account.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${data.resetLink}" 
             style="background-color: #dc2626; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Reset Password
          </a>
        </div>
        <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">${data.resetLink}</p>
        <p>This link will expire in 30 minutes.</p>
        <p><strong>If you didn't request this password reset, please ignore this email and your password will remain unchanged.</strong></p>
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
        <p style="color: #666; font-size: 14px;">
          For security reasons, this link can only be used once.
        </p>
      </div>
    `
  }),

  sessionReminder: (data) => ({
    subject: `Reminder: Your session with ${data.tutorName} is starting soon`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #059669;">Session Reminder</h2>
        <p>Hi ${data.studentName},</p>
        <p>This is a reminder that your session is starting soon:</p>
        <div style="background-color: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 10px 0; color: #0369a1;">Session Details</h3>
          <p><strong>Tutor:</strong> ${data.tutorName}</p>
          <p><strong>Subject:</strong> ${data.subject}</p>
          <p><strong>Date:</strong> ${data.date}</p>
          <p><strong>Time:</strong> ${data.time}</p>
          <p><strong>Duration:</strong> ${data.duration} minutes</p>
          <p><strong>Mode:</strong> ${data.mode}</p>
          ${data.meetingLink ? `<p><strong>Meeting Link:</strong> <a href="${data.meetingLink}">${data.meetingLink}</a></p>` : ''}
        </div>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${data.sessionLink}" 
             style="background-color: #059669; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Join Session
          </a>
        </div>
        <p>Please make sure you're ready 5 minutes before the session starts.</p>
      </div>
    `
  }),

  bookingConfirmation: (data) => ({
    subject: 'Booking Confirmed - Ed Share',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #059669;">Booking Confirmed!</h2>
        <p>Hi ${data.studentName},</p>
        <p>Your session has been successfully booked. Here are the details:</p>
        <div style="background-color: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 10px 0; color: #0369a1;">Booking Details</h3>
          <p><strong>Booking ID:</strong> ${data.bookingId}</p>
          <p><strong>Tutor:</strong> ${data.tutorName}</p>
          <p><strong>Subject:</strong> ${data.subject}</p>
          <p><strong>Date:</strong> ${data.date}</p>
          <p><strong>Time:</strong> ${data.time}</p>
          <p><strong>Duration:</strong> ${data.duration} minutes</p>
          <p><strong>Amount Paid:</strong> ₹${data.amount}</p>
        </div>
        <p>You will receive a reminder 1 hour before your session.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${data.dashboardLink}" 
             style="background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            View in Dashboard
          </a>
        </div>
      </div>
    `
  }),

  tutorApproval: (data) => ({
    subject: 'Congratulations! Your tutor profile has been approved',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #059669;">Profile Approved!</h2>
        <p>Hi ${data.name},</p>
        <p>Congratulations! Your tutor profile has been approved and you can now start accepting bookings.</p>
        <div style="background-color: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #22c55e;">
          <h3 style="margin: 0 0 10px 0; color: #166534;">What's Next?</h3>
          <ul style="margin: 0; padding-left: 20px;">
            <li>Complete your availability calendar</li>
            <li>Add demo session slots</li>
            <li>Upload introduction video</li>
            <li>Start receiving bookings!</li>
          </ul>
        </div>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${data.dashboardLink}" 
             style="background-color: #059669; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Go to Dashboard
          </a>
        </div>
      </div>
    `
  })
};

// Send email function
const sendEmail = async (options) => {
  try {
    const transporter = createTransporter();
    
    let emailContent;
    if (options.template && templates[options.template]) {
      emailContent = templates[options.template](options.data);
    } else {
      emailContent = {
        subject: options.subject,
        html: options.html || options.text
      };
    }

    const mailOptions = {
      from: `"Ed Share" <${process.env.EMAIL_FROM}>`,
      to: options.to,
      subject: emailContent.subject,
      html: emailContent.html
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', result.messageId);
    return result;

  } catch (error) {
    console.error('Email sending failed:', error);
    throw error;
  }
};

// Send bulk emails
const sendBulkEmails = async (emails) => {
  const results = [];
  
  for (const email of emails) {
    try {
      const result = await sendEmail(email);
      results.push({ success: true, messageId: result.messageId, to: email.to });
    } catch (error) {
      results.push({ success: false, error: error.message, to: email.to });
    }
  }
  
  return results;
};

module.exports = {
  sendEmail,
  sendBulkEmails,
  templates
};
