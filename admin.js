const express = require('express');
const { body, validationResult, query } = require('express-validator');
const User = require('../models/User');
const Student = require('../models/Student');
const Tutor = require('../models/Tutor');
const Booking = require('../models/Booking');
const { authenticateToken, authorizeRoles, checkPermission } = require('../middleware/auth');

const router = express.Router();

// @desc    Get admin dashboard data
// @route   GET /api/admin/dashboard
// @access  Private (Admin)
router.get('/dashboard', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    // User statistics
    const userStats = await User.aggregate([
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 },
          active: {
            $sum: {
              $cond: [{ $eq: ['$status', 'active'] }, 1, 0]
            }
          },
          pending: {
            $sum: {
              $cond: [{ $eq: ['$status', 'pending'] }, 1, 0]
            }
          }
        }
      }
    ]);

    // Booking statistics
    const bookingStats = await Booking.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalRevenue: { $sum: '$pricing.totalAmount' }
        }
      }
    ]);

    // Recent registrations
    const recentUsers = await User.find()
      .select('firstName lastName email role status createdAt')
      .sort({ createdAt: -1 })
      .limit(10);

    // Pending approvals
    const pendingTutors = await Tutor.find({ 'kyc.verificationStatus': 'pending' })
      .populate('user', 'firstName lastName email phone')
      .limit(10);

    const pendingEmployees = await User.find({ 
      role: 'employee', 
      status: 'pending' 
    })
      .select('firstName lastName email employeeId department createdAt')
      .limit(10);

    // Revenue statistics (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const revenueStats = await Booking.aggregate([
      {
        $match: {
          'payment.status': 'paid',
          'payment.paidAt': { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$payment.paidAt' }
          },
          revenue: { $sum: '$pricing.totalAmount' },
          bookings: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const dashboardData = {
      userStats,
      bookingStats,
      recentUsers,
      pendingApprovals: {
        tutors: pendingTutors,
        employees: pendingEmployees
      },
      revenueStats,
      summary: {
        totalUsers: await User.countDocuments(),
        totalTutors: await Tutor.countDocuments(),
        totalStudents: await Student.countDocuments(),
        totalBookings: await Booking.countDocuments(),
        totalRevenue: await Booking.aggregate([
          { $match: { 'payment.status': 'paid' } },
          { $group: { _id: null, total: { $sum: '$pricing.totalAmount' } } }
        ]).then(result => result[0]?.total || 0)
      }
    };

    res.json({
      success: true,
      data: dashboardData
    });

  } catch (error) {
    console.error('Get admin dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data'
    });
  }
});

// @desc    Approve/Reject tutor
// @route   PUT /api/admin/tutors/:id/approve
// @access  Private (Admin)
router.put('/tutors/:id/approve', authenticateToken, authorizeRoles('admin'), [
  body('action').isIn(['approve', 'reject']).withMessage('Action must be approve or reject'),
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

    const { id } = req.params;
    const { action, reason } = req.body;

    const tutor = await Tutor.findById(id).populate('user');
    if (!tutor) {
      return res.status(404).json({
        success: false,
        message: 'Tutor not found'
      });
    }

    if (action === 'approve') {
      tutor.kyc.verificationStatus = 'verified';
      tutor.kyc.verifiedAt = new Date();
      tutor.kyc.verifiedBy = req.user._id;
      tutor.user.status = 'active';
      
      await tutor.save();
      await tutor.user.save();

      // Send approval email
      try {
        const { sendEmail } = require('../utils/emailService');
        await sendEmail({
          to: tutor.user.email,
          template: 'tutorApproval',
          data: {
            name: tutor.user.firstName,
            dashboardLink: `${process.env.CLIENT_URL}/tutor`
          }
        });
      } catch (emailError) {
        console.error('Approval email failed:', emailError);
      }

    } else {
      tutor.kyc.verificationStatus = 'rejected';
      tutor.kyc.rejectionReason = reason;
      tutor.user.status = 'rejected';
      
      await tutor.save();
      await tutor.user.save();
    }

    res.json({
      success: true,
      message: `Tutor ${action}d successfully`,
      data: { tutor }
    });

  } catch (error) {
    console.error('Approve/Reject tutor error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process tutor approval'
    });
  }
});

// @desc    Approve/Reject employee
// @route   PUT /api/admin/employees/:id/approve
// @access  Private (Admin)
router.put('/employees/:id/approve', authenticateToken, authorizeRoles('admin'), [
  body('action').isIn(['approve', 'reject']).withMessage('Action must be approve or reject'),
  body('permissions').optional().isArray().withMessage('Permissions must be an array'),
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

    const { id } = req.params;
    const { action, permissions, reason } = req.body;

    const employee = await User.findById(id);
    if (!employee || employee.role !== 'employee') {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    if (action === 'approve') {
      employee.status = 'active';
      employee.approvedBy = req.user._id;
      employee.approvedAt = new Date();
      
      if (permissions) {
        employee.permissions = permissions;
      }
      
      await employee.save();

    } else {
      employee.status = 'rejected';
      await employee.save();
    }

    res.json({
      success: true,
      message: `Employee ${action}d successfully`,
      data: { employee }
    });

  } catch (error) {
    console.error('Approve/Reject employee error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process employee approval'
    });
  }
});

// @desc    Get all users with filters
// @route   GET /api/admin/users
// @access  Private (Admin)
router.get('/users', authenticateToken, authorizeRoles('admin'), [
  query('role').optional().isIn(['student', 'tutor', 'employee', 'admin']),
  query('status').optional().isIn(['active', 'inactive', 'pending', 'suspended', 'rejected']),
  query('search').optional().isString(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
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
      role,
      status,
      search,
      page = 1,
      limit = 20
    } = req.query;

    let query = {};

    if (role) query.role = role;
    if (status) query.status = status;

    if (search) {
      query.$or = [
        { firstName: new RegExp(search, 'i') },
        { lastName: new RegExp(search, 'i') },
        { email: new RegExp(search, 'i') },
        { phone: new RegExp(search, 'i') }
      ];
    }

    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalUsers: total,
          hasNext: page * limit < total,
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users'
    });
  }
});

// @desc    Update user status
// @route   PUT /api/admin/users/:id/status
// @access  Private (Admin)
router.put('/users/:id/status', authenticateToken, authorizeRoles('admin'), [
  body('status').isIn(['active', 'inactive', 'suspended']).withMessage('Invalid status'),
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

    const { id } = req.params;
    const { status, reason } = req.body;

    const user = await User.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'User status updated successfully',
      data: { user }
    });

  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user status'
    });
  }
});

// @desc    Get system analytics
// @route   GET /api/admin/analytics
// @access  Private (Admin)
router.get('/analytics', authenticateToken, authorizeRoles('admin'), [
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('metric').optional().isIn(['users', 'bookings', 'revenue', 'engagement'])
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
      startDate,
      endDate,
      metric
    } = req.query;

    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    let analytics = {};

    // User analytics
    if (!metric || metric === 'users') {
      analytics.users = await User.aggregate([
        {
          $match: {
            createdAt: { $gte: start, $lte: end }
          }
        },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              role: '$role'
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.date': 1 } }
      ]);
    }

    // Booking analytics
    if (!metric || metric === 'bookings') {
      analytics.bookings = await Booking.aggregate([
        {
          $match: {
            createdAt: { $gte: start, $lte: end }
          }
        },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              status: '$status'
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.date': 1 } }
      ]);
    }

    // Revenue analytics
    if (!metric || metric === 'revenue') {
      analytics.revenue = await Booking.aggregate([
        {
          $match: {
            'payment.status': 'paid',
            'payment.paidAt': { $gte: start, $lte: end }
          }
        },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$payment.paidAt' } }
            },
            revenue: { $sum: '$pricing.totalAmount' },
            bookings: { $sum: 1 }
          }
        },
        { $sort: { '_id.date': 1 } }
      ]);
    }

    res.json({
      success: true,
      data: {
        analytics,
        dateRange: { startDate: start, endDate: end }
      }
    });

  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics'
    });
  }
});

// @desc    Get system settings
// @route   GET /api/admin/settings
// @access  Private (Admin)
router.get('/settings', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    // In a real implementation, you would fetch settings from a Settings model
    const settings = {
      general: {
        siteName: 'Ed Share',
        siteDescription: 'EdTech Marketplace',
        contactEmail: 'support@edshare.com',
        supportPhone: '+91-9876543210'
      },
      payments: {
        razorpayEnabled: true,
        stripeEnabled: true,
        commissionRate: 15,
        minimumWithdrawal: 500
      },
      features: {
        chatEnabled: true,
        videoCallEnabled: true,
        groupSessionsEnabled: true,
        demoSessionsEnabled: true
      },
      limits: {
        maxFileSize: 5242880, // 5MB
        maxSessionDuration: 180, // 3 hours
        maxStudentsPerTutor: 50
      }
    };

    res.json({
      success: true,
      data: { settings }
    });

  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch settings'
    });
  }
});

// @desc    Update system settings
// @route   PUT /api/admin/settings
// @access  Private (Admin)
router.put('/settings', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { settings } = req.body;

    // In a real implementation, you would update settings in a Settings model
    
    res.json({
      success: true,
      message: 'Settings updated successfully',
      data: { settings }
    });

  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update settings'
    });
  }
});

module.exports = router;
