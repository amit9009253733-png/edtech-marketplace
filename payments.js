const express = require('express');
const { body, validationResult } = require('express-validator');
const Razorpay = require('razorpay');
const stripe = require('stripe');
const crypto = require('crypto');
const Booking = require('../models/Booking');
const Student = require('../models/Student');
const Tutor = require('../models/Tutor');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Initialize payment gateways
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

const stripeClient = stripe(process.env.STRIPE_SECRET_KEY);

// @desc    Create Razorpay order
// @route   POST /api/payments/razorpay/create-order
// @access  Private
router.post('/razorpay/create-order', authenticateToken, [
  body('amount').isFloat({ min: 1 }).withMessage('Amount must be greater than 0'),
  body('currency').optional().isIn(['INR', 'USD']).withMessage('Invalid currency'),
  body('bookingId').optional().isMongoId().withMessage('Invalid booking ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { amount, currency = 'INR', bookingId } = req.body;

    // Convert amount to smallest currency unit (paise for INR)
    const amountInSmallestUnit = Math.round(amount * 100);

    const options = {
      amount: amountInSmallestUnit,
      currency,
      receipt: `receipt_${Date.now()}`,
      notes: {
        userId: req.user._id.toString(),
        bookingId: bookingId || '',
        userRole: req.user.role
      }
    };

    const order = await razorpay.orders.create(options);

    res.json({
      success: true,
      data: {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID
      }
    });

  } catch (error) {
    console.error('Razorpay create order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment order'
    });
  }
});

// @desc    Verify Razorpay payment
// @route   POST /api/payments/razorpay/verify
// @access  Private
router.post('/razorpay/verify', authenticateToken, [
  body('razorpay_order_id').notEmpty().withMessage('Order ID is required'),
  body('razorpay_payment_id').notEmpty().withMessage('Payment ID is required'),
  body('razorpay_signature').notEmpty().withMessage('Signature is required'),
  body('bookingId').optional().isMongoId().withMessage('Invalid booking ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      bookingId
    } = req.body;

    // Verify signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment signature'
      });
    }

    // Get payment details from Razorpay
    const payment = await razorpay.payments.fetch(razorpay_payment_id);

    // Update booking if bookingId is provided
    if (bookingId) {
      const booking = await Booking.findById(bookingId);
      if (booking) {
        booking.payment = {
          status: 'paid',
          method: 'razorpay',
          transactionId: razorpay_payment_id,
          paymentId: razorpay_order_id,
          paidAt: new Date()
        };
        booking.status = 'confirmed';
        await booking.save();
      }
    }

    res.json({
      success: true,
      message: 'Payment verified successfully',
      data: {
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
        amount: payment.amount / 100,
        currency: payment.currency,
        status: payment.status
      }
    });

  } catch (error) {
    console.error('Razorpay verify payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Payment verification failed'
    });
  }
});

// @desc    Create Stripe payment intent
// @route   POST /api/payments/stripe/create-intent
// @access  Private
router.post('/stripe/create-intent', authenticateToken, [
  body('amount').isFloat({ min: 1 }).withMessage('Amount must be greater than 0'),
  body('currency').optional().isIn(['usd', 'inr']).withMessage('Invalid currency'),
  body('bookingId').optional().isMongoId().withMessage('Invalid booking ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { amount, currency = 'usd', bookingId } = req.body;

    // Convert amount to smallest currency unit (cents for USD, paise for INR)
    const amountInSmallestUnit = Math.round(amount * 100);

    const paymentIntent = await stripeClient.paymentIntents.create({
      amount: amountInSmallestUnit,
      currency,
      metadata: {
        userId: req.user._id.toString(),
        bookingId: bookingId || '',
        userRole: req.user.role
      }
    });

    res.json({
      success: true,
      data: {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id
      }
    });

  } catch (error) {
    console.error('Stripe create payment intent error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment intent'
    });
  }
});

// @desc    Confirm Stripe payment
// @route   POST /api/payments/stripe/confirm
// @access  Private
router.post('/stripe/confirm', authenticateToken, [
  body('paymentIntentId').notEmpty().withMessage('Payment intent ID is required'),
  body('bookingId').optional().isMongoId().withMessage('Invalid booking ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { paymentIntentId, bookingId } = req.body;

    // Retrieve payment intent from Stripe
    const paymentIntent = await stripeClient.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({
        success: false,
        message: 'Payment not successful'
      });
    }

    // Update booking if bookingId is provided
    if (bookingId) {
      const booking = await Booking.findById(bookingId);
      if (booking) {
        booking.payment = {
          status: 'paid',
          method: 'stripe',
          transactionId: paymentIntent.id,
          paymentId: paymentIntent.id,
          paidAt: new Date()
        };
        booking.status = 'confirmed';
        await booking.save();
      }
    }

    res.json({
      success: true,
      message: 'Payment confirmed successfully',
      data: {
        paymentIntentId: paymentIntent.id,
        amount: paymentIntent.amount / 100,
        currency: paymentIntent.currency,
        status: paymentIntent.status
      }
    });

  } catch (error) {
    console.error('Stripe confirm payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Payment confirmation failed'
    });
  }
});

// @desc    Process refund
// @route   POST /api/payments/refund
// @access  Private (Admin/Employee)
router.post('/refund', authenticateToken, [
  body('bookingId').isMongoId().withMessage('Invalid booking ID'),
  body('amount').optional().isFloat({ min: 1 }).withMessage('Amount must be greater than 0'),
  body('reason').notEmpty().withMessage('Refund reason is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    // Check permissions
    if (!['admin', 'employee'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const { bookingId, amount, reason } = req.body;

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (booking.payment.status !== 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Booking payment is not in paid status'
      });
    }

    const refundAmount = amount || booking.pricing.totalAmount;
    let refund;

    try {
      if (booking.payment.method === 'razorpay') {
        // Process Razorpay refund
        refund = await razorpay.payments.refund(booking.payment.transactionId, {
          amount: Math.round(refundAmount * 100), // Convert to paise
          notes: {
            reason,
            processedBy: req.user._id.toString()
          }
        });
      } else if (booking.payment.method === 'stripe') {
        // Process Stripe refund
        refund = await stripeClient.refunds.create({
          payment_intent: booking.payment.transactionId,
          amount: Math.round(refundAmount * 100), // Convert to cents
          metadata: {
            reason,
            processedBy: req.user._id.toString()
          }
        });
      }

      // Update booking
      booking.payment.status = refundAmount >= booking.pricing.totalAmount ? 'refunded' : 'partial_refund';
      booking.payment.refundId = refund.id;
      booking.payment.refundAmount = refundAmount;
      booking.payment.refundedAt = new Date();
      
      await booking.save();

      res.json({
        success: true,
        message: 'Refund processed successfully',
        data: {
          refundId: refund.id,
          refundAmount,
          status: refund.status
        }
      });

    } catch (refundError) {
      console.error('Refund processing error:', refundError);
      res.status(500).json({
        success: false,
        message: 'Failed to process refund'
      });
    }

  } catch (error) {
    console.error('Refund error:', error);
    res.status(500).json({
      success: false,
      message: 'Refund processing failed'
    });
  }
});

// @desc    Get payment history
// @route   GET /api/payments/history
// @access  Private
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    let query = {};

    if (req.user.role === 'student') {
      const student = await Student.findOne({ user: req.user._id });
      if (student) {
        query.student = student._id;
      }
    } else if (req.user.role === 'tutor') {
      const tutor = await Tutor.findOne({ user: req.user._id });
      if (tutor) {
        query.tutor = tutor._id;
      }
    }

    // Only get bookings with payment information
    query['payment.status'] = { $exists: true };

    const payments = await Booking.find(query)
      .populate('student', 'user')
      .populate('student.user', 'firstName lastName')
      .populate('tutor', 'user')
      .populate('tutor.user', 'firstName lastName')
      .select('payment pricing subject scheduledDate startTime endTime status createdAt')
      .sort({ 'payment.paidAt': -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Booking.countDocuments(query);

    res.json({
      success: true,
      data: {
        payments,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalPayments: total,
          hasNext: page * limit < total,
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment history'
    });
  }
});

// @desc    Get payment statistics (Admin only)
// @route   GET /api/payments/stats
// @access  Private (Admin)
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    const end = endDate ? new Date(endDate) : new Date();

    const stats = await Booking.getStats(start, end);

    // Calculate total revenue
    const totalRevenue = await Booking.aggregate([
      {
        $match: {
          'payment.status': 'paid',
          'payment.paidAt': { $gte: start, $lte: end }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$pricing.totalAmount' },
          totalBookings: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        stats,
        totalRevenue: totalRevenue[0]?.totalRevenue || 0,
        totalBookings: totalRevenue[0]?.totalBookings || 0,
        dateRange: { startDate: start, endDate: end }
      }
    });

  } catch (error) {
    console.error('Get payment stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment statistics'
    });
  }
});

module.exports = router;
