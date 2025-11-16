const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Student = require('../models/Student');
const Tutor = require('../models/Tutor');
const { authenticateToken } = require('../middleware/auth');
const { sendEmail } = require('../utils/emailService');
const { sendSMS } = require('../utils/smsService');

const router = express.Router();

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d'
  });
};

// Generate OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
router.post('/register', [
  body('firstName').trim().isLength({ min: 2, max: 50 }).withMessage('First name must be 2-50 characters'),
  body('lastName').trim().isLength({ min: 2, max: 50 }).withMessage('Last name must be 2-50 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Please enter a valid email'),
  body('phone').matches(/^[6-9]\d{9}$/).withMessage('Please enter a valid 10-digit phone number'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('role').isIn(['student', 'tutor', 'employee']).withMessage('Invalid role'),
  body('dateOfBirth').optional().isISO8601().withMessage('Please enter a valid date'),
  body('gender').optional().isIn(['male', 'female', 'other']).withMessage('Invalid gender')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { firstName, lastName, email, phone, password, role, dateOfBirth, gender, address } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { phone }]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: existingUser.email === email ? 'Email already registered' : 'Phone number already registered'
      });
    }

    // Create user
    const user = await User.create({
      firstName,
      lastName,
      email,
      phone,
      password,
      role,
      dateOfBirth,
      gender,
      address,
      status: role === 'employee' ? 'pending' : 'active'
    });

    // Create role-specific profile
    if (role === 'student') {
      await Student.create({
        user: user._id,
        currentClass: req.body.currentClass || '1',
        board: req.body.board || 'CBSE',
        parentInfo: req.body.parentInfo || {}
      });
    } else if (role === 'tutor') {
      await Tutor.create({
        user: user._id,
        subjects: [],
        qualifications: [],
        experience: { totalYears: 0 }
      });
    } else if (role === 'employee') {
      user.employeeId = user.generateEmployeeId();
      user.department = req.body.department || 'operations';
      await user.save();
    }

    // Generate email verification token
    const emailToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = emailToken;
    await user.save();

    // Generate phone OTP
    const phoneOTP = generateOTP();
    user.phoneVerificationOTP = phoneOTP;
    user.otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
    await user.save();

    // Send verification email
    try {
      await sendEmail({
        to: email,
        subject: 'Welcome to Ed Share - Verify Your Email',
        template: 'emailVerification',
        data: {
          name: firstName,
          verificationLink: `${process.env.CLIENT_URL}/verify-email/${emailToken}`
        }
      });
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
    }

    // Send OTP SMS
    try {
      await sendSMS(phone, `Your Ed Share verification OTP is: ${phoneOTP}. Valid for 10 minutes.`);
    } catch (smsError) {
      console.error('SMS sending failed:', smsError);
    }

    // Generate token
    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      message: 'Registration successful. Please verify your email and phone.',
      data: {
        token,
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone,
          role: user.role,
          status: user.status,
          isEmailVerified: user.isEmailVerified,
          isPhoneVerified: user.isPhoneVerified
        }
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
router.post('/login', [
  body('emailOrPhone').notEmpty().withMessage('Email or phone is required'),
  body('password').notEmpty().withMessage('Password is required')
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

    const { emailOrPhone, password } = req.body;

    // Find user by email or phone
    const user = await User.findOne({
      $or: [
        { email: emailOrPhone.toLowerCase() },
        { phone: emailOrPhone }
      ]
    }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if account is active
    if (user.status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Account suspended. Please contact support.'
      });
    }

    if (user.status === 'pending' && user.role === 'employee') {
      return res.status(403).json({
        success: false,
        message: 'Account pending approval. Please wait for admin approval.'
      });
    }

    // Update last login
    user.lastLogin = Date.now();
    await user.save();

    // Generate token
    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone,
          role: user.role,
          status: user.status,
          isEmailVerified: user.isEmailVerified,
          isPhoneVerified: user.isPhoneVerified,
          avatar: user.avatar
        }
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @desc    Verify email
// @route   GET /api/auth/verify-email/:token
// @access  Public
router.get('/verify-email/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const user = await User.findOne({
      emailVerificationToken: token
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification token'
      });
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Email verified successfully'
    });

  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Email verification failed'
    });
  }
});

// @desc    Verify phone OTP
// @route   POST /api/auth/verify-phone
// @access  Public
router.post('/verify-phone', [
  body('phone').matches(/^[6-9]\d{9}$/).withMessage('Please enter a valid phone number'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits')
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

    const { phone, otp } = req.body;

    const user = await User.findOne({
      phone,
      phoneVerificationOTP: otp,
      otpExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    user.isPhoneVerified = true;
    user.phoneVerificationOTP = undefined;
    user.otpExpires = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Phone verified successfully'
    });

  } catch (error) {
    console.error('Phone verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Phone verification failed'
    });
  }
});

// @desc    Resend phone OTP
// @route   POST /api/auth/resend-otp
// @access  Public
router.post('/resend-otp', [
  body('phone').matches(/^[6-9]\d{9}$/).withMessage('Please enter a valid phone number')
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

    const { phone } = req.body;

    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.isPhoneVerified) {
      return res.status(400).json({
        success: false,
        message: 'Phone already verified'
      });
    }

    // Generate new OTP
    const phoneOTP = generateOTP();
    user.phoneVerificationOTP = phoneOTP;
    user.otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
    await user.save();

    // Send OTP SMS
    try {
      await sendSMS(phone, `Your Ed Share verification OTP is: ${phoneOTP}. Valid for 10 minutes.`);
    } catch (smsError) {
      console.error('SMS sending failed:', smsError);
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP'
      });
    }

    res.json({
      success: true,
      message: 'OTP sent successfully'
    });

  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resend OTP'
    });
  }
});

// @desc    Forgot password
// @route   POST /api/auth/forgot-password
// @access  Public
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail().withMessage('Please enter a valid email')
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

    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.passwordResetToken = resetToken;
    user.passwordResetExpires = Date.now() + 30 * 60 * 1000; // 30 minutes
    await user.save();

    // Send reset email
    try {
      await sendEmail({
        to: email,
        subject: 'Ed Share - Password Reset Request',
        template: 'passwordReset',
        data: {
          name: user.firstName,
          resetLink: `${process.env.CLIENT_URL}/reset-password/${resetToken}`
        }
      });
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      return res.status(500).json({
        success: false,
        message: 'Failed to send reset email'
      });
    }

    res.json({
      success: true,
      message: 'Password reset email sent'
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process password reset request'
    });
  }
});

// @desc    Reset password
// @route   POST /api/auth/reset-password/:token
// @access  Public
router.post('/reset-password/:token', [
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
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

    const { token } = req.params;
    const { password } = req.body;

    const user = await User.findOne({
      passwordResetToken: token,
      passwordResetExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Password reset successful'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Password reset failed'
    });
  }
});

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    
    // Get role-specific data
    let roleData = null;
    if (user.role === 'student') {
      roleData = await Student.findOne({ user: user._id });
    } else if (user.role === 'tutor') {
      roleData = await Tutor.findOne({ user: user._id });
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: user.fullName,
          email: user.email,
          phone: user.phone,
          role: user.role,
          status: user.status,
          isEmailVerified: user.isEmailVerified,
          isPhoneVerified: user.isPhoneVerified,
          avatar: user.avatar,
          address: user.address,
          location: user.location,
          createdAt: user.createdAt
        },
        roleData
      }
    });

  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user data'
    });
  }
});

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    // In a more sophisticated setup, you might want to blacklist the token
    // For now, we'll just send a success response
    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
});

module.exports = router;
