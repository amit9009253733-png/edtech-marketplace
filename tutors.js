const express = require('express');
const { body, validationResult, query } = require('express-validator');
const multer = require('multer');
const path = require('path');
const User = require('../models/User');
const Tutor = require('../models/Tutor');
const { authenticateToken, authorizeRoles, checkTutorProfile } = require('../middleware/auth');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/tutors/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'certificate' || file.fieldname === 'aadhaarDocument' || file.fieldname === 'panDocument') {
      // Allow PDF, JPG, PNG for documents
      if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
        cb(null, true);
      } else {
        cb(new Error('Only images and PDF files are allowed for documents'));
      }
    } else if (file.fieldname === 'introVideo') {
      // Allow video files
      if (file.mimetype.startsWith('video/')) {
        cb(null, true);
      } else {
        cb(new Error('Only video files are allowed for intro video'));
      }
    } else {
      cb(new Error('Unexpected file field'));
    }
  }
});

// @desc    Get all tutors with search and filters
// @route   GET /api/tutors
// @access  Public
router.get('/', [
  query('search').optional().trim(),
  query('subject').optional().trim(),
  query('class').optional().trim(),
  query('board').optional().trim(),
  query('teachingMode').optional().isIn(['online', 'offline', 'both']),
  query('minRating').optional().isFloat({ min: 0, max: 5 }),
  query('maxPrice').optional().isFloat({ min: 0 }),
  query('latitude').optional().isFloat(),
  query('longitude').optional().isFloat(),
  query('radius').optional().isFloat({ min: 1, max: 50 }),
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
      search,
      subject,
      class: className,
      board,
      teachingMode,
      minRating,
      maxPrice,
      latitude,
      longitude,
      radius = 5,
      page = 1,
      limit = 10,
      sortBy = 'rating'
    } = req.query;

    // Build query
    let query = {
      isAvailableForBooking: true,
      'kyc.verificationStatus': 'verified'
    };

    // Text search
    if (search) {
      query.$or = [
        { 'subjects.name': new RegExp(search, 'i') },
        { bio: new RegExp(search, 'i') }
      ];
    }

    // Subject filter
    if (subject) {
      query['subjects.name'] = new RegExp(subject, 'i');
    }

    // Class filter
    if (className) {
      query['subjects.classes'] = className;
    }

    // Board filter
    if (board) {
      query['subjects.boards'] = board;
    }

    // Teaching mode filter
    if (teachingMode) {
      query.teachingModes = teachingMode;
    }

    // Rating filter
    if (minRating) {
      query['rating.average'] = { $gte: parseFloat(minRating) };
    }

    // Price filter
    if (maxPrice) {
      query['subjects.pricePerHour'] = { $lte: parseFloat(maxPrice) };
    }

    // Location-based search
    let tutors;
    if (latitude && longitude) {
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);
      const radiusInMeters = parseFloat(radius) * 1000;

      tutors = await Tutor.aggregate([
        {
          $lookup: {
            from: 'users',
            localField: 'user',
            foreignField: '_id',
            as: 'userInfo'
          }
        },
        {
          $match: {
            ...query,
            'userInfo.location': {
              $near: {
                $geometry: {
                  type: 'Point',
                  coordinates: [lng, lat]
                },
                $maxDistance: radiusInMeters
              }
            }
          }
        },
        {
          $addFields: {
            distance: {
              $divide: [
                {
                  $sqrt: {
                    $add: [
                      {
                        $pow: [
                          {
                            $multiply: [
                              { $subtract: [{ $arrayElemAt: ['$userInfo.location.coordinates', 1] }, lat] },
                              111.32
                            ]
                          },
                          2
                        ]
                      },
                      {
                        $pow: [
                          {
                            $multiply: [
                              { $subtract: [{ $arrayElemAt: ['$userInfo.location.coordinates', 0] }, lng] },
                              { $multiply: [111.32, { $cos: { $multiply: [lat, Math.PI / 180] } }] }
                            ]
                          },
                          2
                        ]
                      }
                    ]
                  }
                },
                1
              ]
            }
          }
        }
      ]);
    } else {
      tutors = await Tutor.find(query);
    }

    // Populate user data
    tutors = await Tutor.populate(tutors, {
      path: 'user',
      select: 'firstName lastName avatar location address'
    });

    // Sort results
    switch (sortBy) {
      case 'rating':
        tutors.sort((a, b) => b.rating.average - a.rating.average);
        break;
      case 'price_low':
        tutors.sort((a, b) => {
          const aMinPrice = Math.min(...a.subjects.map(s => s.pricePerHour));
          const bMinPrice = Math.min(...b.subjects.map(s => s.pricePerHour));
          return aMinPrice - bMinPrice;
        });
        break;
      case 'price_high':
        tutors.sort((a, b) => {
          const aMaxPrice = Math.max(...a.subjects.map(s => s.pricePerHour));
          const bMaxPrice = Math.max(...b.subjects.map(s => s.pricePerHour));
          return bMaxPrice - aMaxPrice;
        });
        break;
      case 'distance':
        if (latitude && longitude) {
          tutors.sort((a, b) => (a.distance || 0) - (b.distance || 0));
        }
        break;
      case 'experience':
        tutors.sort((a, b) => b.experience.totalYears - a.experience.totalYears);
        break;
      default:
        tutors.sort((a, b) => b.rating.average - a.rating.average);
    }

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const paginatedTutors = tutors.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: {
        tutors: paginatedTutors,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(tutors.length / limit),
          totalTutors: tutors.length,
          hasNext: endIndex < tutors.length,
          hasPrev: startIndex > 0
        }
      }
    });

  } catch (error) {
    console.error('Get tutors error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tutors'
    });
  }
});

// @desc    Get single tutor profile
// @route   GET /api/tutors/:id
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const tutor = await Tutor.findById(req.params.id)
      .populate('user', 'firstName lastName avatar location address createdAt')
      .populate('reviews.student', 'firstName lastName avatar');

    if (!tutor) {
      return res.status(404).json({
        success: false,
        message: 'Tutor not found'
      });
    }

    res.json({
      success: true,
      data: { tutor }
    });

  } catch (error) {
    console.error('Get tutor error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tutor'
    });
  }
});

// @desc    Create/Update tutor profile
// @route   POST /api/tutors/profile
// @access  Private (Tutor only)
router.post('/profile', authenticateToken, authorizeRoles('tutor'), [
  body('qualifications').isArray().withMessage('Qualifications must be an array'),
  body('experience.totalYears').isInt({ min: 0, max: 50 }).withMessage('Experience must be 0-50 years'),
  body('subjects').isArray().withMessage('Subjects must be an array'),
  body('teachingModes').isArray().withMessage('Teaching modes must be an array'),
  body('bio').optional().isLength({ max: 1000 }).withMessage('Bio cannot exceed 1000 characters')
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
      qualifications,
      experience,
      subjects,
      teachingModes,
      availability,
      bio,
      socialLinks
    } = req.body;

    let tutor = await Tutor.findOne({ user: req.user._id });

    if (!tutor) {
      tutor = new Tutor({ user: req.user._id });
    }

    // Update tutor profile
    tutor.qualifications = qualifications;
    tutor.experience = experience;
    tutor.subjects = subjects;
    tutor.teachingModes = teachingModes;
    tutor.availability = availability;
    tutor.bio = bio;
    tutor.socialLinks = socialLinks;

    await tutor.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { tutor }
    });

  } catch (error) {
    console.error('Update tutor profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
});

// @desc    Upload KYC documents
// @route   POST /api/tutors/kyc
// @access  Private (Tutor only)
router.post('/kyc', authenticateToken, authorizeRoles('tutor'), 
  upload.fields([
    { name: 'aadhaarDocument', maxCount: 1 },
    { name: 'panDocument', maxCount: 1 }
  ]), [
    body('aadhaarNumber').matches(/^\d{12}$/).withMessage('Aadhaar number must be 12 digits'),
    body('panNumber').optional().matches(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/).withMessage('Invalid PAN format')
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

    const { aadhaarNumber, panNumber } = req.body;

    if (!req.files || !req.files.aadhaarDocument) {
      return res.status(400).json({
        success: false,
        message: 'Aadhaar document is required'
      });
    }

    let tutor = await Tutor.findOne({ user: req.user._id });
    if (!tutor) {
      return res.status(404).json({
        success: false,
        message: 'Tutor profile not found'
      });
    }

    // Update KYC information
    tutor.kyc = {
      aadhaarNumber,
      aadhaarDocument: req.files.aadhaarDocument[0].path,
      panNumber,
      panDocument: req.files.panDocument ? req.files.panDocument[0].path : undefined,
      verificationStatus: 'pending'
    };

    await tutor.save();

    res.json({
      success: true,
      message: 'KYC documents uploaded successfully. Verification pending.',
      data: { 
        kyc: {
          verificationStatus: tutor.kyc.verificationStatus,
          aadhaarNumber: tutor.kyc.aadhaarNumber.replace(/\d(?=\d{4})/g, '*'),
          panNumber: tutor.kyc.panNumber
        }
      }
    });

  } catch (error) {
    console.error('KYC upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload KYC documents'
    });
  }
});

// @desc    Add demo slots
// @route   POST /api/tutors/demo-slots
// @access  Private (Tutor only)
router.post('/demo-slots', authenticateToken, authorizeRoles('tutor'), checkTutorProfile, [
  body('slots').isArray().withMessage('Slots must be an array'),
  body('slots.*.date').isISO8601().withMessage('Invalid date format'),
  body('slots.*.startTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Invalid start time format'),
  body('slots.*.endTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Invalid end time format'),
  body('slots.*.subject').notEmpty().withMessage('Subject is required'),
  body('slots.*.class').notEmpty().withMessage('Class is required')
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

    const { slots } = req.body;

    const tutor = await Tutor.findOne({ user: req.user._id });
    if (!tutor) {
      return res.status(404).json({
        success: false,
        message: 'Tutor profile not found'
      });
    }

    // Add new demo slots
    tutor.demoSlots.push(...slots);
    await tutor.save();

    res.json({
      success: true,
      message: 'Demo slots added successfully',
      data: { demoSlots: tutor.demoSlots }
    });

  } catch (error) {
    console.error('Add demo slots error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add demo slots'
    });
  }
});

// @desc    Get tutor dashboard data
// @route   GET /api/tutors/dashboard
// @access  Private (Tutor only)
router.get('/dashboard', authenticateToken, authorizeRoles('tutor'), async (req, res) => {
  try {
    const tutor = await Tutor.findOne({ user: req.user._id })
      .populate('user', 'firstName lastName email phone');

    if (!tutor) {
      return res.status(404).json({
        success: false,
        message: 'Tutor profile not found'
      });
    }

    // Get upcoming sessions (you'll need to implement this with Booking model)
    // const upcomingSessions = await Booking.find({
    //   tutor: tutor._id,
    //   scheduledDate: { $gte: new Date() },
    //   status: { $in: ['scheduled', 'confirmed'] }
    // }).limit(5).populate('student');

    const dashboardData = {
      profile: tutor,
      stats: tutor.stats,
      earnings: tutor.earnings,
      recentReviews: tutor.reviews.slice(-5),
      // upcomingSessions,
      profileCompletion: tutor.profileCompletionPercentage
    };

    res.json({
      success: true,
      data: dashboardData
    });

  } catch (error) {
    console.error('Get tutor dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data'
    });
  }
});

module.exports = router;
