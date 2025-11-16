const express = require('express');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const User = require('../models/User');
const { authenticateToken, authorizeRoles, checkOwnership } = require('../middleware/auth');

const router = express.Router();

// Configure multer for avatar uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/avatars/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 2 * 1024 * 1024 // 2MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: { user }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile'
    });
  }
});

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
router.put('/profile', authenticateToken, [
  body('firstName').optional().trim().isLength({ min: 2, max: 50 }).withMessage('First name must be 2-50 characters'),
  body('lastName').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Last name must be 2-50 characters'),
  body('phone').optional().matches(/^[6-9]\d{9}$/).withMessage('Please enter a valid 10-digit phone number'),
  body('dateOfBirth').optional().isISO8601().withMessage('Please enter a valid date'),
  body('gender').optional().isIn(['male', 'female', 'other']).withMessage('Invalid gender'),
  body('address.pincode').optional().matches(/^\d{6}$/).withMessage('Please enter a valid 6-digit pincode')
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
      firstName,
      lastName,
      phone,
      dateOfBirth,
      gender,
      address
    } = req.body;

    // Check if phone number is already taken by another user
    if (phone) {
      const existingUser = await User.findOne({
        phone,
        _id: { $ne: req.user._id }
      });

      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Phone number already in use'
        });
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        ...(firstName && { firstName }),
        ...(lastName && { lastName }),
        ...(phone && { phone, isPhoneVerified: false }), // Reset phone verification if changed
        ...(dateOfBirth && { dateOfBirth }),
        ...(gender && { gender }),
        ...(address && { address })
      },
      { new: true, runValidators: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user }
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
});

// @desc    Upload avatar
// @route   POST /api/users/avatar
// @access  Private
router.post('/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { avatar: req.file.path },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Avatar uploaded successfully',
      data: { 
        user,
        avatarUrl: `/uploads/avatars/${req.file.filename}`
      }
    });

  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload avatar'
    });
  }
});

// @desc    Update location
// @route   PUT /api/users/location
// @access  Private
router.put('/location', authenticateToken, [
  body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
  body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
  body('address').optional().isString().withMessage('Address must be a string')
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

    const { latitude, longitude, address } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        location: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        ...(address && { 'address.street': address })
      },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Location updated successfully',
      data: { user }
    });

  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update location'
    });
  }
});

// @desc    Change password
// @route   PUT /api/users/change-password
// @access  Private
router.put('/change-password', authenticateToken, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
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

    const { currentPassword, newPassword } = req.body;

    // Get user with password
    const user = await User.findById(req.user._id).select('+password');

    // Check current password
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password'
    });
  }
});

// @desc    Delete user account
// @route   DELETE /api/users/account
// @access  Private
router.delete('/account', authenticateToken, [
  body('password').notEmpty().withMessage('Password is required for account deletion'),
  body('confirmDelete').equals('DELETE').withMessage('Please type DELETE to confirm')
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

    const { password } = req.body;

    // Get user with password
    const user = await User.findById(req.user._id).select('+password');

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Password is incorrect'
      });
    }

    // Soft delete - mark as inactive instead of actual deletion
    await User.findByIdAndUpdate(req.user._id, {
      status: 'inactive',
      email: `deleted_${Date.now()}_${user.email}`,
      phone: `deleted_${Date.now()}_${user.phone}`
    });

    res.json({
      success: true,
      message: 'Account deleted successfully'
    });

  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete account'
    });
  }
});

// @desc    Get user statistics (Admin only)
// @route   GET /api/users/stats
// @access  Private (Admin)
router.get('/stats', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const stats = await User.getStats();
    
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ status: 'active' });
    const pendingUsers = await User.countDocuments({ status: 'pending' });
    
    res.json({
      success: true,
      data: {
        totalUsers,
        activeUsers,
        pendingUsers,
        roleStats: stats
      }
    });

  } catch (error) {
    console.error('Get user stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user statistics'
    });
  }
});

// @desc    Search users (Admin/Employee only)
// @route   GET /api/users/search
// @access  Private (Admin/Employee)
router.get('/search', authenticateToken, authorizeRoles('admin', 'employee'), async (req, res) => {
  try {
    const {
      query,
      role,
      status,
      page = 1,
      limit = 10
    } = req.query;

    let searchQuery = {};

    // Text search
    if (query) {
      searchQuery.$or = [
        { firstName: new RegExp(query, 'i') },
        { lastName: new RegExp(query, 'i') },
        { email: new RegExp(query, 'i') },
        { phone: new RegExp(query, 'i') }
      ];
    }

    // Role filter
    if (role) {
      searchQuery.role = role;
    }

    // Status filter
    if (status) {
      searchQuery.status = status;
    }

    const users = await User.find(searchQuery)
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await User.countDocuments(searchQuery);

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
    console.error('Search users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search users'
    });
  }
});

module.exports = router;
