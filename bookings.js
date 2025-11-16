const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Booking = require('../models/Booking');
const Student = require('../models/Student');
const Tutor = require('../models/Tutor');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { sendEmail } = require('../utils/emailService');
const { sendSMS } = require('../utils/smsService');

const router = express.Router();

// @desc    Create a new booking
// @route   POST /api/bookings
// @access  Private (Student)
router.post('/', authenticateToken, authorizeRoles('student'), [
  body('tutorId').isMongoId().withMessage('Invalid tutor ID'),
  body('sessionType').isIn(['demo', 'regular', 'assessment', 'group']).withMessage('Invalid session type'),
  body('subject').notEmpty().withMessage('Subject is required'),
  body('class').isIn(['LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']).withMessage('Invalid class'),
  body('board').isIn(['CBSE', 'ICSE', 'State Board', 'IB', 'IGCSE', 'NIOS']).withMessage('Invalid board'),
  body('scheduledDate').isISO8601().withMessage('Invalid date format'),
  body('startTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Invalid start time format'),
  body('endTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Invalid end time format'),
  body('duration').isInt({ min: 30, max: 180 }).withMessage('Duration must be between 30-180 minutes'),
  body('mode').isIn(['online', 'offline']).withMessage('Invalid mode')
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
      tutorId,
      sessionType,
      subject,
      class: className,
      board,
      scheduledDate,
      startTime,
      endTime,
      duration,
      mode,
      location,
      topics
    } = req.body;

    // Get student profile
    const student = await Student.findOne({ user: req.user._id });
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student profile not found'
      });
    }

    // Get tutor profile
    const tutor = await Tutor.findById(tutorId).populate('user');
    if (!tutor) {
      return res.status(404).json({
        success: false,
        message: 'Tutor not found'
      });
    }

    // Check if tutor is available
    if (!tutor.isAvailableForBooking) {
      return res.status(400).json({
        success: false,
        message: 'Tutor is not available for booking'
      });
    }

    // Check if tutor teaches the requested subject and class
    const tutorSubject = tutor.subjects.find(s => 
      s.name.toLowerCase() === subject.toLowerCase() && 
      s.classes.includes(className) &&
      s.boards.includes(board)
    );

    if (!tutorSubject) {
      return res.status(400).json({
        success: false,
        message: 'Tutor does not teach this subject for the specified class and board'
      });
    }

    // Check availability for the requested time slot
    const sessionDate = new Date(scheduledDate);
    const isAvailable = tutor.isAvailable(sessionDate, startTime, endTime);
    
    if (!isAvailable) {
      return res.status(400).json({
        success: false,
        message: 'Tutor is not available at the requested time'
      });
    }

    // Check for conflicting bookings
    const conflictingBooking = await Booking.findOne({
      tutor: tutorId,
      scheduledDate: sessionDate,
      $or: [
        {
          startTime: { $lte: startTime },
          endTime: { $gt: startTime }
        },
        {
          startTime: { $lt: endTime },
          endTime: { $gte: endTime }
        },
        {
          startTime: { $gte: startTime },
          endTime: { $lte: endTime }
        }
      ],
      status: { $in: ['scheduled', 'confirmed', 'in_progress'] }
    });

    if (conflictingBooking) {
      return res.status(400).json({
        success: false,
        message: 'Time slot is already booked'
      });
    }

    // Calculate pricing
    const baseAmount = tutorSubject.pricePerHour * (duration / 60);
    const tax = baseAmount * 0.18; // 18% GST
    const totalAmount = baseAmount + tax;

    // Create booking
    const booking = new Booking({
      student: student._id,
      tutor: tutorId,
      sessionType,
      subject,
      class: className,
      board,
      scheduledDate: sessionDate,
      startTime,
      endTime,
      duration,
      mode,
      location,
      topics: topics || [],
      pricing: {
        baseAmount,
        tax,
        totalAmount
      }
    });

    await booking.save();

    // Send confirmation emails and SMS
    try {
      // Email to student
      await sendEmail({
        to: req.user.email,
        template: 'bookingConfirmation',
        data: {
          studentName: req.user.firstName,
          tutorName: tutor.user.firstName + ' ' + tutor.user.lastName,
          subject,
          date: sessionDate.toDateString(),
          time: `${startTime} - ${endTime}`,
          duration,
          amount: totalAmount,
          bookingId: booking._id,
          dashboardLink: `${process.env.CLIENT_URL}/student/my-bookings`
        }
      });

      // SMS to student
      await sendSMS(req.user.phone, 
        `Booking confirmed! Session with ${tutor.user.firstName} on ${sessionDate.toDateString()} at ${startTime}. Booking ID: ${booking._id}`
      );

      // Notification to tutor
      await sendEmail({
        to: tutor.user.email,
        subject: 'New Booking Request - Ed Share',
        template: 'newBookingNotification',
        data: {
          tutorName: tutor.user.firstName,
          studentName: req.user.firstName + ' ' + req.user.lastName,
          subject,
          date: sessionDate.toDateString(),
          time: `${startTime} - ${endTime}`,
          bookingId: booking._id
        }
      });

    } catch (notificationError) {
      console.error('Notification sending failed:', notificationError);
      // Don't fail the booking if notifications fail
    }

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      data: { booking }
    });

  } catch (error) {
    console.error('Create booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create booking'
    });
  }
});

// @desc    Get user bookings
// @route   GET /api/bookings
// @access  Private
router.get('/', authenticateToken, [
  query('status').optional().isIn(['scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show', 'rescheduled']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
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
      status,
      page = 1,
      limit = 10
    } = req.query;

    let query = {};

    // Filter by user role
    if (req.user.role === 'student') {
      const student = await Student.findOne({ user: req.user._id });
      if (!student) {
        return res.status(404).json({
          success: false,
          message: 'Student profile not found'
        });
      }
      query.student = student._id;
    } else if (req.user.role === 'tutor') {
      const tutor = await Tutor.findOne({ user: req.user._id });
      if (!tutor) {
        return res.status(404).json({
          success: false,
          message: 'Tutor profile not found'
        });
      }
      query.tutor = tutor._id;
    }

    // Filter by status
    if (status) {
      query.status = status;
    }

    const bookings = await Booking.find(query)
      .populate('student', 'user currentClass board')
      .populate('student.user', 'firstName lastName avatar phone')
      .populate('tutor', 'user subjects rating')
      .populate('tutor.user', 'firstName lastName avatar phone')
      .sort({ scheduledDate: -1, startTime: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Booking.countDocuments(query);

    res.json({
      success: true,
      data: {
        bookings,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalBookings: total,
          hasNext: page * limit < total,
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Get bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bookings'
    });
  }
});

// @desc    Get single booking
// @route   GET /api/bookings/:id
// @access  Private
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('student', 'user currentClass board parentInfo')
      .populate('student.user', 'firstName lastName avatar phone email')
      .populate('tutor', 'user subjects rating qualifications')
      .populate('tutor.user', 'firstName lastName avatar phone email');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if user has access to this booking
    const hasAccess = 
      (req.user.role === 'student' && booking.student.user._id.toString() === req.user._id.toString()) ||
      (req.user.role === 'tutor' && booking.tutor.user._id.toString() === req.user._id.toString()) ||
      ['admin', 'employee'].includes(req.user.role);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: { booking }
    });

  } catch (error) {
    console.error('Get booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch booking'
    });
  }
});

// @desc    Update booking status
// @route   PUT /api/bookings/:id/status
// @access  Private
router.put('/:id/status', authenticateToken, [
  body('status').isIn(['confirmed', 'in_progress', 'completed', 'cancelled', 'no_show']).withMessage('Invalid status'),
  body('reason').optional().isString().withMessage('Reason must be a string')
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

    const { status, reason } = req.body;

    const booking = await Booking.findById(req.params.id)
      .populate('student.user', 'firstName lastName email phone')
      .populate('tutor.user', 'firstName lastName email phone');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check permissions
    const canUpdate = 
      (req.user.role === 'tutor' && booking.tutor.user._id.toString() === req.user._id.toString()) ||
      ['admin', 'employee'].includes(req.user.role);

    if (!canUpdate) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this booking'
      });
    }

    // Update booking status
    await booking.updateStatus(status, reason);

    res.json({
      success: true,
      message: 'Booking status updated successfully',
      data: { booking }
    });

  } catch (error) {
    console.error('Update booking status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update booking status'
    });
  }
});

// @desc    Cancel booking
// @route   PUT /api/bookings/:id/cancel
// @access  Private
router.put('/:id/cancel', authenticateToken, [
  body('reason').notEmpty().withMessage('Cancellation reason is required')
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

    const { reason } = req.body;

    const booking = await Booking.findById(req.params.id)
      .populate('student.user', 'firstName lastName email phone')
      .populate('tutor.user', 'firstName lastName email phone');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if user can cancel this booking
    const canCancel = 
      (req.user.role === 'student' && booking.student.user._id.toString() === req.user._id.toString()) ||
      (req.user.role === 'tutor' && booking.tutor.user._id.toString() === req.user._id.toString()) ||
      ['admin', 'employee'].includes(req.user.role);

    if (!canCancel) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to cancel this booking'
      });
    }

    // Check if booking can be cancelled
    if (!booking.canBeCancelled()) {
      return res.status(400).json({
        success: false,
        message: 'Booking cannot be cancelled. Must be cancelled at least 2 hours before the session.'
      });
    }

    // Cancel booking
    booking.cancellation = {
      reason,
      cancelledBy: req.user.role,
      cancelledAt: Date.now(),
      refundEligible: true,
      refundAmount: booking.calculateRefundAmount()
    };
    booking.status = 'cancelled';

    await booking.save();

    res.json({
      success: true,
      message: 'Booking cancelled successfully',
      data: { 
        booking,
        refundAmount: booking.cancellation.refundAmount
      }
    });

  } catch (error) {
    console.error('Cancel booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel booking'
    });
  }
});

// @desc    Get upcoming sessions
// @route   GET /api/bookings/upcoming
// @access  Private
router.get('/upcoming', authenticateToken, [
  query('days').optional().isInt({ min: 1, max: 30 }).withMessage('Days must be between 1-30')
], async (req, res) => {
  try {
    const { days = 7 } = req.query;

    let userId;
    if (req.user.role === 'student') {
      const student = await Student.findOne({ user: req.user._id });
      userId = student?._id;
    } else if (req.user.role === 'tutor') {
      const tutor = await Tutor.findOne({ user: req.user._id });
      userId = tutor?._id;
    }

    if (!userId) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    const upcomingSessions = await Booking.findUpcomingSessions(userId, req.user.role, days);

    res.json({
      success: true,
      data: { upcomingSessions }
    });

  } catch (error) {
    console.error('Get upcoming sessions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch upcoming sessions'
    });
  }
});

module.exports = router;
