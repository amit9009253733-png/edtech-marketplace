const axios = require('axios');

// SMS Service using a generic SMS API
// You can replace this with your preferred SMS provider (Twilio, MSG91, etc.)

const sendSMS = async (phone, message) => {
  try {
    // For development, just log the SMS
    if (process.env.NODE_ENV === 'development') {
      console.log(`📱 SMS to ${phone}: ${message}`);
      return { success: true, messageId: 'dev_' + Date.now() };
    }

    // Example implementation for a generic SMS API
    // Replace with your actual SMS provider configuration
    const smsData = {
      phone: phone,
      message: message,
      sender_id: 'EDSHARE'
    };

    const response = await axios.post(
      process.env.SMS_API_URL || 'https://api.sms-provider.com/send',
      smsData,
      {
        headers: {
          'Authorization': `Bearer ${process.env.SMS_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.success) {
      console.log('SMS sent successfully:', response.data.messageId);
      return response.data;
    } else {
      throw new Error(response.data.message || 'SMS sending failed');
    }

  } catch (error) {
    console.error('SMS sending failed:', error.message);
    throw error;
  }
};

// Send OTP SMS
const sendOTP = async (phone, otp) => {
  const message = `Your Ed Share verification OTP is: ${otp}. Valid for 10 minutes. Do not share this OTP with anyone.`;
  return await sendSMS(phone, message);
};

// Send session reminder SMS
const sendSessionReminder = async (phone, sessionDetails) => {
  const message = `Reminder: Your session with ${sessionDetails.tutorName} for ${sessionDetails.subject} is starting at ${sessionDetails.time} today. Join: ${sessionDetails.link || 'Check your dashboard'}`;
  return await sendSMS(phone, message);
};

// Send booking confirmation SMS
const sendBookingConfirmation = async (phone, bookingDetails) => {
  const message = `Booking confirmed! Session with ${bookingDetails.tutorName} on ${bookingDetails.date} at ${bookingDetails.time}. Booking ID: ${bookingDetails.bookingId}`;
  return await sendSMS(phone, message);
};

// Send payment confirmation SMS
const sendPaymentConfirmation = async (phone, paymentDetails) => {
  const message = `Payment of ₹${paymentDetails.amount} received successfully. Transaction ID: ${paymentDetails.transactionId}. Thank you for using Ed Share!`;
  return await sendSMS(phone, message);
};

// Send bulk SMS
const sendBulkSMS = async (smsData) => {
  const results = [];
  
  for (const sms of smsData) {
    try {
      const result = await sendSMS(sms.phone, sms.message);
      results.push({ success: true, messageId: result.messageId, phone: sms.phone });
    } catch (error) {
      results.push({ success: false, error: error.message, phone: sms.phone });
    }
  }
  
  return results;
};

module.exports = {
  sendSMS,
  sendOTP,
  sendSessionReminder,
  sendBookingConfirmation,
  sendPaymentConfirmation,
  sendBulkSMS
};
